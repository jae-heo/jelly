import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';

test('project files: scoped browsing, safe previews, one-use streaming downloads and cleanup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jelly-files-'));
  process.env.JELLY_DATA_DIR = join(dir, 'data'); process.env.JELLY_HOST = '127.0.0.1'; process.env.JELLY_PORT = '0';
  const config = loadConfig();
  const root = join(dir, 'project');
  await mkdir(join(root, 'nested'), { recursive: true });
  const name = '한글 \'quote\'; $file &\n.txt';
  const payload = 'hello 🙂\n<script>window.bad = true</script>\n';
  await writeFile(join(root, 'nested', name), payload);
  await writeFile(join(root, '.env'), 'TEST=fixture');
  await writeFile(join(root, 'page.html'), payload);
  await writeFile(join(root, 'archive.bin'), Buffer.from([0, 255, 127, 4]));
  await writeFile(join(root, 'fake.txt'), Buffer.from([65, 0, 66]));
  await writeFile(join(root, 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 97));
  await writeFile(join(dir, 'outside.txt'), 'outside');
  await symlink(join(dir, 'outside.txt'), join(root, 'escape.txt'));
  await symlink(dir, join(root, 'outside'));
  await symlink(join(root, 'nested'), join(root, 'linked-folder'));
  const app = await startServer(config);
  const url = `http://127.0.0.1:${app.port}`;
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path: string, method = 'GET', data?: unknown, auth = true, origin?: string) => fetch(url + path, {
    method, headers: { ...(auth ? { Authorization: `Bearer ${config.token}` } : {}), 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const project = app.store.addProject('Files', root, null);
  const base = `/api/projects/${project.id}`;
  const grant = async (path: string) => {
    const res = await request(base + '/downloads', 'POST', { path }); assert.equal(res.status, 201, await res.clone().text());
    return await res.json() as { url: string; name: string };
  };
  await t.test('authentication, project boundaries and special names', async () => {
    assert.equal((await request(base + '/files', 'GET', undefined, false)).status, 401);
    assert.equal((await request(base + '/files', 'GET', undefined, true, 'https://evil.test')).status, 403);
    const listing = await (await request(base + '/files')).json() as any;
    assert.equal(listing.parent, null);
    assert.equal(listing.entries[0].kind, 'directory');
    assert.ok(!listing.entries.some((entry: any) => ['.env', 'escape.txt', 'outside', 'linked-folder'].includes(entry.name)));
    const nested = await (await request(base + '/files?path=nested')).json() as any;
    assert.equal(nested.parent, ''); assert.equal(nested.entries[0].name, name);
    assert.ok((await (await request(base + '/files?hidden=true')).json() as any).entries.some((entry: any) => entry.name === '.env'));
    for (const path of ['../outside.txt', '/etc/passwd', 'nested/../../outside.txt', 'nested/./x', 'bad\0name']) {
      assert.equal((await request(base + '/downloads', 'POST', { path })).status, 400, path);
    }
    for (const path of ['escape.txt', 'outside/outside.txt', 'linked-folder/' + name]) {
      assert.equal((await request(base + '/downloads', 'POST', { path })).status, 403, path);
    }
    assert.equal((await request(base + '/downloads', 'POST', { path: 'nested' })).status, 400);
  });
  await t.test('previews are bounded and never HTML', async () => {
    const response = await request(base + '/preview?path=page.html');
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), payload);
    assert.equal((await request(base + '/preview?path=large.txt')).status, 413);
    assert.equal((await request(base + '/preview?path=archive.bin')).status, 415);
    assert.equal((await request(base + '/preview?path=fake.txt')).status, 415);
  });
  await t.test('binary/Unicode downloads, replay, invalid origin and expiration', async () => {
    const ticket = await grant('nested/' + name);
    assert.equal(ticket.name, name); assert.ok(!ticket.url.includes(config.token));
    assert.equal((await request(ticket.url, 'GET', undefined, false, 'https://evil.test')).status, 403);
    const response = await request(ticket.url, 'GET', undefined, false);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-disposition')!.startsWith('attachment;'));
    assert.ok(!response.headers.get('content-disposition')!.includes('\n'));
    assert.equal(await response.text(), payload);
    assert.equal((await request(ticket.url, 'GET', undefined, false)).status, 401);
    const binary = await request((await grant('archive.bin')).url, 'GET', undefined, false);
    assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from([0, 255, 127, 4]));
    const expired = await grant('page.html');
    const future = Date.now() + 31_000;
    const mock = t.mock.method(Date, 'now', () => future);
    try { assert.equal((await request(expired.url, 'GET', undefined, false)).status, 401); }
    finally { mock.mock.restore(); }
  });
  await t.test('concurrent download limit releases slots after cancellation', async () => {
    const file = await open(join(root, 'stream.bin'), 'w'); await file.truncate(128 * 1024 * 1024); await file.close();
    const tickets = await Promise.all(Array.from({ length: 4 }, () => grant('stream.bin')));
    const controllers = tickets.map(() => new AbortController());
    try {
      const responses = await Promise.all(tickets.map((ticket, index) => fetch(url + ticket.url, { signal: controllers[index]!.signal })));
      assert.ok(responses.every(response => response.status === 200));
      assert.equal((await request(base + '/files')).status, 429);
    } finally { controllers.forEach(controller => controller.abort()); }
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await request(base + '/files')).status === 200) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('Cancelled downloads kept their transfer slots');
  });
  await t.test('revalidate a replaced file and deleted project; cancel a streaming download', async () => {
    await writeFile(join(root, 'replace.txt'), 'before');
    const ticket = await grant('replace.txt');
    await rm(join(root, 'replace.txt')); await symlink(join(dir, 'outside.txt'), join(root, 'replace.txt'));
    assert.equal((await request(ticket.url, 'GET', undefined, false)).status, 403);
    const large = await open(join(root, 'large.bin'), 'w'); await large.truncate(128 * 1024 * 1024); await large.close();
    const controller = new AbortController();
    const response = await fetch(url + (await grant('large.bin')).url, { signal: controller.signal });
    const reader = response.body!.getReader(); assert.ok((await reader.read()).value!.length > 0);
    controller.abort(); await reader.cancel().catch(() => {});
    assert.equal((await request(base + '/files')).status, 200);
    const deleted = await grant('page.html'); app.store.deleteProject(project.id);
    assert.equal((await request(deleted.url, 'GET', undefined, false)).status, 404);
  });
});
