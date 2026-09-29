import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readlink, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanReleases, ASSET_GRACE_MS } from '../scripts/retention.mjs';
import { activateRelease, withDeploymentLock } from '../scripts/deployment.mjs';

const old = '1'.repeat(40), previous = '2'.repeat(40), current = '3'.repeat(40);
async function fixture(t) {
  const data = await mkdtemp(join(tmpdir(), 'jelly-retention-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  await mkdir(join(data, 'web-assets'));
  for (const [commit, name] of [[old, 'old.js'], [previous, 'previous.js'], [current, 'current.js']]) {
    const release = join(data, 'releases', commit);
    await mkdir(join(release, 'dist/web/assets'), { recursive: true });
    await writeFile(join(release, 'release.json'), JSON.stringify({ commit }));
    await writeFile(join(release, 'dist/web/assets', name), name);
    await writeFile(join(data, 'web-assets', name), name);
    await utimes(join(data, 'web-assets', name), new Date(0), new Date(0));
  }
  await symlink(join('releases', current), join(data, 'current'));
  await symlink(join('releases', previous), join(data, 'previous'));
  return data;
}

test('cleanup bounds releases, protects rollback assets and gives retired chunks a full grace period', async t => {
  const data = await fixture(t);
  const now = ASSET_GRACE_MS * 10;
  await writeFile(join(data, 'jelly.sqlite'), 'do not touch');
  const preview = await cleanReleases(data, { dryRun: true, now });
  assert.deepEqual(preview.releases, [old]);
  assert.deepEqual(preview.assets, []);
  await assert.rejects(readFile(join(data, 'asset-retention.json')), { code: 'ENOENT' });
  assert.equal((await readdir(join(data, 'releases'))).length, 3);
  await cleanReleases(data, { now });
  assert.deepEqual((await readdir(join(data, 'releases'))).sort(), [previous, current]);
  assert.equal(await readFile(join(data, 'web-assets/old.js'), 'utf8'), 'old.js');
  assert.deepEqual((await cleanReleases(data, { now: now + ASSET_GRACE_MS - 1 })).assets, []);
  assert.deepEqual((await cleanReleases(data, { now: now + ASSET_GRACE_MS })).assets, ['old.js']);
  assert.deepEqual((await readdir(join(data, 'web-assets'))).sort(), ['current.js', 'previous.js']);
  assert.equal(await readFile(join(data, 'jelly.sqlite'), 'utf8'), 'do not touch');
});

test('rollback reuse resets asset retirement; redeploy and failure preserve the recovery version', async t => {
  const data = await fixture(t);
  const now = ASSET_GRACE_MS * 10;
  await cleanReleases(data, { now });
  // A formerly retired chunk is reused by the active release.
  const source = join(data, 'releases', current, 'dist/web/assets/reused.js');
  await writeFile(join(data, 'web-assets/reused.js'), 'reused');
  await cleanReleases(data, { now });
  await writeFile(source, 'reused');
  await cleanReleases(data, { now: now + ASSET_GRACE_MS });
  assert.equal(await readFile(join(data, 'web-assets/reused.js'), 'utf8'), 'reused');
  await rm(source);
  await cleanReleases(data, { now: now + ASSET_GRACE_MS + 1 });
  assert.equal(await readFile(join(data, 'web-assets/reused.js'), 'utf8'), 'reused');
  const active = join(data, 'current');
  await activateRelease(active, join(data, 'releases', current), async () => {}, async () => {});
  assert.equal(await readlink(join(data, 'previous')), join('releases', previous));
  await assert.rejects(activateRelease(active, 'broken', async () => {}, async () => { throw Error('unhealthy'); }));
  assert.equal(await readlink(active), join(data, 'releases', current));
  assert.equal(await readlink(join(data, 'previous')), join('releases', previous));
  await activateRelease(active, join(data, 'releases', previous), async () => {}, async () => {});
  assert.equal(await readlink(join(data, 'previous')), join(data, 'releases', current));
});

test('cleanup refuses unsafe pointers and metadata, and ignores unknown directories and symlinks', async t => {
  const data = await fixture(t);
  await mkdir(join(data, 'releases/notes'));
  const unrecognized = '4'.repeat(40);
  await mkdir(join(data, 'releases', unrecognized));
  await writeFile(join(data, 'releases', unrecognized, 'important.txt'), 'keep');
  const outside = await mkdtemp(join(tmpdir(), 'jelly-retention-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'keep.txt'), 'keep');
  await symlink(outside, join(data, 'releases', '5'.repeat(40)));
  await symlink(join(outside, 'keep.txt'), join(data, 'web-assets/linked.js'));
  await writeFile(join(data, 'asset-retention.json'), '{broken');
  await assert.rejects(cleanReleases(data));
  assert.equal((await readdir(join(data, 'releases'))).length, 6);
  await rm(join(data, 'asset-retention.json'));
  await cleanReleases(data);
  assert.equal(await readFile(join(data, 'releases', unrecognized, 'important.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep');
  await rm(join(data, 'current'));
  await symlink(outside, join(data, 'current'));
  await assert.rejects(cleanReleases(data), /invalid release pointer/);
  await rm(join(data, 'current'));
  await symlink(join('releases', current), join(data, 'current'));
  await rm(join(data, 'web-assets'), { recursive: true });
  await symlink(outside, join(data, 'web-assets'));
  await assert.rejects(cleanReleases(data), /ordinary release and asset directories/);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('release and cleanup operations cannot overlap; failures release the lock', async t => {
  const data = await fixture(t);
  let finish, started;
  const blocked = new Promise(resolve => { finish = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const first = withDeploymentLock(data, async () => { started(); await blocked; });
  await entered;
  try { await assert.rejects(withDeploymentLock(data, async () => {}), /already running/); }
  finally { finish(); await first; }
  await assert.rejects(withDeploymentLock(data, async () => { throw Error('expected'); }), /expected/);
  await withDeploymentLock(data, () => cleanReleases(data));
});
