import { loadConfig } from './config.js';
import { startServer } from './server.js';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const config = loadConfig();
const server = await startServer(config);
const endpointPath = join(config.dataDir, 'endpoint.json');
writeFileSync(endpointPath + '.tmp', JSON.stringify({ url: `http://${config.host}:${server.port}` }) + '\n', { mode: 0o600 });
renameSync(endpointPath + '.tmp', endpointPath);
console.log(JSON.stringify({ event: 'listening', host: config.host, port: server.port }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(0);
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
