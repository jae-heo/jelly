import { test, expect, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`${remote ? 'SSH' : 'local'}: quick creation is immediate, deduplicated and respects later selection`, async ({ page, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'quick', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: 'Quick project', path: remote ? info.remoteRoot : info.projectPath, hostId: host?.id ?? null });
  const other = await call('/projects', 'POST', { name: 'Other project', path: info.browseRoot });
  let held: Route | undefined;
  let hold = false, fail = false, creates = 0;
  const errors: string[] = [];
  const keys: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', event => { const value = JSON.parse(String(event.payload)); if (value.type === 'input') keys.push(value.data); }));
  await page.route('**/api/projects/*/sessions', route => {
    if (route.request().method() !== 'POST') return route.continue();
    creates++;
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { error: 'Creation unavailable' } }); }
    if (hold) { hold = false; held = route; return; }
    return route.continue();
  });
  await page.addInitScript(({ token, id }) => {
    sessionStorage.setItem('jelly-token', token); localStorage.setItem('jelly-project', id);
  }, { token, id: project.id });
  const shortcut = () => page.keyboard.press('Meta+Shift+Enter');
  try {
    await page.goto('/');
    await expect(page.locator('.project-item.selected')).toContainText(project.name);
    await shortcut();
    await expect(page.locator('.workspace-current strong')).toHaveText('Session 1');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.locator('.terminal-slot:visible .xterm-helper-textarea')).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(creates).toBe(1);
    await page.getByRole('button', { name: 'Open shortcuts', exact: true }).click();
    await page.getByRole('button', { name: 'Ctrl', exact: true }).click();
    await page.getByRole('button', { name: 'C', exact: true }).click();
    await expect(page.getByLabel('Selected key combination')).toHaveText('Ctrl + C');
    keys.length = 0;
    hold = true;
    await shortcut();
    await expect.poll(() => !!held).toBe(true);
    for (let i = 0; i < 3; i++) await shortcut();
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', metaKey: true, shiftKey: true, repeat: true, bubbles: true, cancelable: true })));
    expect(creates).toBe(2);
    expect(keys).not.toContain('\r');
    // A later project choice takes precedence over a delayed create response.
    await page.locator('.project-item').filter({ hasText: other.name }).click();
    await held!.continue(); held = undefined;
    await expect(page.getByRole('button', { name: /Session 2 ·/ })).toBeVisible();
    await expect(page.locator('.project-item.selected')).toContainText(other.name);
    await expect(page.locator('.terminal-slot:visible')).toHaveCount(0);
    await page.locator('.project-item').filter({ hasText: project.name }).click();
    // Modals and IME events must not accidentally create sessions.
    await page.getByRole('button', { name: `New session in ${project.name}`, exact: true }).click();
    await shortcut();
    expect(creates).toBe(2);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', metaKey: true, shiftKey: true, isComposing: true, bubbles: true, cancelable: true })));
    expect(creates).toBe(2);
    fail = true;
    await shortcut();
    await expect(page.getByRole('alert')).toHaveText('Creation unavailable');
    await shortcut();
    await expect(page.locator('.workspace-current strong')).toHaveText('Session 3');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.getByRole('region', { name: 'Virtual keyboard', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open shortcuts', exact: true }).click();
    await expect(page.getByLabel('Selected key combination')).toHaveText('Select a key');
    await expect(page.getByRole('button', { name: 'Send key combination', exact: true })).toBeDisabled();
    expect(creates).toBe(4);
    expect((await call('/sessions')).sessions.filter((s: any) => s.projectId === project.id)).toHaveLength(3);
    expect(errors).toEqual([]);
  } finally {
    if (held) await held.abort().catch(() => {});
    await page.close();
    for (const session of (await call('/sessions')).sessions.filter((s: any) => [project.id, other.id].includes(s.projectId))) await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE'); await call(`/projects/${other.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
