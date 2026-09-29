#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildRelease, root } from './release.mjs';
import { activateRelease, publishAssets, withDeploymentLock } from './deployment.mjs';
import { cleanReleases } from './retention.mjs';

process.umask(0o077);
const data = join(root, '.data');
await withDeploymentLock(data, async () => {
  const unit = await readFile(join(homedir(), '.config/systemd/user/jelly.service'), 'utf8');
  if (!unit.startsWith('# Managed by Jelly scripts/install-service.mjs') || !unit.includes('start-release.mjs')) {
    throw new Error('Install the release launcher first: node scripts/install-service.mjs');
  }
  const release = buildRelease();
  const assets = join(data, 'web-assets');
  // Preserve lazy chunks for tabs opened before the first managed deployment.
  if (!existsSync(join(data, 'current')) && existsSync(join(root, 'dist/web/assets'))) await publishAssets(join(root, 'dist/web/assets'), assets);
  await publishAssets(join(release, 'dist/web/assets'), assets);
  const runtime = `/run/user/${process.getuid()}`;
  const env = { ...process.env, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus` };
  const restart = () => execFileSync('systemctl', ['--user', 'restart', 'jelly.service'], { env, stdio: 'inherit' });
  const expected = await readFile(join(release, 'dist/web/index.html'), 'utf8');
  await activateRelease(join(data, 'current'), release, restart, async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const { url } = JSON.parse(await readFile(join(data, 'endpoint.json'), 'utf8'));
        const health = await fetch(url + '/healthz', { signal: AbortSignal.timeout(1000) });
        const html = await fetch(url + '/', { signal: AbortSignal.timeout(1000) });
        if (health.ok && (await health.json()).service === 'jelly' && html.ok && await html.text() === expected) return;
      } catch { /* The process may still be starting. Never print private endpoint data. */ }
      await delay(250);
    }
    throw new Error('Release health check failed');
  });
  console.log(`Deployed ${JSON.parse(await readFile(join(release, 'release.json'), 'utf8')).commit}`);
  // A housekeeping failure must not roll back an already healthy deployment.
  try {
    const removed = await cleanReleases(data);
    console.log(`Cleanup: ${removed.releases.length} releases, ${removed.assets.length} expired assets removed.`);
  } catch (error) { console.error('Deployment succeeded; cleanup was skipped:', error.message); }
});
