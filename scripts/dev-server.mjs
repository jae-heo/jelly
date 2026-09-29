#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

// Development never shares the service's database, token or tmux socket.
process.env.JELLY_DATA_DIR = fileURLToPath(new URL('../.data/dev', import.meta.url));
process.env.JELLY_HOST = '127.0.0.1';
process.env.JELLY_PORT = '47822';
process.env.JELLY_ORIGINS = 'http://127.0.0.1:5173';
await import('../dist/src/main.js');
