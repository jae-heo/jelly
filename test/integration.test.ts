import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { WebSocket } from 'ws';
import * as pty from 'node-pty';

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(get: () => Promise<T>, accept: (value: T) => boolean, timeout = 6000): Promise<T> {
  const start = Date.now();
  while (true) {
    const value = await get();
    if (accept(value)) return value;
    if (Date.now() - start > timeout) throw new Error('Condition timed out');
    await sleep(40);
  }
}

test('Jelly API + real tmux lifecycle', { timeout: 90_000 }, async t => {
  const root = resolve('.data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dataDir = await mkdtemp(join(root, 'test-'));
  const socket = join(dataDir, 'tmux.sock');
  const projectPath = join(dataDir, '한글 project; dollar$');
  await mkdir(projectPath);
  let backend: ChildProcess | undefined;
  let port = 0;
  let token = '';
  const connections: WebSocket[] = [];

  async function boot() {
    const child = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: resolve('.'), env: { ...process.env, JELLY_HOST: '127.0.0.1', JELLY_DATA_DIR: dataDir, JELLY_PORT: String(port), JELLY_ORIGINS: 'https://jelly.test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend = child;
    let stderr = '';
    child.stderr!.on('data', data => { stderr += data; });
    port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Startup timeout: ' + stderr)), 10_000);
      let output = '';
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Backend exited: ' + stderr)); });
      child.stdout!.on('data', data => {
        output += data;
        for (const line of output.split('\n')) {
          if (!line.startsWith('{')) continue;
          try {
            const message = JSON.parse(line);
            if (message.event === 'listening') { clearTimeout(timeout); resolve(message.port); }
          } catch { /* Wait for a complete line. */ }
        }
      });
    });
    token = (await readFile(join(dataDir, 'token'), 'utf8')).trim();
  }
  async function halt(signal: NodeJS.Signals = 'SIGTERM') {
    if (!backend || backend.exitCode !== null || backend.signalCode !== null) return;
    const stopped = once(backend, 'exit');
    backend.kill(signal);
    await stopped;
    backend = undefined;
  }
  t.after(async () => {
    for (const ws of connections) ws.terminate();
    await halt('SIGKILL');
    // This socket was created in this test's own directory; never target the default tmux server.
    assert.ok(dataDir.startsWith(root + '/test-'));
    await exec('tmux', ['-S', socket, 'kill-server']).catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  });
  async function api(path: string, method = 'GET', body?: unknown, expected = 200, extraHeaders = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as any;
    assert.equal(res.status, expected, JSON.stringify(data));
    return data;
  }
  async function connect(id: string, options: { ticket?: string; origin?: string; auth?: boolean; status?: number; initialInput?: string } = {}) {
    const query = new URLSearchParams({ cols: '90', rows: '28' });
    if (options.ticket) query.set('ticket', options.ticket);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal?${query}`, {
      headers: {
        ...(options.auth === false ? {} : { Authorization: `Bearer ${token}` }),
        ...(options.origin ? { Origin: options.origin } : {}),
      }, handshakeTimeout: 5000,
    });
    connections.push(ws);
    let output = '';
    let ready = false;
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'output') output = (output + message.data).slice(-1024 * 1024);
      if (message.type === 'ready') ready = true;
    });
    ws.on('error', () => {});
    if (options.initialInput) ws.once('open', () => ws.send(JSON.stringify({ type: 'input', data: options.initialInput })));
    if (options.status) {
      await new Promise<void>((resolve, reject) => {
        ws.on('unexpected-response', (_req, res) => {
          try { assert.equal(res.statusCode, options.status); res.resume(); ws.terminate(); resolve(); }
          catch (error) { reject(error); }
        });
        ws.on('open', () => reject(new Error('Unexpected successful upgrade')));
      });
    } else {
      await once(ws, 'open');
      await until(async () => ready, Boolean);
    }
    return {
      ws, output: () => output,
      send: (data: string) => ws.send(JSON.stringify({ type: 'input', data })),
      wait: (text: string) => until(async () => output, output => output.includes(text)),
      clear: () => { output = ''; },
    };
  }
  await boot();
  let projectId: string;
  let sessionId: string;
  let shellPid: number;

  await t.test('web shell is public while credentials and source files stay private', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/html/);
    assert.ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    const html = await response.text();
    assert.match(html, /줼리/);
    const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    assert.ok(asset);
    const script = await fetch(`http://127.0.0.1:${port}${asset}`);
    assert.equal(script.status, 200);
    const touchIcon = /rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(html)?.[1];
    const manifestPath = /rel="manifest"[^>]*href="([^"]+)"/.exec(html)?.[1];
    assert.ok(touchIcon);
    assert.ok(manifestPath);
    const manifestResponse = await fetch(`http://127.0.0.1:${port}${manifestPath}`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('content-type')!, /application\/manifest\+json/);
    const manifest = await manifestResponse.json() as { name: string; icons: { src: string; sizes: string }[] };
    assert.equal(manifest.name, '줼리');
    assert.ok(manifest.icons.length);
    // Home-screen installation fetches these files before login. Verify actual
    // PNG dimensions, content type, HEAD support and refreshable named assets.
    for (const { src, sizes } of [{ src: touchIcon, sizes: '180x180' }, ...manifest.icons]) {
      const url = `http://127.0.0.1:${port}${src}`;
      const icon = await fetch(url);
      assert.equal(icon.status, 200);
      assert.equal(icon.headers.get('content-type'), 'image/png');
      assert.equal(icon.headers.get('cache-control'), 'no-store');
      const png = Buffer.from(await icon.arrayBuffer());
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, sizes);
      const head = await fetch(url, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(Number(head.headers.get('content-length')), png.length);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    for (const path of ['/.data/token', '/src/main.ts', '/assets/../.data/token', '/private.png', '/assets/private.png', '/other.webmanifest']) {
      const privateResponse = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(privateResponse.status, 401);
      assert.ok(!(await privateResponse.text()).includes(token));
    }
  });

  await t.test('authenticated directory browsing handles navigation, links, hidden folders and invalid paths', async () => {
    const browse = join(dataDir, 'browse');
    await mkdir(browse);
    for (const name of ['작업 공간 & #', '.hidden', 'empty', 'denied']) await mkdir(join(browse, name));
    await writeFile(join(browse, 'file.txt'), 'FILE CONTENT MUST NOT BE EXPOSED');
    await symlink(join(browse, '작업 공간 & #'), join(browse, 'folder-link'));
    await symlink(join(browse, 'file.txt'), join(browse, 'file-link'));
    await symlink(join(browse, 'missing'), join(browse, 'broken-link'));
    const query = (path: string) => '/api/directories?' + new URLSearchParams({ path });
    await api('/api/directories', 'GET', undefined, 401, { Authorization: '' });
    await api(query(browse), 'GET', undefined, 403, { Origin: 'https://evil.test' });
    const home = await api('/api/directories');
    assert.equal(home.path, await realpath(homedir()));
    const result = await api(query(browse));
    assert.equal(result.path, browse);
    assert.equal(result.parent, dirname(browse));
    assert.equal(result.home, homedir());
    assert.equal(result.truncated, false);
    assert.deepEqual(result.directories.map((entry: { name: string }) => entry.name).sort(), ['작업 공간 & #', 'empty', 'denied', 'folder-link'].sort());
    assert.ok(!JSON.stringify(result).includes('FILE CONTENT'));
    const hidden = await api(query(browse) + '&hidden=true');
    assert.ok(hidden.directories.some((entry: { name: string }) => entry.name === '.hidden'));
    const linked = await api(query(join(browse, 'folder-link')));
    assert.equal(linked.path, join(browse, '작업 공간 & #'));
    assert.deepEqual(linked.directories, []);
    assert.equal((await api(query('/'))).parent, null);
    await api(query('relative'), 'GET', undefined, 400);
    await api(query(browse + '\0'), 'GET', undefined, 400);
    await api(query(join(browse, 'missing')), 'GET', undefined, 404);
    await api(query(join(browse, 'file.txt')), 'GET', undefined, 400);
    await api(query(browse) + '&hidden=invalid', 'GET', undefined, 400);
    if (process.getuid?.() !== 0) {
      await chmod(join(browse, 'denied'), 0);
      try { await api(query(join(browse, 'denied')), 'GET', undefined, 403); }
      finally { await chmod(join(browse, 'denied'), 0o700); }
    }
  });

  await t.test('auth, origins, path validation and project registration', async () => {
    await api('/healthz');
    await api('/api/projects', 'GET', undefined, 401, { Authorization: '' });
    await api('/api/projects', 'GET', undefined, 403, { Origin: 'https://evil.test' });
    await api('/api/projects', 'POST', { name: 'bad', path: 'relative' }, 400);
    await api('/api/projects', 'POST', { name: 'bad', path: join(dataDir, 'missing') }, 400);
    await api('/api/projects', 'POST', { name: 'bad', path: join(dataDir, 'token') }, 400);
    const p = await api('/api/projects', 'POST', { name: '줼리 테스트', path: projectPath }, 201);
    projectId = p.id;
    assert.equal(p.path, projectPath);
    await symlink(projectPath, join(dataDir, 'alias'));
    await api('/api/projects', 'POST', { name: 'duplicate', path: join(dataDir, 'alias') }, 409);
    assert.equal((await api('/api/projects')).projects.length, 1);
    assert.equal((await stat(join(dataDir, 'token'))).mode & 0o777, 0o600);
  });
  await t.test('create session in exact project directory and reject unsafe WS access', async () => {
    await api(`/api/projects/${projectId}/sessions`, 'POST', { cols: 10000 }, 400);
    const s = await api(`/api/projects/${projectId}/sessions`, 'POST', { name: '터미널' }, 201);
    sessionId = s.id;
    shellPid = s.pid;
    assert.equal(s.status, 'running');
    await api(`/api/projects/${projectId}`, 'DELETE', undefined, 409);
    await connect(sessionId, { auth: false, status: 401 });
    await connect(sessionId, { origin: 'https://evil.test', status: 403 });
    // An existing server/session keeps its old options across an API upgrade.
    await exec('tmux', ['-S', socket, 'set-option', '-t', `jelly-${sessionId}`, 'mouse', 'off']);
    const c = await connect(sessionId, { initialInput: "printf '\\nPWD_RESULT=%s\\n' \"$PWD\"\r" });
    await c.wait('PWD_RESULT=' + projectPath);
    assert.equal((await exec('tmux', ['-S', socket, 'show-options', '-v', '-t', `jelly-${sessionId}`, 'mouse'])).stdout.trim(), 'on');
    c.send("printf '\\n%s%s\\n' '한글🪼' '출력'\r");
    await c.wait('한글🪼출력');
    c.ws.send(JSON.stringify({ type: 'resize', cols: 71, rows: 19 }));
    await until(() => api(`/api/sessions/${sessionId}`), s => s.cols === 71 && s.rows === 19);
    c.ws.close();
    await once(c.ws, 'close');
  });
  await t.test('detached jobs run and reconnect restores screen', async () => {
    const c = await connect(sessionId);
    c.send("sleep 0.4; printf '\\nDETACHED_%s\\n' FINISHED\r");
    c.ws.close();
    await once(c.ws, 'close');
    await sleep(700);
    assert.equal((await api(`/api/sessions/${sessionId}`)).pid, shellPid);
    const resumed = await connect(sessionId);
    await resumed.wait('DETACHED_FINISHED');
    resumed.ws.close();
    await once(resumed.ws, 'close');
    assert.ok((await api(`/api/sessions/${sessionId}/history?lines=100`)).text.includes('DETACHED_FINISHED'));
  });
  await t.test('newest connection takes over; malformed frames close only attachment', async () => {
    const old = await connect(sessionId);
    const closed = once(old.ws, 'close');
    const current = await connect(sessionId);
    assert.equal((await closed)[0], 4001);
    current.send("printf '\\nTAKEOVER_%s\\n' OK\r");
    await current.wait('TAKEOVER_OK');
    const invalidClosed = once(current.ws, 'close');
    current.ws.send(JSON.stringify({ type: 'resize', cols: -1, rows: 20 }));
    assert.equal((await invalidClosed)[0], 1008);
    assert.equal((await api(`/api/sessions/${sessionId}`)).status, 'running');
  });
  await t.test('browser tickets are scoped and single use', async () => {
    const { ticket, expiresIn } = await api(`/api/sessions/${sessionId}/tickets`, 'POST', undefined, 201);
    assert.equal(expiresIn, 30);
    const c = await connect(sessionId, { ticket, auth: false, origin: 'https://jelly.test' });
    c.ws.close(); await once(c.ws, 'close');
    await connect(sessionId, { ticket, auth: false, status: 401 });
    await connect(sessionId, { ticket: 'invalid', auth: false, status: 401 });
    const wrongScope = await api(`/api/sessions/${sessionId}/tickets`, 'POST', undefined, 201);
    await connect('11111111-1111-4111-8111-111111111111', { ticket: wrongScope.ticket, auth: false, status: 401 });
    await connect(sessionId, { ticket: wrongScope.ticket, auth: false, status: 401 });
  });
  await t.test('graceful backend restart preserves shell PID, screen and token', async () => {
    const c = await connect(sessionId);
    const previousToken = token;
    const closed = once(c.ws, 'close');
    await halt();
    assert.equal((await closed)[0], 1012);
    await boot();
    assert.equal(token, previousToken);
    assert.equal((await api(`/api/sessions/${sessionId}`)).pid, shellPid);
    const resumed = await connect(sessionId);
    await resumed.wait('TAKEOVER_OK');
    resumed.ws.close(); await once(resumed.ws, 'close');
  });
  await t.test('SIGKILL of backend preserves running work and same shell', async () => {
    const c = await connect(sessionId);
    c.send("sleep 0.5; printf '\\nCRASH_%s\\n' SURVIVED\r");
    await sleep(100);
    await halt('SIGKILL');
    await boot();
    assert.equal((await api(`/api/sessions/${sessionId}`)).pid, shellPid);
    const resumed = await connect(sessionId);
    await resumed.wait('CRASH_SURVIVED');
    resumed.ws.close(); await once(resumed.ws, 'close');
  });
  await t.test('slow receiver can disconnect without losing shell or API responsiveness', async () => {
    const c = await connect(sessionId);
    c.ws.pause();
    c.send("head -c 16777216 /dev/zero | tr '\\000' x; printf '\\nFLOOD_%s\\n' DONE\r");
    await sleep(500);
    assert.equal((await api('/healthz')).status, 'ok');
    c.ws.terminate();
    await sleep(200);
    const resumed = await connect(sessionId);
    await resumed.wait('FLOOD_DONE');
    resumed.ws.close(); await once(resumed.ws, 'close');
    assert.equal((await api(`/api/sessions/${sessionId}`)).status, 'running');
  });
  await t.test('full-screen interactive program redraws after reconnect and returns to shell', async () => {
    const c = await connect(sessionId);
    c.send('LC_ALL=C top -d 1\r');
    await c.wait('Tasks:');
    c.ws.close(); await once(c.ws, 'close');
    const resumed = await connect(sessionId);
    await resumed.wait('Tasks:');
    resumed.ws.send(JSON.stringify({ type: 'resize', cols: 75, rows: 22 }));
    await until(() => api(`/api/sessions/${sessionId}`), s => s.cols === 75 && s.rows === 22);
    resumed.send('q');
    await sleep(150);
    resumed.send("printf '\\nTUI_%s\\n' FINISHED\r");
    await resumed.wait('TUI_FINISHED');
    resumed.ws.close(); await once(resumed.ws, 'close');
  });
  await t.test('CLI uses a real TTY, accepts input, and Ctrl+] detaches without killing shell', async () => {
    const client = pty.spawn(process.execPath, ['dist/src/cli.js', 'attach', sessionId], {
      cwd: resolve('.'), cols: 85, rows: 25, name: 'xterm-256color',
      env: { ...process.env, JELLY_URL: `http://127.0.0.1:${port}`, JELLY_TOKEN_FILE: join(dataDir, 'token') } as Record<string, string>,
    });
    let output = '';
    client.onData(data => { output = (output + data).slice(-1024 * 1024); });
    const exited = new Promise<number>(resolve => client.onExit(event => resolve(event.exitCode)));
    try {
      await until(() => api(`/api/sessions/${sessionId}`), s => s.connected);
      // Wait for the CLI's raw-mode setup and the restored screen, not just the server's upgrade.
      await until(async () => output, output => output.includes('TUI_FINISHED'));
      client.write("printf '\\nCLI_%s\\n' VERIFIED\r");
      try { await until(async () => output, output => output.includes('CLI_VERIFIED')); }
      catch { throw new Error('CLI output did not arrive: ' + JSON.stringify(output.slice(-2000))); }
      client.write('\x1d');
      assert.equal(await exited, 0);
      assert.equal((await api(`/api/sessions/${sessionId}`)).status, 'running');
    } finally { try { client.kill(); } catch { /* Already exited. */ } }
  });
  await t.test('natural exit retains history; explicit stop/delete affects only its session', async () => {
    const second = await api(`/api/projects/${projectId}/sessions`, 'POST', { name: 'exiting' }, 201);
    const c = await connect(second.id);
    c.send("printf '\\nEXIT_%s\\n' HISTORY; exit 7\r");
    const state = await until(() => api(`/api/sessions/${second.id}`), s => s.status === 'exited');
    assert.equal(state.exitCode, 7);
    assert.ok((await api(`/api/sessions/${second.id}/history`)).text.includes('EXIT_HISTORY'));
    await connect(second.id, { status: 409 });
    await api(`/api/sessions/${second.id}`, 'DELETE');
    assert.equal((await api(`/api/sessions/${sessionId}`)).status, 'running');
    const stopped = await api(`/api/sessions/${sessionId}/stop`, 'POST');
    assert.equal(stopped.status, 'stopped');
    await api(`/api/sessions/${sessionId}/stop`, 'POST');
    await connect(sessionId, { status: 409 });
    await api(`/api/sessions/${sessionId}`, 'DELETE');
  });
  await t.test('missing tmux session is reported as lost and project deletion preserves files', async () => {
    const lost = await api(`/api/projects/${projectId}/sessions`, 'POST', {}, 201);
    await exec('tmux', ['-S', socket, 'kill-session', '-t', `=jelly-${lost.id}`]);
    assert.equal((await api(`/api/sessions/${lost.id}`)).status, 'lost');
    await api(`/api/sessions/${lost.id}`, 'DELETE');
    await api(`/api/projects/${projectId}`, 'DELETE');
    assert.ok((await stat(projectPath)).isDirectory());
    assert.deepEqual((await api('/api/projects')).projects, []);
  });
});
