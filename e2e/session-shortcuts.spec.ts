import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`${remote ? 'SSH to local' : 'local to SSH'}: shortcuts cross projects and retain a bounded terminal cache`, async ({ page, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const host = await call('/hosts', 'POST', { name: 'shortcut-host', target: 'jelly-remote' });
  const projects: { id: string; name: string }[] = [];
  const sessions: { id: string; name: string; pid: number; projectId: string }[] = [];
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
    const project = projects.find(project => project.id === sessions[index]!.projectId)!;
    await expect(page.locator('.project-item.selected')).toContainText(project.name);
    await expect(page.locator('.workspace-location > span').first()).toHaveText(project.name);
    await expect(page.locator('.workspace-current > strong')).toHaveText(sessions[index]!.name);
    await expect(page.locator('.terminal-slot:visible')).toHaveAttribute('data-session-id', sessions[index]!.id);
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
    for (const [name, path, hostId] of [
      ['Shortcut project', remote ? info.remoteRoot : info.projectPath, remote ? host.id : null],
      ['Empty project', `${info.browseRoot}/.hidden-folder`, null],
      ['Other project', remote ? info.browseRoot : info.remoteRoot, remote ? null : host.id],
    ]) projects.push(await call('/projects', 'POST', { name, path, hostId }));
    // Interleave creation across projects: traversal must follow the sidebar,
    // not the global session creation timestamps returned by the API.
    for (const [index, name] of [[0, 'Shortcut A'], [2, 'Other session'], [0, 'Shortcut B']] as const) {
      sessions.push(await call(`/projects/${projects[index]!.id}/sessions`, 'POST', { name }));
    }
    [sessions[1], sessions[2]] = [sessions[2]!, sessions[1]!];
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
    await page.keyboard.press('Meta+Shift+Period');
    await selected(1);
    await readyForInput();
    await page.keyboard.press('Meta+Shift+Period');
    await selected(2);
    await readyForInput();
    const warmTickets = tickets;
    const warmSockets = sockets;
    for (const [key, index] of [
      ['Meta+Shift+Comma', 1], ['Meta+Shift+Comma', 0], ['Meta+Shift+Comma', 2],
      ['Meta+Shift+Period', 0], ['Meta+Shift+Period', 1],
    ] as const) {
      await page.keyboard.press(key);
      await selected(index);
    }
    expect(tickets).toBe(warmTickets);
    expect(sockets).toBe(warmSockets);
    expect(input).toEqual([]);

    // A focused text composer must not receive punctuation or block switching.
    await page.getByRole('button', { name: '입력창 표시', exact: true }).click();
    const composer = page.getByLabel('명령어 또는 메시지');
    await composer.fill('draft stays out of the terminal');
    // The old bracket shortcuts are no longer claimed by Jelly.
    for (const code of ['BracketLeft', 'BracketRight']) {
      expect(await composer.evaluate((element, code) => element.dispatchEvent(new KeyboardEvent('keydown', {
        code, key: code === 'BracketLeft' ? '{' : '}', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
      })), code)).toBe(true);
      await expect(page.locator('.session-row.selected strong')).toHaveText(sessions[1]!.name);
    }
    // Composition and extra modifiers must leave selection and default handling alone.
    for (const extra of [{ isComposing: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: false }]) {
      expect(await composer.evaluate((element, extra) => element.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Comma', key: '<', metaKey: true, shiftKey: true, bubbles: true, cancelable: true, ...extra,
      })), extra)).toBe(true);
      await expect(page.locator('.session-row.selected strong')).toHaveText(sessions[1]!.name);
    }
    await composer.press('Meta+Shift+Comma');
    await selected(0);
    expect(input).toEqual([]);

    // Modal editing must keep its target session and draft intact.
    await page.getByRole('button', { name: '새 세션', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('세션 이름').fill('unfinished session');
    await page.keyboard.press('Meta+Shift+Period');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('세션 이름')).toHaveValue('unfinished session');
    await expect(page.locator('.session-row.selected strong')).toHaveText(sessions[0]!.name);
    await dialog.getByRole('button', { name: '취소', exact: true }).click();

    // Manually selecting even an empty project keeps cached terminals mounted.
    await page.locator('.project-item').filter({ hasText: projects[1]!.name }).click();
    await expect(page.locator('.terminal-slot')).toHaveCount(3);
    await expect(page.locator('.terminal-slot:visible')).toHaveCount(0);
    await page.keyboard.press('Meta+Shift+Comma');
    await selected(1);
    await page.locator('.project-item').filter({ hasText: projects[1]!.name }).click();
    await page.keyboard.press('Meta+Shift+Period');
    await selected(2);
    await page.keyboard.press('Meta+Shift+Period');
    await selected(0);
    await page.locator('.project-item').filter({ hasText: projects[2]!.name }).click();
    await page.keyboard.press('Meta+Shift+Comma');
    await selected(2);
    await page.locator('.project-item').filter({ hasText: projects[0]!.name }).click();
    await page.keyboard.press('Meta+Shift+Period');
    await selected(0);
    expect(tickets).toBe(warmTickets);
    expect(sockets).toBe(warmSockets);
    expect(input).toEqual([]);

    // A fourth visit evicts only the oldest connection across all projects.
    // Returning to that session reconnects to the same shell.
    await page.keyboard.press('Meta+Shift+Comma');
    await selected(2);
    await page.keyboard.type("printf '\\nROUTE_%s\\n' CROSS_PROJECT");
    await page.keyboard.press('Enter');
    await expect(page.locator('.terminal-slot:visible .xterm-rows')).toContainText('ROUTE_CROSS_PROJECT');
    for (const other of sessions.slice(0, 2)) {
      expect((await call(`/sessions/${other.id}/history?lines=100`)).text).not.toContain('ROUTE_CROSS_PROJECT');
    }
    sessions.push(await call(`/projects/${projects[2]!.id}/sessions`, 'POST', { name: 'Fourth session' }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('button', { name: /Fourth session/ })).toBeVisible();
    await page.keyboard.press('Meta+Shift+Period');
    await selected(3);
    await expect(page.locator('.terminal-slot')).toHaveCount(3);
    await expect.poll(async () => (await call(`/sessions/${sessions[1]!.id}`)).connected).toBe(false);
    const beforeReturn = tickets;
    await page.keyboard.press('Meta+Shift+Period');
    await selected(0);
    expect(tickets).toBe(beforeReturn);
    await page.keyboard.press('Meta+Shift+Period');
    await selected(1);
    expect(tickets).toBe(beforeReturn + 1);
    for (const session of sessions) {
      const state = await call(`/sessions/${session.id}`);
      expect(state.pid).toBe(session.pid);
      expect(state.status).toBe('running');
    }
    // Logout closes cached connections belonging to every project.
    await page.getByRole('button', { name: '더 보기', exact: true }).click();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(page.getByRole('heading', { name: '서버 연결', exact: true })).toBeVisible();
    await expect.poll(async () => (await call('/sessions')).sessions.filter((session: { connected: boolean }) => session.connected).length).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    for (const session of sessions) await call(`/sessions/${session.id}`, 'DELETE');
    for (const project of projects) await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
