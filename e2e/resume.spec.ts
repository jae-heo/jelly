import { sendVirtualKey } from './virtual-keyboard';
import { test, expect, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`${remote ? 'SSH' : 'local'}: resume verifies open sockets and replaces stalled transports promptly`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.status() === 204 ? undefined : response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'resume-test', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: '복귀 테스트', path: remote ? info.remoteRoot : info.projectPath, hostId: host?.id ?? null });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: '복귀' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  let tickets = 0;
  let sockets = 0;
  let pongs = 0;
  let holdNextTicket = false;
  let heldTicket: Route | undefined;
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    sockets++;
    socket.on('framereceived', frame => { if (JSON.parse(String(frame.payload)).type === 'pong') pongs++; });
  });
  await page.route('**/api/sessions/*/tickets', route => {
    tickets++;
    if (holdNextTicket) { holdNextTicket = false; heldTicket = route; return; }
    return route.continue();
  });
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    let latest: StallingSocket | undefined;
    class StallingSocket extends NativeWebSocket {
      stalled = false;
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        latest = this;
        // Model a suspended mobile page reporting OPEN without delivering any
        // network events. Only the old socket stalls; new connections are real.
        for (const event of ['message', 'close']) this.addEventListener(event, value => {
          if (this.stalled) value.stopImmediatePropagation();
        });
      }
      get readyState() { return this.stalled ? NativeWebSocket.OPEN : super.readyState; }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) { if (!this.stalled) super.send(data); }
    }
    window.WebSocket = StallingSocket;
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible' });
    Object.assign(window, {
      resumeTestVisibility: (value: boolean) => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
      stallResumeTestSocket: () => { if (latest) latest.stalled = true; },
    });
  });
  const visibility = (hidden: boolean) => page.evaluate(value => (window as any).resumeTestVisibility(value), hidden);
  const live = page.getByRole('textbox', { name: 'Live input', exact: true });
  const connected = () => expect(page.locator('.connection-label')).toHaveText('Connected');
  const command = async (suffix: string) => {
    await live.fill(`printf '\\nRESUME_%s\\n' ${suffix}`);
    await sendVirtualKey(page, 'Enter');
    await expect(page.locator('.xterm-rows')).toContainText(`RESUME_${suffix}`);
  };
  try {
    await page.goto('/');
    await page.evaluate(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId);
      localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.reload();
    await connected();
    await command('BEFORE');
    const initialTickets = tickets;
    const initialSockets = sockets;
    await live.fill('# draft stays');
    await visibility(true);
    await visibility(false);
    await expect.poll(() => pongs).toBe(1);
    await expect(live).toHaveValue('# draft stays');
    await expect(live).toBeFocused();
    expect(tickets).toBe(initialTickets);
    expect(sockets).toBe(initialSockets);
    await live.press('Control+c');

    await visibility(true);
    await page.evaluate(() => (window as any).stallResumeTestSocket());
    const start = Date.now();
    await visibility(false);
    // Repeated browser wake events must share a single probe/reconnection.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect.poll(() => tickets).toBe(initialTickets + 1);
    await connected();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(4_000);
    expect(sockets).toBe(initialSockets + 1);
    await expect(page.locator('.xterm-rows')).toContainText('RESUME_BEFORE');
    await command('AFTER');
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    console.log(`${remote ? 'SSH' : 'local'} simulated stale OPEN → ready: ${elapsed} ms`);

    await page.getByRole('button', { name: 'More', exact: true }).tap();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).tap();
    await expect(page.getByRole('heading', { name: 'Disconnected', exact: true })).toBeVisible();
    const disconnectedTickets = tickets;
    await visibility(true);
    await visibility(false);
    expect(tickets).toBe(disconnectedTickets);
    await expect(page.getByRole('heading', { name: 'Disconnected', exact: true })).toBeVisible();

    // A pending HTTP ticket request must not block a fresh connection on resume.
    holdNextTicket = true;
    await page.locator('.connection-overlay').getByRole('button', { name: 'Reconnect' }).tap();
    await expect.poll(() => !!heldTicket).toBe(true);
    await visibility(true);
    await visibility(false);
    await expect.poll(() => tickets).toBe(disconnectedTickets + 2);
    await connected();
    await heldTicket!.abort().catch(() => {});
    await command('PENDING_RECOVERED');
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await call(`/sessions/${session.id}/stop`, 'POST');
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
