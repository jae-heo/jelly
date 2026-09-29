import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { copyFile, link, mkdir, open, readFile, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function withDeploymentLock(data, action) {
  await mkdir(data, { recursive: true, mode: 0o700 });
  // Keep this inode: unlinking a flock file allows two independent locks.
  // A descriptor shared with build children keeps the lock until they also exit.
  const lock = await open(join(data, 'deploy.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const result = spawnSync('flock', ['--nonblock', '--conflict-exit-code', '75', '3'], {
      stdio: ['ignore', 'pipe', 'pipe', lock.fd],
    });
    if (result.error) throw new Error('Deployment locking requires flock (util-linux).', { cause: result.error });
    if (result.status === 75) throw new Error('A release, deployment or cleanup is already running (.data/deploy.lock).');
    if (result.status !== 0) throw new Error('Could not acquire deployment lock');
    return await action(lock.fd);
  } finally { await lock.close(); }
}

export async function publishAssets(source, destination) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const name of await readdir(source)) {
    if (!/^[a-zA-Z0-9._-]+\.(js|css)$/.test(name)) continue;
    const target = join(destination, name);
    const temporary = join(destination, `.asset-${randomUUID()}`);
    try {
      await copyFile(join(source, name), temporary, constants.COPYFILE_EXCL);
      try { await link(temporary, target); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!(await readFile(target)).equals(await readFile(temporary))) throw new Error(`Asset hash collision: ${name}`);
      }
    } finally { await rm(temporary, { force: true }); }
  }
}
async function point(current, target) {
  const temporary = `${current}.${randomUUID()}`;
  try { await symlink(target, temporary); await rename(temporary, current); }
  finally { await rm(temporary, { force: true }); }
}
export async function activateRelease(current, target, restart, healthy) {
  let previous;
  try { previous = await readlink(current); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await point(current, target);
  try {
    await restart();
    await healthy();
    if (previous && resolve(dirname(current), previous) !== resolve(dirname(current), target)) {
      await point(join(dirname(current), 'previous'), previous);
    }
  } catch (error) {
    if (previous) await point(current, previous);
    else await rm(current);
    try { await restart(); }
    catch (rollback) { throw new AggregateError([error, rollback], 'Deployment and rollback restart failed'); }
    throw new Error('Deployment failed; previous release restored', { cause: error });
  }
}
