import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

test('⌘⇧⌫ asks to delete the current session; Enter deletes it, Esc keeps it', async ({ page, request }) => {
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
  const target = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Doomed' });
  const other = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Survivor' });
  const errors: string[] = [];
  const input: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', event => { const value = JSON.parse(String(event.payload)); if (value.type === 'input') input.push(value.data); }));
  const chord = () => page.keyboard.press('Meta+Shift+Backspace');
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: target.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.locator('.terminal-slot:visible .xterm-helper-textarea')).toBeFocused();
    input.length = 0;

    await chord();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete session' })).toBeVisible();
    await expect(dialog).toContainText('‘Doomed’');
    await expect(dialog.getByRole('button', { name: 'Delete session', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(alive(target.id)).toBe(true);

    await chord();
    await expect(dialog.getByRole('button', { name: 'Delete session', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Doomed ·/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Select a session', exact: true })).toBeVisible();
    expect(alive(target.id)).toBe(false);
    expect(alive(other.id)).toBe(true);
    expect((await call('/sessions')).sessions.some((s: any) => s.id === target.id)).toBe(false);

    // Without a current session the chord is ignored.
    await chord();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The chord and its confirmation never reach the shell.
    expect(input).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await call(`/projects/${project.id}?deleteSessions=true`, 'DELETE');
  }
});
