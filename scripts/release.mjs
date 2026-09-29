#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function buildRelease() {
  process.umask(0o077);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('Commit or stash working changes before building a release.');
  const commit = git('rev-parse', 'HEAD');
  const releases = join(root, '.data/releases');
  mkdirSync(releases, { recursive: true });
  const destination = join(releases, commit);
  if (existsSync(destination)) {
    if (JSON.parse(readFileSync(join(destination, 'release.json'), 'utf8')).commit !== commit) throw new Error('Invalid release metadata');
    return destination;
  }
  const build = mkdtempSync(join(releases, '.build-'));
  try {
    git('archive', '--format=tar', `--output=${join(build, 'source.tar')}`, commit);
    execFileSync('tar', ['-xf', 'source.tar'], { cwd: build });
    rmSync(join(build, 'source.tar'));
    for (const args of [['ci'], ['run', 'check'], ['run', 'build']]) execFileSync('npm', args, { cwd: build, stdio: 'inherit' });
    writeFileSync(join(build, 'release.json'), JSON.stringify({ commit, node: process.version }) + '\n');
    renameSync(build, destination);
    return destination;
  } finally { rmSync(build, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = buildRelease();
  console.log(`Release ready: ${JSON.parse(readFileSync(join(release, 'release.json'), 'utf8')).commit}`);
}
