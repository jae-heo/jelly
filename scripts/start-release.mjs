#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const current = join(root, '.data/current');
const release = existsSync(current) ? realpathSync(current) : root;
process.env.JELLY_ASSET_DIR = join(root, '.data/web-assets');
await import(pathToFileURL(join(release, 'dist/src/main.js')).href);
