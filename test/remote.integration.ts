import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { sshFixture } from './ssh-fixture.js';
import { RemoteTmux } from '../src/remote.js';

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, timeout = 10_000) {
  const start = Date.now();
  while (!await check()) { if (Date.now() - start > timeout) throw new Error('Remote test timed out'); await sleep(50); }
}

test('agentless SSH projects and persistent remote terminals', { timeout: 180_000 }, async t => {
  // Keep OpenSSH control sockets short even in deeply nested CI checkouts.
  const prefix = join(tmpdir(), 'jelly-remote-');
  const dataDir = await mkdtemp(prefix);
  const fixture = await sshFixture(dataDir);
  process.env.JELLY_DATA_DIR = dataDir; process.env.JELLY_PORT = '0'; process.env.JELLY_HOST = '127.0.0.1'; process.env.JELLY_SSH_CONFIG = fixture.config;
  const config = loadConfig();
  let app = await startServer(config); config.port = app.port;
  const url = `http://127.0.0.1:${app.port}`;
  const sockets: WebSocket[] = [];
  t.after(async () => {
    sockets.forEach(socket => socket.terminate());
    await app.close(); await fixture.close();
    assert.ok(dataDir.startsWith(prefix));
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = async (path: string, method = 'GET', body?: unknown, status = 200, auth = true) => {
    const response = await fetch(url + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${config.token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    assert.equal(response.status, status, JSON.stringify(result)); return result;
  };
  let host: any;
  let project: any;
  let session: any;
  const remotePath = '/workspaces/원격 \'quote\'; dollar$ & space';
  async function attach(initial = '', id = session.id) {
    const { ticket } = await request(`/api/sessions/${id}/tickets`, 'POST', undefined, 201);
    const ws = new WebSocket(url.replace('http:', 'ws:') + `/api/sessions/${id}/terminal?ticket=${ticket}&cols=90&rows=28`);
    sockets.push(ws);
    let output = ''; let ready = false;
    ws.on('error', () => {});
    ws.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.type === 'ready') ready = true; if (message.type === 'output') output += message.data; });
    if (initial) ws.once('open', () => ws.send(JSON.stringify({ type: 'input', data: initial })));
    await once(ws, 'open'); await until(() => ready);
    return { ws, output: () => output, send: (data: string) => ws.send(JSON.stringify({ type: 'input', data })) };
  }
  await t.test('aliases, authentication, host registration and remote-only folders', async () => {
    await request('/api/ssh/aliases', 'GET', undefined, 401, false);
    assert.deepEqual((await request('/api/ssh/aliases')).aliases, ['extra-alias', 'included-alias', 'jelly-offline', 'jelly-remote']);
    await request('/api/hosts', 'POST', { name: 'Invalid', target: 'foo -oProxyCommand=bad' }, 400);
    host = await request('/api/hosts', 'POST', { name: 'Remote', target: 'jelly-remote' }, 201);
    assert.equal((await request(`/api/hosts/${host.id}/check`, 'POST')).status, 'ok');
    await fixture.command('mkdir', '-p', remotePath, '/workspaces/.hidden', '/workspaces/line\nbreak');
    await fixture.command('touch', '/workspaces/file.txt');
    const query = '/api/directories?' + new URLSearchParams({ hostId: host.id, path: '/workspaces', hidden: 'true' });
    const listing = await request(query);
    assert.equal(listing.path, '/workspaces');
    assert.ok(listing.directories.some((entry: any) => entry.path === remotePath));
    assert.ok(listing.directories.some((entry: any) => entry.name === 'line\nbreak'));
    assert.ok(!listing.directories.some((entry: any) => entry.name === 'file.txt'));
    project = await request('/api/projects', 'POST', { name: 'Remote work', path: remotePath, hostId: host.id }, 201);
    assert.equal(project.path, remotePath);
    assert.equal(project.hostId, host.id);
    await request('/api/projects', 'POST', { name: 'duplicate', path: remotePath, hostId: host.id }, 409);
    await request(`/api/hosts/${host.id}`, 'DELETE', undefined, 409);
    await request('/api/hosts/check', 'POST', { name: 'Offline', target: 'jelly-offline' }, 502);
    // Strict host key verification also applies when user SSH config would otherwise accept a host.
    const knownHosts = join(fixture.directory, 'known_hosts');
    const known = await readFile(knownHosts, 'utf8'); await writeFile(knownHosts, '');
    try { assert.equal((await request(`/api/hosts/${host.id}/check`, 'POST', undefined, 502)).error, 'SSH_HOST_KEY'); }
    finally { await writeFile(knownHosts, known); }
  });
  await t.test('remote project files: preview, binary downloads and project boundary', async () => {
    const filename = "보고서 'quote'; $ &\n.txt";
    await fixture.command('mkdir', '-p', remotePath + '/nested');
    await fixture.command('sh', '-c', 'printf "remote file\\n" > "$1"; printf "\\000\\377ABC" > "$2"; ln -s /etc/passwd "$3"; ln -s /etc "$4"', 'fixture', remotePath + '/nested/' + filename, remotePath + '/binary.bin', remotePath + '/escape.txt', remotePath + '/outside');
    const base = `/api/projects/${project.id}`;
    const listed = await request(base + '/files?path=nested');
    assert.equal(listed.entries[0].name, filename);
    assert.equal(listed.parent, '');
    const preview = await fetch(url + base + '/preview?' + new URLSearchParams({ path: 'nested/' + filename }), { headers: { Authorization: `Bearer ${config.token}` } });
    assert.equal(preview.status, 200); assert.equal(await preview.text(), 'remote file\n');
    for (const path of ['escape.txt', 'outside/passwd']) await request(base + '/downloads', 'POST', { path }, 403);
    await request(base + '/downloads', 'POST', { path: '../etc/passwd' }, 400);
    await request(base + '/downloads', 'POST', { path: 'nested' }, 404);
    const grant = await request(base + '/downloads', 'POST', { path: 'binary.bin' }, 201);
    const response = await fetch(url + grant.url);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 255, 65, 66, 67]));
    await request(grant.url, 'GET', undefined, 401, false);
    const knownHosts = join(fixture.directory, 'known_hosts');
    const known = await readFile(knownHosts, 'utf8'); await writeFile(knownHosts, '');
    try { assert.equal((await request(base + '/files', 'GET', undefined, 502)).error, 'SSH_HOST_KEY'); }
    finally { await writeFile(knownHosts, known); }
  });
  await t.test('remote PTY input, Unicode, resize, handoff and detach persistence', async () => {
    await fixture.command('tmux', '-L', 'unrelated-test-server', 'new-session', '-d', '-s', 'unrelated');
    session = await request(`/api/projects/${project.id}/sessions`, 'POST', { name: 'Remote session' }, 201);
    assert.equal(session.status, 'running');
    await fixture.command('tmux', '-L', `jelly-${config.instanceId}`, 'set-option', '-t', `jelly-${session.id}`, 'mouse', 'off');
    const first = await attach("printf '\\nREMOTE_%s\\n' EARLY\r");
    await until(() => first.output().includes('REMOTE_EARLY'));
    assert.equal((await fixture.command('tmux', '-L', `jelly-${config.instanceId}`, 'show-options', '-v', '-t', `jelly-${session.id}`, 'mouse')).trim(), 'on');
    first.send("printf '\\n%s%s\\n' '한글' 'SSH확인'\r");
    await until(() => first.output().includes('한글SSH확인'));
    first.send("stty raw -echo; printf '\\nSHIFT_%s\\n' READY; dd bs=1 count=7 2>/dev/null | od -An -tx1; stty sane; printf '\\nSHIFT_%s\\n' DONE\r");
    await until(() => first.output().includes('SHIFT_READY'));
    first.send('\x1b[13;2u');
    await until(() => first.output().includes('SHIFT_DONE'));
    assert.ok(first.output().includes('1b 5b 31 33 3b 32 75'), 'remote tmux must preserve Shift+Enter rather than converting it to Enter');
    first.ws.send(JSON.stringify({ type: 'resize', cols: 67, rows: 21 }));
    await until(async () => (await request(`/api/sessions/${session.id}`)).cols === 67);
    const closed = once(first.ws, 'close');
    const second = await attach();
    assert.equal((await closed)[0], 4001);
    second.send("sleep 0.4; printf '\\nBACKGROUND_%s\\n' SURVIVED\r");
    // Let input reach the remote shell before detaching.
    await until(() => second.output().includes('sleep 0.4'));
    second.ws.close(); await once(second.ws, 'close'); await sleep(650);
    const third = await attach();
    await until(() => third.output().includes('BACKGROUND_SURVIVED'));
    third.ws.close(); await once(third.ws, 'close');
    assert.equal((await request(`/api/sessions/${session.id}`)).pid, session.pid);
    assert.ok((await request(`/api/sessions/${session.id}/history`)).text.includes('한글SSH확인'));
  });
  await t.test('sessions share a private SSH transport and reconnect after its loss', async () => {
    const remote = new RemoteTmux(config, host);
    // Ask OpenSSH to parse our effective policy without opening a connection.
    const effective = await exec('ssh', ['-G', ...remote.args(false)]);
    assert.match(effective.stdout, /^controlpersist 1200$/m);
    const fresh = await exec('ssh', ['-G', ...remote.args(false, false)]);
    assert.match(fresh.stdout, /^controlmaster false$/m);
    assert.ok(!/^controlpath /m.test(fresh.stdout));
    assert.ok(remote.controlPath.startsWith(dataDir + '/ssh-'));
    assert.notEqual(new RemoteTmux(config, { ...host, port: fixture.port }).controlPath, remote.controlPath);
    assert.notEqual(new RemoteTmux(config, { ...host, identityFile: '/different-key' }).controlPath, remote.controlPath);
    const master = async () => {
      const result = await exec('ssh', ['-F', fixture.config, '-S', remote.controlPath, '-O', 'check', host.target]);
      const pid = /Master running \(pid=(\d+)\)/.exec(result.stderr)?.[1];
      assert.ok(pid); return pid;
    };
    const originalMaster = await master();
    const secondSession = await request(`/api/projects/${project.id}/sessions`, 'POST', { name: 'Second remote session' }, 201);
    const first = await attach();
    const second = await attach('', secondSession.id);
    try {
      first.send("printf '\\nSHARED_FIRST_%s\\n' OK\r");
      second.send("printf '\\nSHARED_SECOND_%s\\n' OK\r");
      await until(() => first.output().includes('SHARED_FIRST_OK') && second.output().includes('SHARED_SECOND_OK'));
      assert.equal(await master(), originalMaster);
      const firstClosed = once(first.ws, 'close'); first.ws.close(); await firstClosed;
      second.send("printf '\\nOTHER_SESSION_%s\\n' SURVIVED\r");
      await until(() => second.output().includes('OTHER_SESSION_SURVIVED'));
      assert.equal(await master(), originalMaster);
      const secondClosed = once(second.ws, 'close'); second.ws.close(); await secondClosed;
      // Drop only this fixture's idle master. Persistent remote shells must
      // survive, and the next attachment must establish a fresh connection.
      await exec('ssh', ['-F', fixture.config, '-S', remote.controlPath, '-O', 'exit', host.target]);
      const resumed = await attach();
      await until(() => resumed.output().includes('SHARED_FIRST_OK'));
      assert.notEqual(await master(), originalMaster);
      assert.equal((await request(`/api/sessions/${session.id}`)).pid, session.pid);
      assert.equal((await request(`/api/sessions/${secondSession.id}`)).pid, secondSession.pid);
      const resumedClosed = once(resumed.ws, 'close'); resumed.ws.close(); await resumedClosed;
    } finally {
      first.ws.terminate(); second.ws.terminate();
      await request(`/api/sessions/${secondSession.id}`, 'DELETE');
    }
  });
  await t.test('cascade deletion stops only the selected project and preserves remote files', async () => {
    const path = '/workspaces/cascade-test';
    await fixture.command('mkdir', '-p', path);
    await fixture.command('touch', path + '/keep.txt');
    const p = await request('/api/projects', 'POST', { name: 'Cascade', path, hostId: host.id }, 201);
    const a = await request(`/api/projects/${p.id}/sessions`, 'POST', { name: 'A' }, 201);
    const b = await request(`/api/projects/${p.id}/sessions`, 'POST', { name: 'B' }, 201);
    await request(`/api/sessions/${b.id}/move`, 'POST', { beforeId: a.id });
    assert.deepEqual((await request(`/api/projects/${p.id}/sessions`)).sessions.map((s: any) => s.id), [b.id, a.id]);
    await request(`/api/projects/${p.id}?deleteSessions=true`, 'DELETE');
    for (const child of [a, b]) {
      await request(`/api/sessions/${child.id}`, 'GET', undefined, 404);
      await assert.rejects(fixture.command('tmux', '-L', `jelly-${config.instanceId}`, 'has-session', '-t', `=jelly-${child.id}`));
    }
    await fixture.command('test', '-f', path + '/keep.txt');
    assert.equal((await request(`/api/sessions/${session.id}`)).pid, session.pid);
    await fixture.command('tmux', '-L', 'unrelated-test-server', 'has-session', '-t', 'unrelated');
  });
  await t.test('slow remote mutation does not delay local work; same-host deletion stays ordered', async () => {
    const localPath = join(dataDir, 'local-project');
    await mkdir(localPath);
    const localProject = await request('/api/projects', 'POST', { name: 'Independent local', path: localPath }, 201);
    const directory = app.tmux.directory.bind(app.tmux);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    app.tmux.directory = async (path, hostId) => {
      if (hostId === host.id) { entered(); await blocked; }
      return directory(path, hostId);
    };
    let localSession: any;
    const remoteCreation = request(`/api/projects/${project.id}/sessions`, 'POST', { name: 'Delayed remote' }, 201);
    await started;
    const deletion = request(`/api/projects/${project.id}`, 'DELETE', undefined, 409);
    const deadline = setTimeout(release, 2000);
    try {
      const start = Date.now();
      localSession = await request(`/api/projects/${localProject.id}/sessions`, 'POST', { name: 'Independent' }, 201);
      assert.ok(Date.now() - start < 1500, 'Local creation must not wait for the remote mutation');
    } finally {
      clearTimeout(deadline); release(); app.tmux.directory = directory;
      const remoteSession = await remoteCreation;
      await deletion;
      await request(`/api/sessions/${remoteSession.id}`, 'DELETE');
      if (localSession) await request(`/api/sessions/${localSession.id}`, 'DELETE');
      await request(`/api/projects/${localProject.id}`, 'DELETE');
    }
  });
  await t.test('backend restart and unreachable server preserve remote session identity', async () => {
    const attached = await attach(); const closed = once(attached.ws, 'close');
    await app.close(); assert.equal((await closed)[0], 1012);
    app = await startServer(config);
    assert.equal((await request(`/api/sessions/${session.id}`)).pid, session.pid);
    await fixture.stop();
    try {
      assert.equal((await request(`/api/sessions/${session.id}`)).status, 'unreachable');
      assert.equal((await request(`/api/projects/${project.id}`, 'PATCH', { name: 'Offline project' })).name, 'Offline project');
      assert.equal((await request(`/api/sessions/${session.id}`, 'PATCH', { name: 'Offline session' })).name, 'Offline session');
      await request(`/api/sessions/${session.id}/tickets`, 'POST', undefined, 502);
      await request(`/api/sessions/${session.id}/stop`, 'POST', undefined, 502);
      assert.equal(app.store.session(session.id)?.stoppedAt, null);
    } finally { await fixture.start(); }
    assert.equal((await request(`/api/sessions/${session.id}`)).pid, session.pid);
    const resumed = await attach(); await until(() => resumed.output().includes('BACKGROUND_SURVIVED'));
    resumed.ws.close(); await once(resumed.ws, 'close');
  });
  await t.test('explicit remote stop and deletion leave unrelated tmux untouched', async () => {
    await fixture.command('tmux', '-L', `jelly-${config.instanceId}`, 'set-option', '-s', 'exit-empty', 'off');
    assert.equal((await request(`/api/sessions/${session.id}/stop`, 'POST')).status, 'stopped');
    const renamed = await request(`/api/sessions/${session.id}`, 'PATCH', { name: 'Stopped session' });
    assert.equal(renamed.name, 'Stopped session');
    assert.ok(renamed.stoppedAt);
    await request(`/api/sessions/${session.id}`, 'DELETE');
    await request(`/api/projects/${project.id}`, 'DELETE');
    await request(`/api/hosts/${host.id}`, 'DELETE');
    assert.match(await fixture.command('tmux', '-L', 'unrelated-test-server', 'list-sessions'), /unrelated/);
    assert.match(await fixture.command('sh', '-c', 'test -d "$1" && printf kept', 'jelly', remotePath), /kept/);
  });
});
