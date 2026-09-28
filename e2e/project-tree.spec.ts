import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

for (const mobile of [false, true]) test(`project tree: ${mobile ? 'mobile' : 'desktop'} nesting, folds and targeted creation`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage();
  const projects: { id: string; name: string }[] = [];
  let tickets = 0;
  page.on('request', request => { if (request.url().endsWith('/tickets')) tickets++; });
  const openTree = async () => {
    if (mobile && !(await page.locator('.sidebar').isVisible())) await page.getByRole('button', { name: '프로젝트와 세션 열기' }).click();
  };
  try {
    for (const [name, path] of [['Jelly', info.projectPath], ['API server', info.browseRoot], ['Other project with a very long name', `${info.browseRoot}/.hidden-folder`]]) {
      projects.push(await call('/projects', 'POST', { name, path }));
    }
    const first = await call(`/projects/${projects[0]!.id}/sessions`, 'POST', { name: 'Development' });
    const second = await call(`/projects/${projects[1]!.id}/sessions`, 'POST', { name: 'Server logs' });
    const stopped = await call(`/projects/${projects[0]!.id}/sessions`, 'POST', { name: 'Finished' });
    await call(`/sessions/${stopped.id}/stop`, 'POST');
    await page.goto('/');
    await page.evaluate(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId);
      localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: projects[0]!.id, sessionId: first.id });
    await page.reload();
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await openTree();
    const jelly = page.locator(`[data-project-id="${projects[0]!.id}"]`);
    const api = page.locator(`[data-project-id="${projects[1]!.id}"]`);
    await expect(jelly.locator('.session-text strong')).toHaveText(['Development', 'Finished']);
    await expect(api.locator('.session-text strong')).toHaveText(['Server logs']);
    const warmTickets = tickets;
    await page.getByRole('button', { name: 'Jelly 접기', exact: true }).click();
    await expect(jelly.getByRole('button', { name: /Development/ })).toBeHidden();
    await expect(page.locator('.terminal-slot:visible')).toHaveAttribute('data-session-id', first.id);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('button', { name: 'Jelly 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false');
    expect(tickets).toBe(warmTickets);
    await page.getByRole('button', { name: 'API server 접기', exact: true }).click();
    // Previous wraps to the last project's session even when its group is folded.
    await page.keyboard.press('Meta+Shift+Comma');
    await expect(page.locator('.terminal-slot:visible')).toHaveAttribute('data-session-id', second.id);
    await openTree();
    await expect(page.getByRole('button', { name: 'API server 접기', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(api.locator('.session-row.selected strong')).toHaveText('Server logs');

    // Creating in another project must preserve the current selection on cancel.
    await page.getByRole('button', { name: 'Jelly 새 세션', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.dialog-description')).toHaveText('Jelly');
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.locator('.terminal-slot:visible')).toHaveAttribute('data-session-id', second.id);
    await page.getByRole('button', { name: 'Jelly 새 세션', exact: true }).click();
    await dialog.getByLabel('세션 이름').fill('New terminal with a very long session name');
    await dialog.getByRole('button', { name: '세션 열기', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await openTree();
    await expect(jelly.locator('.session-row.selected strong')).toHaveText('New terminal with a very long session name');
    const state = await call('/sessions');
    expect(state.sessions.find((s: { name: string }) => s.name === 'New terminal with a very long session name').projectId).toBe(projects[0]!.id);
    await jelly.getByRole('button', { name: 'Finished 기록 삭제', exact: true }).click();
    await expect(jelly.getByRole('button', { name: /Finished/ })).toHaveCount(0);
    await expect(api.getByRole('button', { name: /Server logs/ })).toBeVisible();
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 740 });
      for (const button of await page.locator('.project-tree button:visible').all()) {
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x + box!.width).toBeLessThanOrEqual(280);
      }
    }
    expect(await page.locator('.project-tree').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    mkdirSync('.data/screenshots', { recursive: true });
    await page.screenshot({ path: `.data/screenshots/project-tree-${mobile ? 'mobile' : 'desktop'}.png` });
  } finally {
    await context.close();
    const { sessions } = await call('/sessions');
    for (const session of sessions) if (projects.some(p => p.id === session.projectId)) await call(`/sessions/${session.id}`, 'DELETE');
    for (const project of projects) await call(`/projects/${project.id}`, 'DELETE');
  }
});
