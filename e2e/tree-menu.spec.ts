import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

async function hold(page: Page, row: Locator) {
  const box = await row.boundingBox();
  if (!box) throw new Error('Missing tree row');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await expect(page.getByRole('menu')).toBeVisible();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
  } else {
    await row.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
    await expect(page.getByRole('menu')).toBeVisible();
    await row.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: x, clientY: y });
    // WebKit automation has no native long-press injection. Model its trailing
    // click too: it must not select the row or dismiss the sidebar.
    await row.dispatchEvent('click');
  }
}

for (const mobile of [false, true]) test(`tree options: ${mobile ? 'mobile SSH hold' : 'desktop right click'} targets background items`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.status() === 204 ? undefined : response.json();
  };
  const host = mobile ? await call('/hosts', 'POST', { name: 'Menu SSH', target: 'jelly-remote' }) : null;
  const a = await call('/projects', 'POST', { name: 'Active project', path: info.projectPath });
  const b = await call('/projects', 'POST', { name: 'Background project', path: mobile ? info.remoteRoot : info.browseRoot, hostId: host?.id });
  const active = await call(`/projects/${a.id}/sessions`, 'POST', { name: 'Active session' });
  const background = await call(`/projects/${b.id}/sessions`, 'POST', { name: 'Background session' });
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  let connections = 0, closed = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => { connections++; socket.on('close', () => closed++); });
  const menu = page.getByRole('menu');
  const projectRow = () => page.locator(`[data-project-id="${b.id}"] .project-item`);
  const sessionRow = () => page.getByRole('button', { name: /^Background session ·/ });
  const open = async (row: Locator) => {
    if (mobile) await hold(page, row); else await row.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await expect(page.locator('.workspace-current strong')).toHaveText('Active session');
  };
  try {
    await page.addInitScript(({ token, project, session }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', project); localStorage.setItem('jelly-session', session);
    }, { token, project: a.id, session: active.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    if (mobile) await page.getByRole('button', { name: 'Open projects and sessions' }).click();
    await open(projectRow());
    await expect(menu.getByRole('menuitem', { name: /Remove project/ })).toBeDisabled();
    await menu.getByRole('menuitem', { name: 'New session', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.dialog-description')).toHaveText('Background project');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await open(projectRow());
    await menu.getByRole('menuitem', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Files', exact: true }).locator('.files-location')).toHaveText('Background project');
    await expect(page.getByRole('region', { name: 'Project files' })).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await open(projectRow());
    await menu.getByRole('menuitem', { name: 'Rename project' }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Renamed background');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(projectRow()).toHaveText('Renamed background');
    await expect(page.locator('.workspace-location > span').first()).toHaveText('Active project');
    await open(sessionRow());
    await menu.getByRole('menuitem', { name: 'Rename session' }).click();
    await page.getByLabel('Session name', { exact: true }).fill('Renamed session');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const renamed = page.getByRole('button', { name: /^Renamed session ·/ });
    await expect(renamed).toBeVisible();

    // Keyboard access, focus restoration, and menu-contained shortcut handling.
    await renamed.focus();
    await renamed.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Rename session' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Stop session' })).toBeFocused();
    await page.keyboard.press('Meta+Shift+Period');
    await expect(page.locator('.workspace-current strong')).toHaveText('Active session');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(renamed).toBeFocused();
    await renamed.press('Shift+F10');
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);

    if (mobile) {
      // Movement, cancellation, scrolling and a second finger cancel a pending
      // hold. They must not open menus while scrolling the tree.
      for (const reason of ['move', 'cancel', 'scroll', 'second']) {
        await renamed.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: 100, clientY: 200 });
        if (reason === 'move') await renamed.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 225 });
        if (reason === 'cancel') await renamed.dispatchEvent('pointercancel', { pointerId: 7 });
        if (reason === 'scroll') await page.locator('.project-tree').dispatchEvent('scroll');
        if (reason === 'second') await renamed.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 8, isPrimary: false });
        await page.waitForTimeout(550);
        await expect(menu).toHaveCount(0);
        await renamed.dispatchEvent('pointerup', { pointerId: 7 });
      }
    }
    await projectRow().evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 2, clientY: innerHeight - 2 })));
    await expect(menu).toBeInViewport();
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThan((mobile ? 390 : 1440) - bounds!.width - 10);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(mobile ? 390 : 1440);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(mobile ? 844 : 900);
    mkdirSync('.data/screenshots', { recursive: true });
    await page.screenshot({ path: `.data/screenshots/tree-menu-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.locator('.project-tree').dispatchEvent('scroll');
    await expect(menu).toHaveCount(0);
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 568 });
      await open(projectRow());
      const compact = await menu.boundingBox();
      expect(compact!.x + compact!.width).toBeLessThanOrEqual(320);
      expect(compact!.y + compact!.height).toBeLessThanOrEqual(568);
      await page.screenshot({ path: '.data/screenshots/tree-menu-compact.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(menu).toHaveCount(0);
    }
    await open(renamed);
    await menu.getByRole('menuitem', { name: 'Stop session' }).click();
    await expect(page.getByRole('dialog').locator('.dialog-description')).toContainText('Renamed session');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await call(`/sessions/${background.id}`)).status).toBe('running');
    await open(renamed);
    await menu.getByRole('menuitem', { name: 'Stop session' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Stop session' }).click();
    await expect(page.getByRole('button', { name: 'Renamed session · Ended', exact: true })).toBeVisible();
    await open(renamed);
    await menu.getByRole('menuitem', { name: 'Remove record' }).click();
    await expect(renamed).toHaveCount(0);
    await open(projectRow());
    await menu.getByRole('menuitem', { name: 'Remove project' }).click();
    await expect(page.getByRole('dialog').locator('.dialog-description')).toContainText('Renamed background');
    await page.getByRole('button', { name: 'Remove from list' }).click();
    await expect(projectRow()).toHaveCount(0);
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    expect((await call(`/sessions/${active.id}`)).pid).toBe(active.pid);
    expect((await call(`/sessions/${active.id}`)).status).toBe('running');
    expect(connections).toBe(1); expect(closed).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    const { sessions } = await call('/sessions');
    for (const session of sessions) if ([a.id, b.id].includes(session.projectId)) await call(`/sessions/${session.id}`, 'DELETE');
    const { projects } = await call('/projects');
    for (const project of projects) if ([a.id, b.id].includes(project.id)) await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
