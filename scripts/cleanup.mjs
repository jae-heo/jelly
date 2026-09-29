#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { withDeploymentLock } from './deployment.mjs';
import { cleanReleases } from './retention.mjs';

process.umask(0o077);
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dry-run')) throw new Error('Usage: npm run cleanup -- [--dry-run]');
const data = fileURLToPath(new URL('../.data', import.meta.url));
const result = await withDeploymentLock(data, () => cleanReleases(data, { dryRun: args.includes('--dry-run') }));
console.log(JSON.stringify({ dryRun: args.includes('--dry-run'), ...result }));
