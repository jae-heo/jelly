#!/usr/bin/env node
// Runs every check from CI on this machine. SSH and browser fixtures use Docker
// or rootless Podman. When this host cannot launch WebKit (missing system
// libraries), its tests run against Playwright's official browser container.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const run = (...args) => {
  console.log(`\n▶ npm run ${args.join(' ')}`);
  const result = spawnSync('npm', ['run', ...args], { stdio: 'inherit' });
  if (result.status !== 0) { console.error(`\n✖ npm run ${args.join(' ')} failed`); process.exit(result.status ?? 1); }
};
const works = (command, args) => { try { execFileSync(command, args, { stdio: 'ignore', timeout: 15_000 }); return true; } catch { return false; } };

const cli = process.env.JELLY_CONTAINER_CLI ?? (works('docker', ['info']) ? 'docker' : works('podman', ['--version']) ? 'podman' : 'docker');
process.env.JELLY_CONTAINER_CLI = cli;

run('check');
run('test');
run('test:soak');
run('test:ssh');
run('test:web');

const { webkit } = await import('@playwright/test');
let hostWebKit = true;
try { await (await webkit.launch()).close(); } catch { hostWebKit = false; }
if (hostWebKit) run('test:webkit');
else {
  const version = require('@playwright/test/package.json').version;
  const port = await new Promise((resolve, reject) => {
    const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }).on('error', reject);
  });
  const name = `jelly-playwright-${randomBytes(6).toString('hex')}`;
  console.log(`\n▶ WebKit in mcr.microsoft.com/playwright:v${version}-noble (${cli})`);
  // Host networking lets the containerized browser reach the loopback test server.
  execFileSync(cli, ['run', '--rm', '-d', '--name', name, '--network', 'host', '--init', '--user', 'pwuser', '--workdir', '/home/pwuser',
    `mcr.microsoft.com/playwright:v${version}-noble`, '/bin/sh', '-c', `npx -y playwright@${version} run-server --port ${port} --host 127.0.0.1`], { stdio: ['ignore', 'ignore', 'inherit'] });
  try {
    const deadline = Date.now() + 120_000;
    while (!(await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false))) {
      if (Date.now() > deadline) throw new Error('Playwright browser container did not start');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    process.env.PW_TEST_CONNECT_WS_ENDPOINT = `ws://127.0.0.1:${port}/`;
    run('test:webkit');
  } finally { execFileSync(cli, ['rm', '-f', name], { stdio: 'ignore' }); }
}
console.log('\n✔ All checks passed');
