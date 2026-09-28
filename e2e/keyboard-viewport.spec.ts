import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`keyboard viewport: ${remote ? 'SSH' : 'local'} keeps the visible tail and settles once`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'Keyboard SSH', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: 'Keyboard viewport', path: remote ? info.remoteRoot : info.projectPath, hostId: host?.id });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Stable terminal' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let connections = 0;
  const sizes: { cols: number; rows: number }[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    connections++;
    socket.on('framesent', event => {
      const message = JSON.parse(String(event.payload));
      if (message.type === 'resize') sizes.push(message);
    });
  });
  try {
    await page.goto('/');
    await page.evaluate(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId);
      localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.reload();
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await page.getByRole('button', { name: '입력창 표시', exact: true }).click();
    const input = page.getByLabel('명령어 또는 메시지');
    await input.fill('i=1; while [ "$i" -le 160 ]; do printf "KEYBOARD_%03d\\n" "$i"; i=$((i+1)); done');
    await page.getByRole('button', { name: '입력 보내기' }).click();
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect(page.locator('.xterm-rows')).toContainText('KEYBOARD_160');
    // Let startup sizing finish before measuring a keyboard animation.
    await page.waitForTimeout(400);
    const connected = connections;
    const originalRows = (await call(`/sessions/${session.id}`)).rows;
    sizes.length = 0;
    // Chromium cannot open an OS keyboard headlessly. Model visualViewport
    // events, including animation pauses longer than the old 120 ms fit timer.
    const clippedFrames = await page.evaluate(async () => {
      const viewport = visualViewport!;
      let height = viewport.height;
      let top = 0;
      Object.defineProperty(viewport, 'height', { configurable: true, get: () => height });
      Object.defineProperty(viewport, 'offsetTop', { configurable: true, get: () => top });
      let clipped = 0;
      for (const [nextHeight, nextTop] of [[760, 12], [640, 35], [530, 60], [460, 80]]) {
        height = nextHeight!; top = nextTop!;
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const container = document.querySelector('.terminal-viewport')!.getBoundingClientRect();
        const line = [...document.querySelectorAll('.xterm-rows > div')].find(el => el.textContent?.includes('KEYBOARD_160'));
        if (!line || line.getBoundingClientRect().bottom > container.bottom + 1) clipped++;
        await new Promise(resolve => setTimeout(resolve, 160));
      }
      return clipped;
    });
    expect(clippedFrames, 'Latest output must stay above the keyboard during animation').toBe(0);
    await expect.poll(async () => (await call(`/sessions/${session.id}`)).rows).toBeLessThan(originalRows);
    expect(sizes, 'One PTY redraw after the animation settles').toHaveLength(1);
    await expect(input).toBeFocused();
    await expect(page.locator('.xterm-rows')).toContainText('KEYBOARD_160');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Reading tmux history must stay in the same region when the keyboard closes.
    await page.locator('.xterm-screen').hover();
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -250);
    await expect(page.locator('.xterm-rows')).not.toContainText('KEYBOARD_160');
    const historyLines = async () => ((await page.locator('.xterm-rows').innerText()).match(/KEYBOARD_\d{3}/g) ?? []);
    const before = await historyLines();
    expect(before.length).toBeGreaterThan(3);
    sizes.length = 0;
    const closingDrift = await page.evaluate(async () => {
      const viewport = visualViewport!;
      let drift = 0;
      for (const height of [530, 640, 760, 844]) {
        Object.defineProperty(viewport, 'height', { configurable: true, value: height });
        Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 0 });
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const container = document.querySelector('.terminal-viewport')!.getBoundingClientRect();
        const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect();
        drift = Math.max(drift, Math.abs(container.bottom - screen.bottom));
        await new Promise(resolve => setTimeout(resolve, 160));
      }
      return drift;
    });
    expect(closingDrift, 'Closing the keyboard must keep the existing screen anchored').toBeLessThan(1);
    await expect.poll(async () => (await call(`/sessions/${session.id}`)).rows).toBe(originalRows);
    expect(sizes).toHaveLength(1);
    const after = await historyLines();
    expect(after.filter(line => before.includes(line)).length).toBeGreaterThan(3);
    await page.getByRole('button', { name: 'Esc', exact: true }).click();
    await expect(page.locator('.xterm-rows')).toContainText('KEYBOARD_160');
    // Android-style keyboards resize the layout viewport too.
    await page.evaluate(() => {
      for (const key of ['height', 'offsetTop']) Reflect.deleteProperty(visualViewport!, key);
      visualViewport!.dispatchEvent(new Event('resize'));
    });
    sizes.length = 0;
    for (const height of [740, 620, 500, 460]) {
      await page.setViewportSize({ width: 390, height });
      await page.waitForTimeout(80);
    }
    await expect.poll(async () => (await call(`/sessions/${session.id}`)).rows).toBeLessThan(originalRows);
    expect(sizes).toHaveLength(1);
    await expect(input).toBeFocused();
    await expect(page.locator('.xterm-rows')).toContainText('KEYBOARD_160');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(connections).toBe(connected);
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
