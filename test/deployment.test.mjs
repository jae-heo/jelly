import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { activateRelease, publishAssets, withDeploymentLock } from '../scripts/deployment.mjs';

test('locking refuses an old ownerless directory or a symlink rather than removing it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jelly-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = join(directory, 'deploy.lock');
  await mkdir(lock);
  await assert.rejects(withDeploymentLock(directory, async () => {}), { code: 'EISDIR' });
  await rm(lock, { recursive: true });
  const target = join(directory, 'keep');
  await writeFile(target, 'untouched');
  await symlink(target, lock);
  await assert.rejects(withDeploymentLock(directory, async () => {}), { code: 'ELOOP' });
  assert.equal(await readFile(target, 'utf8'), 'untouched');
});

for (const descendant of [false, true]) test(`killed deployment releases its lock after all owners exit (build child: ${descendant})`, { timeout: 10_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jelly-lock-'));
  const source = new URL('../scripts/deployment.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withDeploymentLock } from ${JSON.stringify(source)};
    import { spawn } from 'node:child_process';
    await withDeploymentLock(${JSON.stringify(directory)}, async fd => {
      const build = ${descendant} ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: ['ignore', 'ignore', 'ignore', fd]
      }) : null;
      process.stdout.write(JSON.stringify({ pid: build?.pid }) + '\\n');
      await new Promise(() => setInterval(() => {}, 1000));
    });
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buildPid;
  t.after(async () => {
    child.kill('SIGKILL');
    if (buildPid) { try { process.kill(buildPid, 'SIGKILL'); } catch {} }
    await rm(directory, { recursive: true, force: true });
  });
  const [ready] = await once(child.stdout, 'data');
  buildPid = JSON.parse(ready.toString()).pid;
  await assert.rejects(withDeploymentLock(directory, async () => {}), /already running/);
  const exited = once(child, 'exit');
  child.kill('SIGKILL'); await exited;
  if (buildPid) {
    await assert.rejects(withDeploymentLock(directory, async () => {}), /already running/);
    process.kill(buildPid, 'SIGKILL'); buildPid = undefined;
  }
  for (let attempt = 0; ; attempt++) {
    try { await withDeploymentLock(directory, async () => {}); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(20); }
  }
  // The persistent inode is harmless; the OS lock, not file existence, owns exclusion.
  await withDeploymentLock(directory, async () => {});
});

test('deployment retains old chunks and rolls back a failed release', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jelly-deployment-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const assets = join(directory, 'assets');
  await mkdir(source);
  await writeFile(join(source, 'old.js'), 'old');
  await publishAssets(source, assets);
  await rm(join(source, 'old.js'));
  await writeFile(join(source, 'new.js'), 'new');
  await writeFile(join(source, 'private.txt'), 'private');
  await publishAssets(source, assets);
  assert.equal(await readFile(join(assets, 'old.js'), 'utf8'), 'old');
  assert.equal(await readFile(join(assets, 'new.js'), 'utf8'), 'new');
  await assert.rejects(readFile(join(assets, 'private.txt')), { code: 'ENOENT' });
  await writeFile(join(source, 'new.js'), 'changed');
  await assert.rejects(publishAssets(source, assets), /collision/);
  assert.equal(await readFile(join(assets, 'new.js'), 'utf8'), 'new');
  const current = join(directory, 'current');
  await symlink('old-release', current);
  const restarts = [];
  const restart = async () => { restarts.push(await readlink(current)); };
  await assert.rejects(activateRelease(current, 'broken-release', restart, async () => { throw Error('unhealthy'); }), /previous release restored/);
  assert.equal(await readlink(current), 'old-release');
  assert.deepEqual(restarts, ['broken-release', 'old-release']);
  await activateRelease(current, 'new-release', restart, async () => {});
  assert.equal(await readlink(current), 'new-release');
});
