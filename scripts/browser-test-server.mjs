import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../dist/src/config.js';
import { startServer } from '../dist/src/server.js';
import { sshFixture } from '../dist/test/ssh-fixture.js';

const root = resolve('.data');
mkdirSync(root, { recursive: true, mode: 0o700 });
const dataDir = mkdtempSync(join(root, 'browser-test-'));
const ssh = await sshFixture(dataDir);
const remoteRoot = '/workspaces';
await ssh.command('mkdir', '-p', remoteRoot + '/remote-project', remoteRoot + '/한글 폴더');
const browseRoot = join(dataDir, 'folders');
mkdirSync(browseRoot);
const projectPath = join(browseRoot, 'project');
mkdirSync(projectPath);
mkdirSync(join(browseRoot, '.hidden-folder'));
mkdirSync(join(browseRoot, '한글 작업 & #'));
writeFileSync(join(browseRoot, 'notes.txt'), 'Files should not appear in the directory picker.');
process.env.JELLY_DATA_DIR = dataDir;
process.env.JELLY_HOST = '127.0.0.1';
process.env.JELLY_PORT = '47932';
process.env.JELLY_SSH_CONFIG = ssh.config;
const config = loadConfig();
const app = await startServer(config);
writeFileSync(join(root, 'browser-test-info.json'), JSON.stringify({ projectPath, browseRoot, remoteRoot, tokenFile: join(dataDir, 'token') }), { mode: 0o600 });
console.log('Jelly browser test server ready');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await ssh.close();
  if (!dataDir.startsWith(root + '/browser-test-')) throw new Error('Invalid test cleanup path');
  try { execFileSync('tmux', ['-S', config.socket, 'kill-server'], { stdio: 'ignore' }); } catch { /* No live test sessions. */ }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(join(root, 'browser-test-info.json'), { force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
