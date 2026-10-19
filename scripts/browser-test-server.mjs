import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../.data/test-build/src/config.js';
import { startServer } from '../.data/test-build/src/server.js';
import { sshFixture } from '../.data/test-build/test/ssh-fixture.js';

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
const fileProjectPath = join(dataDir, 'file-project');
const remoteFilePath = '/file-project';
mkdirSync(join(fileProjectPath, 'nested'), { recursive: true });
await ssh.command('mkdir', '-p', remoteFilePath + '/nested');
const pdfText = 'BT /F1 14 Tf 20 100 Td (Jelly PDF preview) Tj ET';
const pdfObjects = [
  '<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
  '<</Type/Page/Parent 2 0 R/MediaBox[0 0 240 160]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
  `<</Length ${pdfText.length}>>\nstream\n${pdfText}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
];
let pdf = '%PDF-1.4\n'; const pdfOffsets = [0];
for (const [index, object] of pdfObjects.entries()) { pdfOffsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
const pdfXref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${pdfOffsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Root 1 0 R/Size 6>>\nstartxref\n${pdfXref}\n%%EOF`;
const samples = {
  'nested/보고서 & note.txt': Buffer.from('Project file viewer\n<script>window.previewExecuted = true</script>\n한글 🙂\n'),
  '.hidden.txt': Buffer.from('hidden fixture'),
  'archive.bin': Buffer.from([0, 255, 65, 66]),
  'pixel.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=', 'base64'),
  'sample.pdf': Buffer.from(pdf),
};
for (const [name, value] of Object.entries(samples)) {
  writeFileSync(join(fileProjectPath, name), value);
  await ssh.command('sh', '-c', 'printf "%s" "$1" | base64 -d > "$2"', 'fixture', value.toString('base64'), remoteFilePath + '/' + name);
}
process.env.JELLY_DATA_DIR = dataDir;
process.env.JELLY_HOST = '127.0.0.1';
process.env.JELLY_PORT = '47932';
process.env.JELLY_SSH_CONFIG = ssh.config;
const config = loadConfig();
const app = await startServer(config);
writeFileSync(join(root, 'browser-test-info.json'), JSON.stringify({ projectPath, browseRoot, remoteRoot, fileProjectPath, remoteFilePath, tokenFile: join(dataDir, 'token') }), { mode: 0o600 });
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
