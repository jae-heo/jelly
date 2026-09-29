import { constants } from 'node:fs';
import { copyFile, link, mkdir, readFile, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function withDeploymentLock(data, action) {
  await mkdir(data, { recursive: true, mode: 0o700 });
  const lock = join(data, 'deploy.lock');
  try { await mkdir(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('A release, deployment or cleanup is already running (.data/deploy.lock).');
    throw error;
  }
  try { return await action(); }
  finally { await rm(lock, { recursive: true, force: true }); }
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
