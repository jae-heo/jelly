import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

test('⌘⇧⌫ deletes the current session after confirmation and opens the previous one', async ({ page, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const socket = join(dirname(info.tokenFile), 'tmux.sock');
  const alive = (id: string) => { try { execFileSync('tmux', ['-S', socket, 'has-session', '-t', `=jelly-${id}`], { stdio: 'ignore' }); return true; } catch { return false; } };
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const project = await call('/projects', 'POST', { name: 'Delete shortcut', path: info.projectPath });
  const created: any[] = [];
  for (const name of ['First', 'Middle', 'Last']) created.push(await call(`/projects/${project.id}/sessions`, 'POST', { name }));
  const [first, middle, last] = created;
  const other = await call('/projects', 'POST', { name: 'Other project', path: info.browseRoot });
  const outside = await call(`/projects/${other.id}/sessions`, 'POST', { name: 'Outside' });
  const errors: string[] = [];
  const input: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', event => { const value = JSON.parse(String(event.payload)); if (value.type === 'input') input.push(value.data); }));
  const chord = () => page.keyboard.press('Meta+Shift+Backspace');
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: middle.id });
    await page.goto('/');
    const current = page.locator('.workspace-current strong');
    await expect(current).toHaveText('Middle');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.locator('.terminal-slot:visible .xterm-helper-textarea')).toBeFocused();
    input.length = 0;

    await chord();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Delete session', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Delete session' })).toBeVisible();
    await expect(dialog).toContainText('‘Middle’');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(current).toHaveText('Middle');
    expect(alive(middle.id)).toBe(true);

    // Previous session in the project.
    await chord();
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(current).toHaveText('First');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.getByRole('button', { name: /^Middle ·/ })).toHaveCount(0);
    expect(alive(middle.id)).toBe(false);

    // The first session has no previous one; the next is opened instead.
    await chord();
    await expect(dialog).toContainText('‘First’');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(current).toHaveText('Last');
    expect(alive(first.id)).toBe(false);

    // Never moves to another project; an empty project shows its empty state.
    await chord();
    await expect(dialog).toContainText('‘Last’');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Select a session', exact: true })).toBeVisible();
    expect(alive(last.id)).toBe(false);
    expect(alive(outside.id)).toBe(true);
    expect((await call(`/projects/${project.id}/sessions`)).sessions).toEqual([]);

    // Without a current session the chord is ignored.
    await chord();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Neither the chord's Backspace nor the confirming Enter reached a shell.
    // Newly opened terminals do answer tmux's device queries, which is not input.
    expect(input.filter(data => /[\r\x7f\b]/.test(data))).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await call(`/projects/${project.id}?deleteSessions=true`, 'DELETE');
    await call(`/projects/${other.id}?deleteSessions=true`, 'DELETE');
  }
});
