import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat, mkdir, utimes, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { uploadName } from '../src/uploads.js';

test('uploads: chunked files in a private temp folder outside the project', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jelly-uploads-'));
  // Uploads use the temp directory; keep this test's inside its own folder.
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = join(dir, 'tmp');
  await mkdir(process.env.TMPDIR);
  process.env.JELLY_DATA_DIR = join(dir, 'data'); process.env.JELLY_HOST = '127.0.0.1'; process.env.JELLY_PORT = '0';
  const config = loadConfig();
  const root = join(dir, 'project');
  await mkdir(root);
  const app = await startServer(config);
  const url = `http://127.0.0.1:${app.port}`;
  t.after(async () => {
    await app.close();
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
    await rm(dir, { recursive: true, force: true });
  });
  const project = app.store.addProject('Uploads', root, null);
  const session = app.store.addSession(project.id, 'Shell');
  const base = join(dir, 'tmp', `jelly-${config.instanceId}`);
  const send = (path: string, body: Buffer, auth = true, type = 'application/octet-stream') => fetch(url + path, {
    method: 'POST', body: new Uint8Array(body), headers: { ...(auth ? { Authorization: `Bearer ${config.token}` } : {}), 'Content-Type': type },
  });
  const start = (name: string, size: number, body: Buffer) => send(`/api/sessions/${session.id}/uploads?` + new URLSearchParams({ name, size: String(size) }), body);
  const CHUNK = 2 * 1024 * 1024;

  await t.test('names keep letters in any script and need no shell quoting', () => {
    assert.equal(uploadName('스크린샷 2026-11-25 오후 3.14.png'), '스크린샷_2026-11-25_오후_3.14.png');
    assert.equal(uploadName("../a'$(x);\n.txt"), 'a___x___.txt');
    assert.equal(uploadName('..'), 'file');
    assert.equal(uploadName('-rf'), 'rf');
    assert.equal(uploadName('$$$.png'), 'file.png');
    const long = uploadName('가'.repeat(300) + '.jpeg');
    assert.ok(Buffer.byteLength(long) <= 200 && long.endsWith('.jpeg'));
  });

  await t.test('a small file is written in one request', async () => {
    assert.equal((await send(`/api/sessions/${session.id}/uploads?name=a.txt&size=1`, Buffer.from('a'), false)).status, 401);
    assert.equal((await send(`/api/sessions/${session.id}/uploads?name=a.txt&size=1`, Buffer.from('a'), true, 'application/json')).status, 415);
    const response = await start('메모 1.txt', 6, Buffer.from('hello\n'));
    assert.equal(response.status, 201);
    const result = await response.json() as { path: string; received: number };
    assert.equal(result.received, 6);
    assert.match(result.path, new RegExp(`^${base}/[\\w-]{12}/메모_1\\.txt$`));
    assert.equal(await readFile(result.path, 'utf8'), 'hello\n');
    assert.equal((await stat(base)).mode & 0o777, 0o700);
    assert.equal((await stat(result.path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(root), []);
  });

  await t.test('large files arrive in ordered chunks', async () => {
    const data = Buffer.alloc(CHUNK * 2 + 5);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    assert.equal((await start('big.bin', data.length, data.subarray(0, 10))).status, 400);
    const first = await (await start('big.bin', data.length, data.subarray(0, CHUNK))).json() as { id: string; path: string };
    assert.equal((await send(`/api/uploads/${first.id}?offset=0`, data.subarray(0, CHUNK))).status, 409);
    assert.equal((await send(`/api/uploads/${first.id}?offset=${CHUNK}`, data.subarray(CHUNK, CHUNK * 2 + 1))).status, 413);
    const second = await send(`/api/uploads/${first.id}?offset=${CHUNK}`, data.subarray(CHUNK, CHUNK * 2));
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { received: CHUNK * 2 });
    assert.equal((await send(`/api/uploads/${first.id}?offset=${CHUNK * 2}`, data.subarray(CHUNK * 2))).status, 200);
    assert.deepEqual(await readFile(first.path), data);
    // A finished upload accepts no more data.
    assert.equal((await send(`/api/uploads/${first.id}?offset=${data.length}`, Buffer.from('x'))).status, 404);
    assert.equal((await start('huge.bin', 50 * 1024 * 1024 + 1, data.subarray(0, CHUNK))).status, 413);
  });

  await t.test('old uploads expire; a folder others can read is refused', async () => {
    const old = join(base, 'old-upload');
    await mkdir(old);
    const week = new Date(Date.now() - 8 * 86_400_000);
    await utimes(old, week, week);
    assert.equal((await start('new.txt', 1, Buffer.from('n'))).status, 201);
    assert.ok(!(await readdir(base)).includes('old-upload'));
    await chmod(base, 0o755);
    const refused = await start('x.txt', 1, Buffer.from('x'));
    assert.equal(refused.status, 403);
    assert.equal((await refused.json() as any).error, 'Upload folder is not private');
    await chmod(base, 0o700);
  });
});
