import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

test('the terminal answers tmux version queries so Esc is not delayed', async ({ page, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const socket = join(dirname(info.tokenFile), 'tmux.sock');
  const tmux = (...args: string[]) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' }).trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const project = await call('/projects', 'POST', { name: 'Queries', path: info.projectPath });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Esc' });
  const pane = `=jelly-${session.id}:0.0`;
  const input: string[] = [];
  page.on('websocket', socket => socket.on('framesent', event => { const value = JSON.parse(String(event.payload)); if (value.type === 'input') input.push(value.data); }));
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect.poll(() => input).toContain('\x1bP>|xterm.js\x1b\\');
    // Without an answer, tmux 3.6 delays every lone Esc by about half a second
    // and merges it with whatever is typed next. CI runs tmux 3.6.
    for (let attempt = 0; attempt < 3; attempt++) {
      tmux('copy-mode', '-t', pane);
      expect(tmux('display', '-p', '-t', pane, '#{pane_in_mode}')).toBe('1');
      await page.getByLabel('Terminal input', { exact: true }).press('Escape');
      await expect.poll(() => tmux('display', '-p', '-t', pane, '#{pane_in_mode}'), { intervals: [20], timeout: 250 }).toBe('0');
    }
  } finally {
    await page.close();
    await call(`/projects/${project.id}?deleteSessions=true`, 'DELETE');
  }
});
