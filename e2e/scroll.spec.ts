import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

async function swipe(page: Page, direction: 'older' | 'newer') {
  const screen = await page.locator('.xterm-screen').boundingBox();
  if (!screen) throw new Error('Terminal screen not visible');
  const cdp = await page.context().newCDPSession(page);
  const x = screen.x + screen.width / 2;
  const from = screen.y + screen.height * (direction === 'older' ? 0.2 : 0.8);
  const to = screen.y + screen.height * (direction === 'older' ? 0.8 : 0.2);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * step / 12 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}

for (const remote of [false, true]) {
  test(`mobile touch scroll: ${remote ? 'SSH' : 'local'} history, reconnect and input`, async ({ browser, request }) => {
    const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
    const token = readFileSync(info.tokenFile, 'utf8').trim();
    const headers = { Authorization: `Bearer ${token}` };
    const call = async (path: string, method = 'GET', data?: unknown) => {
      const response = await request.fetch(`/api${path}`, { method, headers, data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.status() === 204 ? undefined : response.json();
    };
    const host = remote ? await call('/hosts', 'POST', { name: 'Scroll SSH', target: 'jelly-remote' }) : null;
    const project = await call('/projects', 'POST', {
      name: '프로젝트 이름이 길어도 한 줄 헤더에서 터미널을 넓게 쓰는 작업 공간', path: remote ? info.remoteRoot + '/remote-project' : info.projectPath, hostId: host?.id,
    });
    const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: '길게 실행 중인 세션 이름도 메뉴를 밀어내지 않는 터미널 작업' });
    // EDITOR can select vi bindings, where Esc normally only clears a selection.
    if (!remote) execFileSync('tmux', ['-S', join(dirname(info.tokenFile), 'tmux.sock'),
      'set-window-option', '-t', `jelly-${session.id}`, 'mode-keys', 'vi']);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('/');
      await page.evaluate(({ projectId, sessionId }) => {
        localStorage.setItem('jelly-project', projectId);
        localStorage.setItem('jelly-session', sessionId);
      }, { projectId: project.id, sessionId: session.id });
      await page.reload();
      await page.getByLabel('연결 키', { exact: true }).fill(token);
      await page.getByRole('button', { name: '연결', exact: true }).click();
      await expect(page.locator('.connection-label')).toHaveText('연결됨');
      await page.setViewportSize({ width: 320, height: 568 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: '기록', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: '더 보기', exact: true })).toBeInViewport();
      await page.setViewportSize({ width: 390, height: 844 });
      const rows = page.locator('.xterm-rows');
      const firstLine = async () => {
        const values = (await rows.innerText()).match(/SCROLL_\d{3}/g) ?? [];
        return Math.min(...values.map(value => Number(value.slice(7))));
      };
      await page.getByRole('button', { name: '입력창 표시', exact: true }).click();
      await page.getByLabel('명령어 또는 메시지').fill('i=1; while [ "$i" -le 120 ]; do printf "SCROLL_%03d\\n" "$i"; i=$((i+1)); done');
      await page.getByRole('button', { name: '입력 보내기' }).click();
      await page.getByRole('button', { name: 'Enter', exact: true }).tap();
      await expect(rows).toContainText('SCROLL_120');
      const latest = await firstLine();
      await swipe(page, 'older');
      await expect.poll(firstLine).toBeLessThan(latest - 3);
      // A swipe must not focus the terminal or change the outer page's scroll position.
      expect(await page.locator('.xterm-helper-textarea').evaluate(el => el === document.activeElement)).toBe(false);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const older = await firstLine();
      await swipe(page, 'newer');
      await expect.poll(firstLine).toBeGreaterThan(older);
      // Scrolling down to the live screen leaves copy mode; ordinary input works again.
      await swipe(page, 'newer');
      await page.getByLabel('명령어 또는 메시지').fill("printf 'AFTER_SCROLL_%s\\n' OK");
      await page.getByRole('button', { name: '입력 보내기' }).click();
      await page.getByRole('button', { name: 'Enter', exact: true }).tap();
      await expect(rows).toContainText('AFTER_SCROLL_OK');
      await page.reload();
      await expect(page.locator('.connection-label')).toHaveText('연결됨');
      const reconnected = await firstLine();
      await swipe(page, 'older');
      await expect.poll(firstLine).toBeLessThan(reconnected - 3);
      // The existing Esc key is another way to leave scrollback immediately.
      await page.getByRole('button', { name: 'Esc', exact: true }).click();
      await expect(rows).toContainText('AFTER_SCROLL_OK');
      await page.locator('.xterm-screen').hover();
      await page.mouse.wheel(0, -250);
      await page.mouse.wheel(0, -250);
      await expect.poll(firstLine).toBeLessThan(reconnected);
      await page.getByRole('button', { name: 'Esc', exact: true }).click();
      await expect(rows).toContainText('AFTER_SCROLL_OK');
      await page.locator('.xterm-screen').tap();
      await expect(page.getByLabel('터미널 입력', { exact: true })).toBeFocused();
      expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await call(`/sessions/${session.id}/stop`, 'POST');
      await call(`/sessions/${session.id}`, 'DELETE');
      await call(`/projects/${project.id}`, 'DELETE');
      if (host) await call(`/hosts/${host.id}`, 'DELETE');
    }
  });
}
