import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`rename: ${remote ? 'SSH on mobile' : 'local on desktop'} preserves the terminal and persists names`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'Rename host', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: 'Original project', path: remote ? info.remoteRoot : info.projectPath, hostId: host?.id ?? null });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Original session' });
  const context = await browser.newContext(remote ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const page = await context.newPage();
  let opened = 0, closed = 0;
  page.on('websocket', socket => { opened++; socket.on('close', () => closed++); });
  const openRename = async (kind: string) => {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: `Rename ${kind}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  };
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await openRename('project');
    await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(project.name);
    await page.getByLabel('Project name', { exact: true }).fill('   ');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.getByLabel('Project name', { exact: true }).fill('Renamed 프로젝트');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.workspace-location > span').first()).toHaveText('Renamed 프로젝트');

    await openRename('session');
    await page.getByLabel('Session name', { exact: true }).fill('Cancelled');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.workspace-current strong')).toHaveText(session.name);

    let fail = true;
    await page.route(`**/api/sessions/${session.id}`, route => {
      if (route.request().method() === 'PATCH' && fail) {
        fail = false;
        return route.fulfill({ status: 503, json: { error: 'Save unavailable' } });
      }
      return route.continue();
    });
    await openRename('session');
    await page.getByLabel('Session name', { exact: true }).fill('Renamed 세션');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Save unavailable');
    await expect(page.locator('.workspace-current strong')).toHaveText(session.name);

    // Finish an old polling response after saving: it must not undo the name.
    let release: (() => Promise<void>) | undefined;
    await page.route('**/api/sessions', async route => {
      const response = await route.fetch();
      release = () => route.fulfill({ response });
    });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => !!release).toBe(true);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await release!().catch(() => {});
    await page.unroute('**/api/sessions');
    await page.waitForTimeout(200);
    await expect(page.locator('.workspace-current strong')).toHaveText('Renamed 세션');
    expect(opened).toBe(1); expect(closed).toBe(0);
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect((await call(`/projects/${project.id}`)).path).toBe(project.path);

    await page.reload();
    await expect(page.locator('.workspace-current strong')).toHaveText('Renamed 세션');
    await expect(page.locator('.workspace-location > span').first()).toHaveText('Renamed 프로젝트');
    if (remote) await page.getByRole('button', { name: 'Open projects and sessions' }).click();
    await expect(page.getByRole('button', { name: 'Renamed 세션 · Running', exact: true })).toBeVisible();
    await expect(page.locator('.project-item.selected')).toHaveText('Renamed 프로젝트');
  } finally {
    await context.close();
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
