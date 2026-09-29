import { lstat, readFile, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const ASSET_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const commitName = /^[a-f0-9]{40}$/;
const assetName = /^[a-zA-Z0-9._-]+\.(js|css)$/;

async function directory(path) {
  if (!(await lstat(path)).isDirectory()) throw new Error('Cleanup requires ordinary release and asset directories');
}

// Call under the shared release/deployment lock. Only generated artifacts are eligible.
export async function cleanReleases(data, { dryRun = false, now = Date.now() } = {}) {
  data = resolve(data);
  const releases = join(data, 'releases');
  const assets = join(data, 'web-assets');
  await directory(releases); await directory(assets);
  const kept = new Set();
  for (const pointer of ['current', 'previous']) {
    let target;
    try { target = resolve(data, await readlink(join(data, pointer))); }
    catch (error) { if (pointer === 'previous' && error.code === 'ENOENT') continue; throw error; }
    if (dirname(target) !== releases || !commitName.test(basename(target))) throw new Error('Cleanup refused: invalid release pointer');
    await directory(target);
    const manifest = JSON.parse(await readFile(join(target, 'release.json'), 'utf8'));
    if (manifest?.commit !== basename(target)) throw new Error('Cleanup refused: invalid protected release');
    kept.add(basename(target));
  }
  const protectedAssets = new Set();
  for (const commit of kept) {
    const path = join(releases, commit, 'dist/web/assets');
    await directory(path);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isFile() && assetName.test(entry.name)) protectedAssets.add(entry.name);
    }
  }
  const obsolete = [];
  for (const entry of await readdir(releases, { withFileTypes: true })) {
    if (!entry.isDirectory() || !commitName.test(entry.name) || kept.has(entry.name)) continue;
    // Unrecognized or incomplete directories are never removed automatically.
    try {
      const manifest = JSON.parse(await readFile(join(releases, entry.name, 'release.json'), 'utf8'));
      if (manifest?.commit === entry.name) obsolete.push(entry.name);
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  const ledgerPath = join(data, 'asset-retention.json');
  let retired = {};
  try {
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    if (ledger.version !== 1 || !ledger.retired || typeof ledger.retired !== 'object' || Array.isArray(ledger.retired)
      || Object.entries(ledger.retired).some(([name, time]) => !assetName.test(name) || !Number.isFinite(time) || time < 0)) {
      throw new Error('Cleanup refused: invalid asset retention metadata');
    }
    retired = ledger.retired;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const next = {};
  const expired = [];
  for (const entry of await readdir(assets, { withFileTypes: true })) {
    if (!entry.isFile() || !assetName.test(entry.name) || protectedAssets.has(entry.name)) continue;
    // Start grace when an asset becomes unreferenced, not when it was built.
    const since = retired[entry.name] ?? now;
    if (now - since >= ASSET_GRACE_MS) expired.push(entry.name);
    else next[entry.name] = since;
  }
  const result = { kept: [...kept], releases: obsolete.sort(), assets: expired.sort() };
  if (dryRun) return result;
  const temporary = `${ledgerPath}.${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, retired: next }) + '\n', { mode: 0o600 });
    await rename(temporary, ledgerPath);
  } finally { await rm(temporary, { force: true }); }
  for (const commit of obsolete) await rm(join(releases, commit), { recursive: true });
  for (const name of expired) await rm(join(assets, name), { force: true });
  return result;
}
