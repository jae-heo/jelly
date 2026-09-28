import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`${remote ? 'SSH' : 'local'}: Command Shift brackets switch project sessions without terminal input`, async ({ page, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'shortcut-host', target: 'jelly-remote' }) : null;
  const projects: { id: string; name: string }[] = [];
  const sessions: { id: string; name: string; pid: number }[] = [];
  const errors: string[] = [];
  const input: string[] = [];
  let tickets = 0;
  let sockets = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/tickets')) tickets++; });
  page.on('websocket', socket => {
    sockets++;
    socket.on('framesent', event => {
      const message = JSON.parse(String(event.payload));
      if (message.type === 'input') input.push(message.data);
    });
  });
  const selected = async (index: number) => {
    await expect(page.locator('.session-row.selected strong')).toHaveText(sessions[index]!.name);
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await expect(page.locator('.terminal-slot:visible .xterm-helper-textarea')).toBeFocused();
  };
  const readyForInput = async () => {
    // Complete tmux's startup queries before measuring user input frames.
    await page.keyboard.press('Control+c');
    await page.keyboard.type("printf '\\nSHORTCUT_%s\\n' READY");
    await page.keyboard.press('Enter');
    await expect(page.locator('.terminal-slot:visible .xterm-rows')).toContainText('SHORTCUT_READY');
    input.length = 0;
  };
  try {
    for (const [name, path] of [
      ['Shortcut project', remote ? info.remoteRoot : info.projectPath],
      ['Other project', remote ? `${info.remoteRoot}/remote-project` : info.browseRoot],
    ]) projects.push(await call('/projects', 'POST', { name, path, hostId: host?.id ?? null }));
    for (const [index, name] of [[0, 'Shortcut A'], [0, 'Shortcut B'], [1, 'Other session']] as const) {
      sessions.push(await call(`/projects/${projects[index]!.id}/sessions`, 'POST', { name }));
    }
    await page.goto('/');
    await page.evaluate(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId);
      localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: projects[0]!.id, sessionId: sessions[0]!.id });
    await page.reload();
    await selected(0);
    await readyForInput();

    // Focus starts inside xterm; the global shortcut must run before xterm.
    await page.keyboard.press('Meta+Shift+BracketRight');
    await selected(1);
    await readyForInput();
    const warmTickets = tickets;
    const warmSockets = sockets;
    for (const [key, index] of [
      ['Meta+Shift+BracketLeft', 0], ['Meta+Shift+BracketLeft', 1],
      ['Meta+Shift+BracketRight', 0], ['Meta+Shift+BracketRight', 1],
    ] as const) {
      await page.keyboard.press(key);
      await selected(index);
    }
    expect(tickets).toBe(warmTickets);
    expect(sockets).toBe(warmSockets);
    expect(input).toEqual([]);

    // A focused text composer must not receive a bracket or block switching.
    await page.getByRole('button', { name: '입력창 표시', exact: true }).click();
    const composer = page.getByLabel('명령어 또는 메시지');
    await composer.fill('draft stays out of the terminal');
    // Composition and extra modifiers must leave selection and default handling alone.
    for (const extra of [{ isComposing: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: false }]) {
      expect(await composer.evaluate((element, extra) => element.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'BracketLeft', key: '{', metaKey: true, shiftKey: true, bubbles: true, cancelable: true, ...extra,
      })), extra)).toBe(true);
      await expect(page.locator('.session-row.selected strong')).toHaveText(sessions[1]!.name);
    }
    await composer.press('Meta+Shift+BracketLeft');
    await selected(0);
    expect(input).toEqual([]);

    // Modal editing must keep its target session and draft intact.
    await page.getByRole('button', { name: '새 세션', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('세션 이름').fill('unfinished session');
    await page.keyboard.press('Meta+Shift+BracketRight');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('세션 이름')).toHaveValue('unfinished session');
    await expect(page.locator('.session-row.selected strong')).toHaveText(sessions[0]!.name);
    await dialog.getByRole('button', { name: '취소', exact: true }).click();

    // A project with no selected session chooses its last/first entry, then
    // a one-session project consumes the shortcut without reconnecting.
    await page.locator('.project-item').filter({ hasText: projects[1]!.name }).click();
    await page.keyboard.press('Meta+Shift+BracketLeft');
    await selected(2);
    const singleTickets = tickets;
    await page.keyboard.press('Meta+Shift+BracketRight');
    await selected(2);
    expect(tickets).toBe(singleTickets);
    await page.locator('.project-item').filter({ hasText: projects[0]!.name }).click();
    await page.keyboard.press('Meta+Shift+BracketRight');
    await selected(0);
    for (const session of sessions) {
      const state = await call(`/sessions/${session.id}`);
      expect(state.pid).toBe(session.pid);
      expect(state.status).toBe('running');
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    for (const session of sessions) await call(`/sessions/${session.id}`, 'DELETE');
    for (const project of projects) await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
