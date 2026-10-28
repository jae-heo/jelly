import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const mobile of [false, true]) test(`selection scroll: ${mobile ? 'touch' : 'wheel'} reaches older output and preserves copy`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const r = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(r.ok(), await r.text()).toBe(true); return r.json();
  };
  const p = await call('/projects', 'POST', { name: 'Selection scroll', path: info.projectPath });
  const s = await call(`/projects/${p.id}/sessions`, 'POST', { name: 'Output' });
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage(); let connections = 0; let history = 0;
  page.on('websocket', () => connections++);
  page.on('request', r => { if (r.url().includes('/history')) history++; });
  try {
    await page.addInitScript(({ token, project, session }) => {
      sessionStorage.setItem('jelly-token', token); localStorage.setItem('jelly-project', project); localStorage.setItem('jelly-session', session);
    }, { token, project: p.id, session: s.id });
    await page.goto('/'); await expect(page.locator('.connection-label')).toHaveText('Connected');
    const input = page.getByRole('textbox', { name: 'Input', exact: true });
    await input.fill("seq -f 'SELECT_LINE_%04g' 1 1000"); await input.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('SELECT_LINE_1000');
    await page.getByRole('button', { name: 'Hide keyboard', exact: true }).click();
    const before = await call(`/sessions/${s.id}`);
    await page.getByRole('button', { name: 'Select text', exact: true }).click();
    const text = page.locator('.selection-text');
    const frozen = await text.textContent();
    const box = (await text.boundingBox())!;
    if (!mobile) {
      await text.hover(); await page.mouse.wheel(0, -360);
    } else if (browser.browserType().name() === 'chromium') {
      const cdp = await context.newCDPSession(page);
      const x = box.x + box.width / 2, y = box.y + 60;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 30 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    } else {
      await text.evaluate(element => {
        const b = element.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + 60;
        const fire = (type: string, py: number) => {
          const touch = { identifier: 1, target: element, clientX: x, clientY: py };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [touch] }, changedTouches: { value: [touch] } });
          element.dispatchEvent(event);
        };
        fire('touchstart', y); fire('touchmove', y + 180); fire('touchend', y + 180);
      });
    }
    await expect.poll(() => text.textContent()).not.toBe(frozen);
    await expect(text).toContainText(/SELECT_LINE_0\d{3}/);
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    expect(selected).toContain('SELECT_LINE_');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
    const after = await call(`/sessions/${s.id}`);
    expect([after.pid, after.cols, after.rows]).toEqual([before.pid, before.cols, before.rows]);
    expect(connections).toBe(1); expect(history).toBe(0);
  } finally {
    await context.close(); await call(`/projects/${p.id}?deleteSessions=true`, 'DELETE');
  }
});
