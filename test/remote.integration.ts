import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
  const root = resolve('.data'); await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(join(root, 'remote-test-'));
  const fixture = await sshFixture(dataDir);
  process.env.JELLY_DATA_DIR = dataDir; process.env.JELLY_PORT = '0'; process.env.JELLY_HOST = '127.0.0.1'; process.env.JELLY_SSH_CONFIG = fixture.config;
  const config = loadConfig();
  let app = await startServer(config); config.port = app.port;
  const url = `http://127.0.0.1:${app.port}`;
  const sockets: WebSocket[] = [];
  t.after(async () => {
    sockets.forEach(socket => socket.terminate());
    await app.close(); await fixture.close();
    assert.ok(dataDir.startsWith(root + '/remote-test-'));
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
  await t.test('backend restart and unreachable server preserve remote session identity', async () => {
    const attached = await attach(); const closed = once(attached.ws, 'close');
    await app.close(); assert.equal((await closed)[0], 1012);
    app = await startServer(config);
    assert.equal((await request(`/api/sessions/${session.id}`)).pid, session.pid);
    await fixture.stop();
    try {
      assert.equal((await request(`/api/sessions/${session.id}`)).status, 'unreachable');
      await request(`/api/sessions/${session.id}/tickets`, 'POST', undefined, 502);
      await request(`/api/sessions/${session.id}/stop`, 'POST', undefined, 502);
      assert.equal(app.store.session(session.id)?.stoppedAt, null);
    } finally { await fixture.start(); }
    assert.equal((await request(`/api/sessions/${session.id}`)).pid, session.pid);
    const resumed = await attach(); await until(() => resumed.output().includes('BACKGROUND_SURVIVED'));
    resumed.ws.close(); await once(resumed.ws, 'close');
  });
  await t.test('explicit remote stop and deletion leave unrelated tmux untouched', async () => {
    assert.equal((await request(`/api/sessions/${session.id}/stop`, 'POST')).status, 'stopped');
    await request(`/api/sessions/${session.id}`, 'DELETE');
    await request(`/api/projects/${project.id}`, 'DELETE');
    await request(`/api/hosts/${host.id}`, 'DELETE');
    assert.match(await fixture.command('tmux', '-L', 'unrelated-test-server', 'list-sessions'), /unrelated/);
    assert.match(await fixture.command('sh', '-c', 'test -d "$1" && printf kept', 'jelly', remotePath), /kept/);
  });
});
