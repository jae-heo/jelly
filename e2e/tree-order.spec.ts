import { test, expect, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const mobile of [false, true]) test(`tree reorder and deletion: ${mobile ? 'touch hold' : 'mouse drag'}`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const r = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(r.ok(), await r.text()).toBe(true); return r.json();
  };
  const a = await call('/projects', 'POST', { name: 'Order A', path: info.projectPath });
  const b = await call('/projects', 'POST', { name: 'Order B', path: info.browseRoot });
  const one = await call(`/projects/${a.id}/sessions`, 'POST', { name: 'One' });
  const two = await call(`/projects/${a.id}/sessions`, 'POST', { name: 'Two' });
  const other = await call(`/projects/${b.id}/sessions`, 'POST', { name: 'Other' });
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const errors: string[] = []; let connections = 0;
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', () => connections++);
  const projects = page.locator('.project-branch');
  const rows = page.locator(`[data-project-id="${a.id}"] .session-row`);
  const drag = async (source: Locator, target: Locator, cancel = false) => {
    const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
    const x = from.x + from.width / 2, y = from.y + from.height / 2;
    const endX = to.x + to.width / 2, endY = to.y + 2;
    if (!mobile) {
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 8 });
      await expect(page.locator('.tree-drag-preview')).toBeVisible();
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
    } else if (browser.browserType().name() === 'chromium') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await expect(page.getByRole('menu')).toBeVisible();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: endX, y: endY }] });
      await expect(page.locator('.tree-drag-preview')).toBeVisible();
      await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await source.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 12, isPrimary: true, button: 0, clientX: x, clientY: y });
      await expect(page.getByRole('menu')).toBeVisible();
      await source.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 12, clientX: endX, clientY: endY });
      await expect(page.locator('.tree-drag-preview')).toBeVisible();
      await source.dispatchEvent(cancel ? 'pointercancel' : 'pointerup', { pointerType: 'touch', pointerId: 12 });
    }
    await expect(page.locator('.tree-drag-preview')).toHaveCount(0);
  };
  try {
    await page.addInitScript(({ token, project, session }) => {
      sessionStorage.setItem('jelly-token', token); localStorage.setItem('jelly-project', project); localStorage.setItem('jelly-session', session);
    }, { token, project: a.id, session: one.id });
    await page.goto('/'); await expect(page.locator('.connection-label')).toHaveText('Connected');
    if (mobile) await page.getByRole('button', { name: 'Open projects and sessions' }).click();
    const source = page.locator(`[data-project-id="${b.id}"] .project-item`);
    const target = page.locator(`[data-project-id="${a.id}"] .project-item`);
    await drag(source, target, true);
    expect((await call('/projects')).projects.map((p: any) => p.id)).toEqual([a.id, b.id]);
    await drag(source, target);
    await expect(projects.first()).toHaveAttribute('data-project-id', b.id);
    await drag(rows.filter({ hasText: 'Two' }).locator('button').first(), rows.filter({ hasText: 'One' }).locator('button').first());
    await expect(rows.first()).toHaveAttribute('data-session-id', two.id);
    expect((await call(`/projects/${a.id}/sessions`)).sessions.map((s: any) => s.id)).toEqual([two.id, one.id]);
    expect((await call(`/sessions/${one.id}`)).pid).toBe(one.pid);
    await expect(page.locator('.workspace-current strong')).toHaveText('One');
    expect(connections).toBe(1);
    await page.reload(); await expect(page.locator('.connection-label')).toHaveText('Connected');
    if (mobile) await page.getByRole('button', { name: 'Open projects and sessions' }).click();
    await expect(projects.first()).toHaveAttribute('data-project-id', b.id);
    await expect(rows.first()).toHaveAttribute('data-session-id', two.id);
    // Failed saves leave both order and the active terminal intact.
    await page.route('**/api/sessions/*/move', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Order save failed' }) }));
    await rows.first().locator('button').first().press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect(page.getByText('Order save failed', { exact: true })).toBeVisible();
    await expect(rows.first()).toHaveAttribute('data-session-id', two.id);
    await page.unroute('**/api/sessions/*/move');
    // Keyboard menu reordering is an alternative to dragging.
    const twoRow = rows.first().locator('button').first();
    await twoRow.press('Shift+F10'); await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect(rows.last()).toHaveAttribute('data-session-id', two.id);
    await rows.last().locator('button').first().press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Delete session' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await call(`/sessions/${two.id}`)).status).toBe('running');
    await rows.last().locator('button').first().press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Delete session' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete session' }).click();
    await expect(rows).toHaveCount(1);
    // A project with a live child can be deleted in one confirmed action.
    await source.press('Shift+F10'); await page.getByRole('menuitem', { name: 'Delete project' }).click();
    await expect(page.getByRole('dialog')).toContainText('1 session');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete project' }).click();
    await expect(source).toHaveCount(0);
    expect((await call('/sessions')).sessions.map((s: any) => s.id)).not.toContain(other.id);
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    expect((await call(`/sessions/${one.id}`)).pid).toBe(one.pid);
    // Deleting the active project also clears its cached terminal and selection.
    await target.press('Shift+F10'); await page.getByRole('menuitem', { name: 'Delete project' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await call(`/sessions/${one.id}`)).status).toBe('running');
    await target.press('Shift+F10'); await page.getByRole('menuitem', { name: 'Delete project' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete project' }).click();
    await expect(target).toHaveCount(0);
    await expect(page.locator('.terminal-slot')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    for (const p of (await call('/projects')).projects) if ([a.id, b.id].includes(p.id)) await call(`/projects/${p.id}?deleteSessions=true`, 'DELETE');
  }
});
