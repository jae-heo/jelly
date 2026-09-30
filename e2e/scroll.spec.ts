import { sendVirtualKey } from './virtual-keyboard';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

async function swipe(page: Page, direction: 'older' | 'newer') {
  const screen = await page.locator('.xterm-screen').boundingBox();
  if (!screen) throw new Error('Terminal screen not visible');
  const cdp = await page.context().newCDPSession(page);
  const x = screen.x + screen.width / 2;
  const from = screen.y + screen.height * (direction === 'older' ? 0.2 : 0.8);
  const to = screen.y + screen.height * (direction === 'older' ? 0.8 : 0.2);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * step / 12 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
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
    // EDITOR can select vi bindings, where Esc normally only clears a selection.
    if (!remote) execFileSync('tmux', ['-S', join(dirname(info.tokenFile), 'tmux.sock'),
      'set-window-option', '-t', `jelly-${session.id}`, 'mode-keys', 'vi']);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('/');
      await page.evaluate(({ projectId, sessionId }) => {
        localStorage.setItem('jelly-project', projectId);
        localStorage.setItem('jelly-session', sessionId);
      }, { projectId: project.id, sessionId: session.id });
      await page.reload();
      await page.getByLabel('Connection key', { exact: true }).fill(token);
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(page.locator('.connection-label')).toHaveText('Connected');
      await page.setViewportSize({ width: 320, height: 568 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'History', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'More', exact: true })).toBeInViewport();
      await page.setViewportSize({ width: 390, height: 844 });
      const rows = page.locator('.xterm-rows');
      const firstLine = async () => {
        const values = (await rows.innerText()).match(/SCROLL_\d{3}/g) ?? [];
        return Math.min(...values.map(value => Number(value.slice(7))));
      };
      await page.getByRole('textbox', { name: 'Input', exact: true }).focus();
      await page.getByRole('textbox', { name: 'Input', exact: true }).fill('i=1; while [ "$i" -le 120 ]; do printf "SCROLL_%03d\\n" "$i"; i=$((i+1)); done');
      await sendVirtualKey(page, 'Enter');
      await expect(rows).toContainText('SCROLL_120');
      const latest = await firstLine();
      await swipe(page, 'older');
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
      await page.locator('.xterm-screen').hover();
      await page.mouse.wheel(0, -250);
      await page.mouse.wheel(0, -250);
      await expect.poll(firstLine).toBeLessThan(reconnected);
      await sendVirtualKey(page, 'Esc');
      await expect(rows).toContainText('AFTER_SCROLL_OK');
      await page.locator('.xterm-screen').tap();
      await expect(page.getByRole('textbox', { name: 'Input', exact: true })).toBeFocused();
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
