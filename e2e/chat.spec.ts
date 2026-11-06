import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

test('chat view shows a Claude Code transcript and sends input through the terminal', async ({ page, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const socket = join(dirname(info.tokenFile), 'tmux.sock');
  const config = mkdtempSync(join(dirname(info.tokenFile), 'claude-config-'));
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const project = await call('/projects', 'POST', { name: 'Chat', path: info.projectPath });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Agent' });
  await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Plain shell' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    expect(await call(`/sessions/${session.id}/chat?probe=true`)).toEqual({ agent: null });
    execFileSync('tmux', ['-S', socket, 'send-keys', '-t', `=jelly-${session.id}:0.0`, '-l',
      `CLAUDE_CONFIG_DIR='${config}' node '${resolve('test/fake-claude.mjs')}'`]);
    execFileSync('tmux', ['-S', socket, 'send-keys', '-t', `=jelly-${session.id}:0.0`, 'Enter']);
    await expect.poll(async () => (await call(`/sessions/${session.id}/chat?probe=true`)).agent?.status, { timeout: 15_000 }).toBe('idle');

    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    const toggle = page.getByRole('button', { name: 'Chat view' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Typing goes to Input, which sends it to the agent in the terminal.
    await expect(page.getByRole('textbox', { name: 'Input', exact: true })).toBeFocused();
    const chat = page.getByRole('region', { name: 'Chat' });
    await expect(chat.locator('.chat-user p')).toHaveText(['FIRST_QUESTION']);
    await expect(chat.locator('.chat-note').first()).toHaveText('/model opus');
    await expect(chat.locator('.md-heading')).toHaveText('Plan');
    await expect(chat.locator('.chat-assistant strong').first()).toHaveText('ls');
    await expect(chat.locator('.md-code pre code')).toHaveText('ls -la');
    await expect(chat.locator('.md-table th')).toHaveText(['a', 'b']);
    await expect(chat.locator('.md-table td')).toHaveText(['1', '2']);
    await expect(chat.locator('.chat-assistant > ul > li')).toHaveCount(2);
    await expect(chat.locator('.chat-assistant li ul > li')).toHaveText(['nested item']);
    await expect(chat.locator('.chat-assistant > ol > li')).toHaveText(['one', 'two']);
    await expect(chat.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.com/docs');
    // Only http(s) links are clickable; agent text is never rendered as HTML.
    await expect(chat.getByRole('link', { name: 'bad' })).toHaveCount(0);
    await expect(chat.locator('.chat-assistant').last()).toHaveText('<b>not html</b> FIRST_ANSWER');
    await expect(chat).not.toContainText('hidden');
    // Consecutive tool calls are one collapsed row with a failure count.
    const group = chat.locator('.chat-tools');
    await expect(group).toHaveCount(1);
    await expect(group.locator('> summary')).toContainText('Bash ×2 · Edit');
    await expect(group.locator('.chat-failed-count')).toHaveText('1');
    await group.locator('> summary').click();
    const tool = group.locator('.chat-tool').first();
    await expect(tool.locator('summary')).toContainText('List files');
    await expect(tool.getByLabel('Done')).toBeVisible();
    await tool.locator('summary').click();
    await expect(tool.locator('.chat-command')).toHaveText('ls -la\necho second line');
    await expect(tool.locator('.chat-output')).toHaveText('TOOL_OUTPUT_OK');
    const edit = group.locator('.chat-tool').nth(1);
    await edit.locator('summary').click();
    await expect(edit.locator('.chat-diff .removed')).toHaveText('const a = 1;\n');
    await expect(edit.locator('.chat-diff .added')).toHaveText('const a = 2;\n');
    await expect(group.locator('.chat-tool').nth(2).getByLabel('Failed')).toBeVisible();
    await expect(chat.getByRole('status')).toContainText('Idle');

    // Input still goes to the terminal; the reply arrives from the transcript.
    const input = page.getByRole('textbox', { name: 'Input', exact: true });
    // The agent's prompt is shown while typing; its dim placeholder is not.
    const prompt = chat.getByRole('group', { name: 'Prompt' });
    await expect(prompt).toHaveCount(0);
    await input.fill('hello chat 한글');
    await expect(prompt).toHaveText('hello chat 한글');
    await input.press('Enter');
    await expect(prompt).toHaveCount(0);
    await expect(chat.locator('.chat-user p').last()).toHaveText('hello chat 한글');
    await expect(chat.getByRole('status')).toContainText('Working');
    await expect(chat.locator('.chat-assistant').last()).toHaveText('Echo: hello chat 한글');
    await expect(chat.getByRole('status')).toContainText('Idle');

    // Text left in the prompt stays visible after Input is cleared, and long
    // drafts keep the rows the agent wrapped them into.
    const long = `draft-${'x'.repeat(400)}-end`;
    await input.fill(long);
    await input.press('Tab');
    await expect(input).toHaveValue('');
    await expect.poll(async () => (await prompt.innerText()).split('\n').length).toBeGreaterThan(1);
    expect((await prompt.innerText()).replace(/\n/g, '')).toBe(long);
    await input.press('Control+u');

    // The choice is kept per session on this device.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Chat' }).locator('.chat-user p').last()).toHaveText('hello chat 한글');
    await input.fill('/clear');
    await input.press('Enter');
    await expect(chat.locator('.chat-assistant')).toHaveText(['CLEARED_CONVERSATION']);
    await expect(chat.locator('.chat-user p')).toHaveCount(0);

    // Losing the terminal connection shows Reconnect above the chat.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.locator('.connection-overlay').getByRole('button', { name: 'Reconnect' }).click({ timeout: 5000 });
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(chat.locator('.chat-assistant')).toHaveText(['CLEARED_CONVERSATION']);

    await chat.getByRole('button', { name: 'Terminal' }).click();
    await expect(chat).toHaveCount(0);
    await expect(page.locator('.xterm-rows')).toContainText('FAKE_CLAUDE_READY');

    // A plain shell offers no chat view.
    await page.getByRole('button', { name: /^Plain shell ·/ }).click();
    await expect(page.locator('.workspace-current strong')).toHaveText('Plain shell');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.getByRole('button', { name: 'Chat view' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await call(`/projects/${project.id}?deleteSessions=true`, 'DELETE');
  }
});
