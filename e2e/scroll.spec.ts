import { sendVirtualKey } from './virtual-keyboard';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function swipe(page: Page, direction: 'older' | 'newer', hold = 0, fast = false) {
  const screen = await page.locator('.xterm-screen').boundingBox();
  if (!screen) throw new Error('Terminal screen not visible');
  const cdp = page.context().browser()?.browserType().name() === 'chromium' ? await page.context().newCDPSession(page) : null;
  const x = screen.x + screen.width / 2;
  const from = screen.y + screen.height * (direction === 'older' ? 0.2 : 0.8);
  const to = screen.y + screen.height * (direction === 'older' ? 0.8 : 0.2);
  const dispatch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) => {
    if (cdp) return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    // WebKit automation exposes taps, but no swipe injection or Touch
    // constructor. Model touch data while exercising the real app and tmux.
    await page.locator('.xterm-screen').evaluate((element, { type, x, y }) => {
      const touch = { identifier: 1, target: element, clientX: x, clientY: y };
      const event = new Event(type.toLowerCase(), { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === 'touchEnd' ? [] : [touch] }, changedTouches: { value: [touch] } });
      element.dispatchEvent(event);
    }, { type, x, y });
  };
  try {
    await dispatch('touchStart', from);
    const steps = fast ? 6 : 12;
    for (let step = 1; step <= steps; step++) {
      await dispatch('touchMove', from + (to - from) * step / steps);
      await page.waitForTimeout(fast ? 8 : 16);
    }
    if (hold) await page.waitForTimeout(hold);
    await dispatch('touchEnd', to);
  } finally { await cdp?.detach(); }
}

for (const remote of [false, true]) {
  test(`mobile touch scroll: ${remote ? 'SSH' : 'local'} history, reconnect and input`, async ({ browser, request }) => {
    const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
    const token = readFileSync(info.tokenFile, 'utf8').trim();
    const headers = { Authorization: `Bearer ${token}` };
    const call = async (path: string, method = 'GET', data?: unknown) => {
      const response = await request.fetch(`/api${path}`, { method, headers, data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.status() === 204 ? undefined : response.json();
    };
    const host = remote ? await call('/hosts', 'POST', { name: 'Scroll SSH', target: 'jelly-remote' }) : null;
    const project = await call('/projects', 'POST', {
      name: 'A project with a long name that should fit the compact workspace header', path: remote ? info.remoteRoot + '/remote-project' : info.projectPath, hostId: host?.id,
    });
    const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'A running terminal with a long session name that must not push the menu offscreen' });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    let inputs = 0;
    page.on('websocket', socket => socket.on('framesent', frame => {
      if (JSON.parse(String(frame.payload)).type === 'input') inputs++;
    }));
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(({ token, projectId, sessionId }) => {
        sessionStorage.setItem('jelly-token', token);
        localStorage.setItem('jelly-project', projectId);
        localStorage.setItem('jelly-session', sessionId);
      }, { token, projectId: project.id, sessionId: session.id });
      await page.goto('/');
      await expect(page.locator('.connection-label')).toHaveText('Connected');
      await page.setViewportSize({ width: 320, height: 568 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Select text', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'More', exact: true })).toBeInViewport();
      await page.setViewportSize({ width: 390, height: 844 });
      const rows = page.locator('.xterm-rows');
      const firstLine = async () => {
        const values = (await rows.innerText()).match(/SCROLL_\d{3}/g) ?? [];
        return Math.min(...values.map(value => Number(value.slice(7))));
      };
      // Exercise vi copy mode on this test session's own tmux socket, including
      // when the browser is running in a separate container.
      await page.getByRole('textbox', { name: 'Input', exact: true }).focus();
      await page.getByRole('textbox', { name: 'Input', exact: true }).fill('tmux -S "${TMUX%%,*}" set-window-option -t "$TMUX_PANE" mode-keys vi; i=1; while [ "$i" -le 120 ]; do printf "SCROLL_%03d\\n" "$i"; i=$((i+1)); done');
      await sendVirtualKey(page, 'Enter');
      await expect(rows).toContainText('SCROLL_120');
      const latest = await firstLine();
      await page.getByRole('button', { name: 'Hide keyboard', exact: true }).click();
      await swipe(page, 'older');
      const released = inputs;
      await expect.poll(() => inputs).toBeGreaterThan(released);
      // Catching momentum only stops scrolling; it must not open the keyboard.
      await page.locator('.xterm-screen').tap();
      await page.waitForTimeout(50);
      const stopped = inputs;
      await page.waitForTimeout(300);
      expect(inputs).toBe(stopped);
      await expect(page.getByRole('textbox', { name: 'Input', exact: true })).not.toBeFocused();
      await expect.poll(firstLine).toBeLessThan(latest - 3);
      // A swipe must not focus the terminal or change the outer page's scroll position.
      expect(await page.locator('.xterm-helper-textarea').evaluate(el => el === document.activeElement)).toBe(false);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const older = await firstLine();
      await swipe(page, 'newer');
      await expect.poll(firstLine).toBeGreaterThan(older);
      // Scrolling down to the live screen leaves copy mode; ordinary input works again.
      await swipe(page, 'newer');
      await page.getByRole('textbox', { name: 'Input', exact: true }).fill("printf 'AFTER_SCROLL_%s\\n' OK");
      await sendVirtualKey(page, 'Enter');
      await expect(rows).toContainText('AFTER_SCROLL_OK');
      await page.reload();
      await expect(page.locator('.connection-label')).toHaveText('Connected');
      const reconnected = await firstLine();
      await swipe(page, 'older');
      await expect.poll(firstLine).toBeLessThan(reconnected - 3);
      // The existing Esc key is another way to leave scrollback immediately.
      await sendVirtualKey(page, 'Esc');
      await expect(rows).toContainText('AFTER_SCROLL_OK');
      const afterEscape = inputs;
      await page.waitForTimeout(300);
      expect(inputs).toBe(afterEscape);
      if (browser.browserType().name() === 'chromium') {
        await page.locator('.xterm-screen').hover();
        await page.mouse.wheel(0, -250);
        await page.mouse.wheel(0, -250);
        await expect.poll(firstLine).toBeLessThan(reconnected);
        await sendVirtualKey(page, 'Esc');
        await expect(rows).toContainText('AFTER_SCROLL_OK');
      }
      await swipe(page, 'older', 180);
      await page.waitForTimeout(50);
      const held = inputs;
      await page.waitForTimeout(300);
      expect(inputs).toBe(held);
      await sendVirtualKey(page, 'Esc');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await swipe(page, 'older');
      await page.waitForTimeout(50);
      const reduced = inputs;
      await page.waitForTimeout(300);
      expect(inputs).toBe(reduced);
      await sendVirtualKey(page, 'Esc');
      await page.locator('.xterm-screen').tap();
      await expect(page.getByRole('textbox', { name: 'Input', exact: true })).toBeFocused();
      // Long output: fast flicks should travel beyond a slow drag, not merely
      // move a few rows. The test still uses the real local/SSH tmux session.
      await page.getByRole('textbox', { name: 'Input', exact: true }).fill('i=1; while [ "$i" -le 1000 ]; do printf "LONG_%04d\\n" "$i"; i=$((i+1)); done');
      await sendVirtualKey(page, 'Enter');
      await expect(rows).toContainText('LONG_1000');
      await page.getByRole('button', { name: 'Hide keyboard', exact: true }).click();
      const longFirst = async () => Math.min(...((await rows.innerText()).match(/LONG_\d{4}/g) ?? []).map(value => Number(value.slice(5))));
      const bottom = await longFirst();
      await swipe(page, 'older', 180);
      await expect.poll(longFirst).toBeLessThan(bottom);
      const drag = bottom - await longFirst();
      await sendVirtualKey(page, 'Esc');
      await expect.poll(longFirst).toBe(bottom);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await swipe(page, 'older', 0, true);
      await expect.poll(longFirst).toBeLessThan(bottom - Math.max(60, drag * 2));
      await sendVirtualKey(page, 'Esc');
      await expect.poll(longFirst).toBe(bottom);
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
}

for (const remote of [false, true]) test(`desktop wheel distance: ${remote ? 'SSH' : 'local'} pixels, lines and pages`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.status() === 204 ? undefined : response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'Wheel SSH', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: 'Wheel', path: remote ? info.remoteRoot : info.projectPath, hostId: host?.id });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Wheel' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(({ token, project, session }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', project); localStorage.setItem('jelly-session', session);
    }, { token, project: project.id, session: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await page.getByRole('textbox', { name: 'Input', exact: true }).fill('i=1; while [ "$i" -le 1000 ]; do printf "WHEEL_%04d\\n" "$i"; i=$((i+1)); done');
    await sendVirtualKey(page, 'Enter');
    const rows = page.locator('.xterm-rows');
    await expect(rows).toContainText('WHEEL_1000');
    const first = async () => Math.min(...((await rows.innerText()).match(/WHEEL_\d{4}/g) ?? []).map(value => Number(value.slice(6))));
    const bottom = await first();
    const reset = async () => { await sendVirtualKey(page, 'Esc'); await expect.poll(first).toBe(bottom); };
    const wheel = async (deltaY: number, deltaMode = 0) => {
      await page.locator('.xterm-screen').evaluate((element, { deltaY, deltaMode }) => {
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaMode, clientX: rect.x + 100, clientY: rect.y + 100 }));
      }, { deltaY, deltaMode });
    };
    await page.locator('.xterm-screen').hover();
    await page.mouse.wheel(0, -120);
    await expect.poll(first).toBeLessThan(bottom - 10);
    const small = bottom - await first();
    await reset();
    await page.locator('.xterm-screen').hover();
    await page.mouse.wheel(0, -600);
    await expect.poll(first).toBeLessThan(bottom - small * 3);
    const large = await first();
    await page.mouse.wheel(0, 120);
    await expect.poll(first).toBeGreaterThan(large);
    await reset();
    // The first report enters tmux copy mode; the remaining two move 10 rows.
    await wheel(-3, 1);
    await expect.poll(first).toBeLessThanOrEqual(bottom - 10);
    await reset();
    await wheel(-1, 2);
    await expect.poll(first).toBeLessThan(bottom - 100);
    await reset();
    // Fractional trackpad movement must accumulate without artificial inertia.
    for (let i = 0; i < 60; i++) await wheel(-1);
    // Wait for the last report to render before checking that motion stopped.
    await expect.poll(first).toBeLessThanOrEqual(bottom - 10);
    const precise = await first();
    await page.waitForTimeout(250);
    expect(await first()).toBe(precise);
    await reset();
    await page.getByRole('textbox', { name: 'Input', exact: true }).fill("printf 'WHEEL_%s\\n' DONE");
    await sendVirtualKey(page, 'Enter');
    await expect(rows).toContainText('WHEEL_DONE');
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
