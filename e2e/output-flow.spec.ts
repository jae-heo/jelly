import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`${remote ? 'SSH' : 'local'}: rendering acknowledgements pause and resume a flood without replacing the shell`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'flow', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: 'flow', path: remote ? info.remoteRoot : info.projectPath, hostId: host?.id ?? null });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'flow' });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    let held = true, socket: WebSocket | undefined, offset = 0, pending = '';
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols); socket = this;
        this.addEventListener('message', event => {
          const value = JSON.parse(event.data);
          if (value.type === 'output') offset = value.offset;
        });
      }
      override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === 'string' && JSON.parse(data).type === 'ack' && held) { pending = data; return; }
        super.send(data);
      }
    };
    Object.assign(window, {
      flowOffset: () => offset,
      flowCommand: (data: string) => socket?.send(JSON.stringify({ type: 'input', data })),
      flowRelease: () => { held = false; if (pending) socket?.send(pending); },
    });
  });
  let connections = 0, acks = 0;
  page.on('websocket', socket => {
    connections++;
    socket.on('framesent', event => { if (JSON.parse(String(event.payload)).type === 'ack') acks++; });
  });
  try {
    // Seed before React mounts: its initial selection effect may otherwise
    // clear values written between navigation and reload (notably in WebKit).
    await page.addInitScript(({ token, project, session }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', project); localStorage.setItem('jelly-session', session);
    }, { token, project: project.id, session: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await page.evaluate(() => (window as any).flowCommand("head -c 2097152 /dev/zero | tr '\\000' x; printf '\\nBROWSER_FLOW_%s_한글😀\\n' DONE\r"));
    await expect.poll(() => page.evaluate(() => (window as any).flowOffset())).toBeGreaterThanOrEqual(128 * 1024);
    await page.waitForTimeout(200);
    const paused = await page.evaluate(() => (window as any).flowOffset());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).flowOffset())).toBe(paused);
    expect(paused).toBeLessThanOrEqual(512 * 1024);
    expect(acks).toBe(0);
    await page.evaluate(() => (window as any).flowRelease());
    await expect(page.locator('.terminal-slot:visible .xterm-rows')).toContainText('BROWSER_FLOW_DONE_한글😀');
    expect(acks).toBeGreaterThan(0);
    expect(connections).toBe(1);
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
