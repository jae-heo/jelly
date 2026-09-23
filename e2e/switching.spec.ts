import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`${remote ? 'SSH' : 'local'}: recent sessions keep their terminals and connections, with bounded eviction`, async ({ browser, request }) => {
  test.setTimeout(60_000);
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.status() === 204 ? undefined : response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'switch-test', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: '전환 테스트', path: remote ? info.remoteRoot : info.projectPath, hostId: host?.id ?? null });
  const sessions: { id: string; name: string; pid: number }[] = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const peer = await other.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  peer.on('pageerror', error => errors.push(error.message));
  let tickets = 0;
  let sockets = 0;
  let blockTickets = false;
  const resizes = new Map<string, number>();
  await page.addInitScript(() => {
    const sockets = new Map<string, WebSocket>();
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.set(new URL(String(url), location.href).pathname, this);
      }
    };
    Object.assign(window, { dropTestSocket: (id: string) => sockets.get(`/api/sessions/${id}/terminal`)?.close(4002, 'Test network interruption') });
  });
  page.on('websocket', socket => {
    sockets++;
    const id = new URL(socket.url()).pathname.split('/')[3]!;
    socket.on('framesent', event => {
      if (JSON.parse(String(event.payload)).type === 'resize') resizes.set(id, (resizes.get(id) ?? 0) + 1);
    });
  });
  await page.route('**/api/sessions/*/tickets', route => {
    tickets++;
    return blockTickets ? route.abort() : route.continue();
  });
  const seed = async (target: Page, id: string) => {
    await target.goto('/');
    await target.evaluate(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId);
      localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: id });
    await target.reload();
    await expect(target.locator('.connection-label')).toHaveText('연결됨');
  };
  const choose = async (index: number, connected = true) => {
    await page.getByRole('button', { name: '프로젝트와 세션 열기' }).tap();
    await page.getByRole('button', { name: new RegExp(sessions[index]!.name) }).tap();
    if (connected) {
      await expect(page.locator('.connection-label')).toHaveText('연결됨').catch(error => {
        expect(errors, 'Browser errors during session selection').toEqual([]);
        throw error;
      });
    }
  };
  const visibleTerminal = () => page.locator('.terminal-slot:visible .xterm-rows');
  const command = async (value: string) => {
    await page.getByRole('button', { name: '입력창 표시', exact: true }).tap();
    await page.getByLabel('명령어 또는 메시지').fill(value);
    await page.getByRole('button', { name: '입력 보내기' }).tap();
    await page.getByRole('button', { name: 'Enter', exact: true }).tap();
    await page.getByRole('button', { name: '입력창 숨기기', exact: true }).tap();
  };
  try {
    for (const name of ['전환 A', '전환 B', '전환 C', '전환 D']) sessions.push(await call(`/projects/${project.id}/sessions`, 'POST', { name }));
    await seed(page, sessions[0]!.id);
    await command("printf '\\nCACHE_%s\\n' ALPHA");
    await expect(visibleTerminal()).toContainText('CACHE_ALPHA');
    await choose(1);
    await command("printf '\\nCACHE_%s\\n' BRAVO");
    await expect(visibleTerminal()).toContainText('CACHE_BRAVO');
    const opened = sockets;
    const requested = tickets;
    // A warm switch must work even when new ticket requests cannot succeed.
    blockTickets = true;
    for (const index of [0, 1, 1, 0]) {
      await choose(index);
      await expect(visibleTerminal()).toContainText(index ? 'CACHE_BRAVO' : 'CACHE_ALPHA');
      await expect(visibleTerminal()).not.toContainText(index ? 'CACHE_ALPHA' : 'CACHE_BRAVO');
    }
    expect(sockets).toBe(opened);
    expect(tickets).toBe(requested);
    await expect(page.locator('.terminal-slot')).toHaveCount(2);

    // Hidden connections must not receive size changes or steal keyboard focus.
    const hiddenResizes = resizes.get(sessions[1]!.id);
    const before = await call(`/sessions/${sessions[0]!.id}`);
    await page.setViewportSize({ width: 320, height: 620 });
    await expect.poll(async () => (await call(`/sessions/${sessions[0]!.id}`)).cols).toBeLessThan(before.cols);
    expect(resizes.get(sessions[1]!.id)).toBe(hiddenResizes);
    await choose(1);
    await expect.poll(async () => (await call(`/sessions/${sessions[1]!.id}`)).cols).toBe((await call(`/sessions/${sessions[0]!.id}`)).cols);
    await command("printf '\\nROUTED_%s\\n' BRAVO");
    await expect(visibleTerminal()).toContainText('ROUTED_BRAVO');
    expect((await call(`/sessions/${sessions[0]!.id}/history?lines=100`)).text).not.toContain('ROUTED_BRAVO');
    await choose(0);

    // A second device takes a cached, hidden session. Merely selecting it again
    // must not seize it back or enter a reconnect loop; the button is explicit.
    await seed(peer, sessions[1]!.id);
    await choose(1, false);
    await expect(page.getByRole('heading', { name: '다른 기기에서 접속 중', exact: true })).toBeVisible();
    await expect(peer.locator('.connection-label')).toHaveText('연결됨');
    expect(tickets).toBe(requested);
    blockTickets = false;
    await page.locator('.connection-overlay').getByRole('button', { name: '다시 연결' }).tap();
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await expect(peer.getByRole('heading', { name: '다른 기기에서 접속 중', exact: true })).toBeVisible();
    await other.close();

    // A hidden dropped socket waits until selected before reconnecting.
    await choose(0);
    const beforeDrop = tickets;
    await page.evaluate(id => (window as unknown as { dropTestSocket: (id: string) => void }).dropTestSocket(id), sessions[1]!.id);
    await expect.poll(async () => (await call(`/sessions/${sessions[1]!.id}`)).connected).toBe(false);
    // Longer than the initial retry delay: inactive sessions must not retry.
    await page.waitForTimeout(850);
    expect(tickets).toBe(beforeDrop);
    await choose(1);
    await expect(visibleTerminal()).toContainText('CACHE_BRAVO');
    expect(tickets).toBe(beforeDrop + 1);

    // Four visited sessions retain only three. Eviction closes just the client;
    // returning to the evicted session reconnects to its original shell.
    await choose(2);
    await choose(3);
    await expect(page.locator('.terminal-slot')).toHaveCount(3);
    await expect.poll(async () => (await call(`/sessions/${sessions[0]!.id}`)).connected).toBe(false);
    const beforeEvictedReturn = sockets;
    await choose(0);
    await expect(visibleTerminal()).toContainText('CACHE_ALPHA');
    expect(sockets).toBe(beforeEvictedReturn + 1);
    for (const session of sessions) {
      const current = await call(`/sessions/${session.id}`);
      expect(current.pid).toBe(session.pid);
      expect(current.status).toBe('running');
    }

    // Disconnect affects the selected client, and logout closes every cached one.
    await page.getByRole('button', { name: '더 보기', exact: true }).tap();
    await page.getByRole('button', { name: '연결 끊기', exact: true }).tap();
    await expect(page.getByRole('heading', { name: '연결 끊김', exact: true })).toBeVisible();
    await expect.poll(async () => (await call(`/sessions/${sessions[0]!.id}`)).connected).toBe(false);
    expect((await call(`/sessions/${sessions[3]!.id}`)).connected).toBe(true);
    await page.locator('.connection-overlay').getByRole('button', { name: '다시 연결' }).tap();
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    if (!remote) {
      // A desktop pointer restores direct typing when revealing a cached terminal.
      await page.evaluate(() => {
        const native = window.matchMedia.bind(window);
        window.matchMedia = query => query === '(pointer: fine)' ? Object.defineProperty(native(query), 'matches', { value: true }) : native(query);
      });
      await choose(3);
      await expect(page.locator('.terminal-slot:visible .xterm-helper-textarea')).toBeFocused();
      await choose(0);
      await expect(page.locator('.terminal-slot:visible .xterm-helper-textarea')).toBeFocused();
    }
    const beforeStop = sockets;
    await page.getByRole('button', { name: '더 보기', exact: true }).tap();
    await page.getByRole('button', { name: '세션 종료', exact: true }).tap();
    await page.getByRole('dialog').getByRole('button', { name: '세션 종료', exact: true }).tap();
    await expect(page.getByRole('heading', { name: '세션 종료됨' })).toBeVisible();
    await choose(3);
    expect(sockets).toBe(beforeStop);
    await page.getByRole('button', { name: '더 보기', exact: true }).tap();
    await page.getByRole('button', { name: '로그아웃', exact: true }).tap();
    await expect(page.getByRole('heading', { name: '서버 연결', exact: true })).toBeVisible();
    await expect.poll(async () => (await call('/sessions')).sessions.filter((row: { projectId: string; connected: boolean }) => row.projectId === project.id && row.connected).length).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await other.close();
    for (const session of sessions) {
      await call(`/sessions/${session.id}/stop`, 'POST');
      await call(`/sessions/${session.id}`, 'DELETE');
    }
    await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
