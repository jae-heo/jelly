import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

test('unregistered sessions can be added to a project or stopped; lost records are labeled', async ({ page, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const dataDir = dirname(info.tokenFile);
  // Only the browser test server's private socket.
  const tmux = (...args: string[]) => execFileSync('tmux', ['-S', join(dataDir, 'tmux.sock'), '-f', join(dataDir, 'tmux.conf'), ...args], { encoding: 'utf8' });
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  mkdirSync('.data/screenshots', { recursive: true });
  const project = await call('/projects', 'POST', { name: 'Recovery project', path: info.projectPath });
  const kept = randomUUID(), stopped = randomUUID();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    // Print the marker at startup: keys sent before bash initializes can be discarded.
    for (const id of [kept, stopped]) tmux('new-session', '-d', '-s', `jelly-${id}`, '-c', info.projectPath, `printf '\\nORPHAN_%s\\n' ${id.slice(0, 8)}; exec bash`);
    const lost = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Gone' });
    tmux('kill-session', '-t', `=jelly-${lost.id}`);
    await page.addInitScript(({ token, id }) => {
      sessionStorage.setItem('jelly-token', token); localStorage.setItem('jelly-project', id);
    }, { token, id: project.id });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Gone · Lost', exact: true })).toBeVisible();
    const section = page.getByRole('region', { name: 'Unregistered sessions' });
    await expect(section.getByRole('button', { name: 'Unregistered session in project · Running', exact: true })).toHaveCount(2);

    await page.screenshot({ path: '.data/screenshots/unregistered-sidebar.png', clip: { x: 0, y: 0, width: 300, height: 450 } });
    await section.getByRole('button').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Unregistered session' })).toBeVisible();
    await expect(dialog.getByText(info.projectPath)).toBeVisible();
    await expect(dialog.getByLabel('Project', { exact: true })).toHaveValue(project.id);
    await expect(dialog.getByLabel('Session name', { exact: true })).toHaveValue('Session 1');
    await page.screenshot({ path: '.data/screenshots/unregistered-desktop.png' });
    await dialog.getByLabel('Session name', { exact: true }).fill('Recovered');
    await dialog.getByRole('button', { name: 'Add to project', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.workspace-current strong')).toHaveText('Recovered');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    const adoptedId = (await call('/sessions')).sessions.find((s: any) => s.name === 'Recovered').id;
    expect([kept, stopped]).toContain(adoptedId);
    // The same shell is attached: its earlier screen output is restored.
    await expect(page.locator('.xterm-rows')).toContainText(`ORPHAN_${adoptedId.slice(0, 8)}`);
    await expect(section.getByRole('button')).toHaveCount(1);

    await section.getByRole('button').click();
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Stop session' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Unregistered session' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
    await dialog.getByRole('button', { name: 'Stop session', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(section).toHaveCount(0);
    const remaining = adoptedId === kept ? stopped : kept;
    expect(() => tmux('has-session', '-t', `=jelly-${remaining}`)).toThrow();
    tmux('has-session', '-t', `=jelly-${adoptedId}`);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    for (const id of [kept, stopped]) { try { tmux('kill-session', '-t', `=jelly-${id}`); } catch { /* Stopped or adopted. */ } }
    await call(`/projects/${project.id}?deleteSessions=true`, 'DELETE');
  }
});
