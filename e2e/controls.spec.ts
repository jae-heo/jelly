import { sendVirtualKey } from './virtual-keyboard';
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

test('font changes preserve the live connection; compact controls retain input and settings', async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.status() === 204 ? undefined : response.json();
  };
  const project = await call('/projects', 'POST', { name: '글씨와 입력', path: info.projectPath });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: '작업 이어가기' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  let connections = 0;
  let resizes = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    connections++;
    socket.on('framesent', event => { if (JSON.parse(String(event.payload)).type === 'resize') resizes++; });
  });
  mkdirSync('.data/screenshots', { recursive: true });
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
    await expect(page.getByRole('region', { name: 'Virtual keyboard', exact: true })).not.toBeVisible();
    await expect(page.locator('.terminal-statusbar')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Input', exact: true })).toBeVisible();
    expect((await page.locator('.terminal-input').boundingBox())!.height).toBe(44);
    const before = await call(`/sessions/${session.id}`);
    const opened = connections;
    // Use the real browser API: entering/leaving fullscreen must keep the PTY
    // and connection alive, and dialogs must stay above the fullscreen content.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('HTML');
    await expect(page.getByRole('region', { name: 'Session menu' })).not.toBeVisible();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeInViewport();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    // A browser-initiated exit also updates the menu (e.g. Android Back).
    await page.evaluate(() => document.exitFullscreen());
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect(connections).toBe(opened);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Increase font size', exact: true }).click();
    await expect(page.getByLabel('Current font size')).toHaveText('18px');
    await expect(page.locator('.xterm-rows')).toHaveCSS('font-size', '18px');
    await expect.poll(async () => (await call(`/sessions/${session.id}`)).cols).toBeLessThan(before.cols);
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect(connections).toBe(opened);
    await page.screenshot({ path: '.data/screenshots/font-size-mobile.png', fullPage: true });
    await page.reload();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.locator('.xterm-rows')).toHaveCSS('font-size', '18px');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Decrease font size', exact: true }).click();
    await expect(page.locator('.xterm-rows')).toHaveCSS('font-size', '17px');
    await page.getByRole('button', { name: 'Reset font size', exact: true }).click();
    await expect(page.locator('.xterm-rows')).toHaveCSS('font-size', '14px');
    await page.keyboard.press('Escape');
    const input = page.getByRole('textbox', { name: 'Input', exact: true });
    await page.getByRole('textbox', { name: 'Input', exact: true }).focus();
    await expect(input).toBeFocused();
    await input.fill("printf '\\n%s%s\\n' '한글' '입력유지'");
    await expect(input).toBeFocused();
    await expect(page.locator('.xterm-rows')).not.toContainText('한글입력유지');
    await sendVirtualKey(page, 'Enter');
    await expect(input).toBeFocused();
    await expect(page.locator('.xterm-rows')).toContainText('한글입력유지');
    await sendVirtualKey(page, 'Esc');
    await expect(input).toBeFocused();
    await page.getByRole('button', { name: 'Open shortcuts', exact: true }).click();
    await expect(input).toBeFocused();
    await expect(page.getByRole('button', { name: 'Paste text', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Navigate', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Left arrow', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 520 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('textbox', { name: 'Input', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Esc', exact: true })).toBeInViewport();
    await page.screenshot({ path: '.data/screenshots/controls-expanded-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Close shortcuts', exact: true }).click();
    await page.getByRole('button', { name: 'Hide keyboard', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(input).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Input', exact: true })).toBeInViewport();
    expect((await page.locator('.terminal-input').boundingBox())!.height).toBe(44);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('textbox', { name: 'Input', exact: true }).focus();
    const cdp = await context.newCDPSession(page);
    // Model an iPhone that keeps its home-indicator inset while the keyboard is open.
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34 } });
    // Input focus by itself (e.g. a hardware keyboard) must retain the safe area.
    await expect(input).toBeFocused();
    await expect(page.locator('.terminal-dock')).toHaveCSS('padding-bottom', '34px');
    await page.waitForTimeout(350);
    const beforeAnimation = resizes;
    // Model browsers that pan the visual viewport above the keyboard without resizing
    // the layout viewport. Real OS keyboard presentation is outside headless Chromium.
    await page.evaluate(async () => {
      const viewport = window.visualViewport!;
      let height = viewport.height;
      let top = 0;
      Object.defineProperty(viewport, 'height', { configurable: true, get: () => height });
      Object.defineProperty(viewport, 'offsetTop', { configurable: true, get: () => top });
      for (const next of [700, 640, 580, 520, 460]) {
        height = next; top += 16;
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    });
    await expect.poll(async () => (await page.locator('.workspace-header').boundingBox())!.y).toBe(80);
    await expect.poll(async () => {
      const box = (await page.locator('.terminal-dock').boundingBox())!;
      return box.y + box.height;
    }).toBe(540);
    await expect(page.locator('.terminal-dock')).toHaveCSS('padding-bottom', '0px');
    await page.waitForTimeout(350);
    expect(resizes).toBe(beforeAnimation);
    await expect(input).toBeFocused();
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperty(viewport, 'scale', { configurable: true, get: () => 2 });
      Object.defineProperty(viewport, 'height', { configurable: true, get: () => 200 });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('.workspace')).toHaveCSS('height', '460px');
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      for (const key of ['height', 'offsetTop', 'scale']) Reflect.deleteProperty(viewport, key);
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(async () => (await page.locator('.workspace-header').boundingBox())!.y).toBe(0);
    // Dismissing the keyboard can leave the input focused; restore the inset anyway.
    await expect(input).toBeFocused();
    await expect(page.locator('.terminal-dock')).toHaveCSS('padding-bottom', '34px');
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
    await page.getByRole('button', { name: 'Hide keyboard', exact: true }).tap();
    await expect(input).not.toBeFocused();
    await expect(input).toBeVisible();
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    const nativeFullscreen = await page.evaluate(() => {
      // Exercise browser refusal without letting a rejected promise escape.
      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        configurable: true, value: () => Promise.reject(new TypeError('Fullscreen unavailable')),
      });
      return document.fullscreenEnabled;
    });
    expect(nativeFullscreen).toBe(true);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Could not switch fullscreen. Try again.');
    await page.evaluate(() => { Reflect.deleteProperty(document.documentElement, 'requestFullscreen'); });
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect to server', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await call(`/sessions/${session.id}/stop`, 'POST');
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
  }
});
