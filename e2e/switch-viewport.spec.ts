import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('switching during keyboard dismissal does not resize a warm terminal to intermediate heights', async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const project = await call('/projects', 'POST', { name: 'Viewport switches', path: info.projectPath });
  const sessions: { id: string; name: string }[] = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const resizes: { id: string; rows: number }[] = [];
  let connections = 0;
  page.on('websocket', socket => {
    connections++;
    const id = new URL(socket.url()).pathname.split('/')[3]!;
    socket.on('framesent', event => {
      const message = JSON.parse(String(event.payload));
      if (message.type === 'resize') resizes.push({ id, rows: message.rows });
    });
  });
  try {
    for (const name of ['One', 'Two']) sessions.push(await call(`/projects/${project.id}/sessions`, 'POST', { name }));
    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId);
      localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: sessions[0]!.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await page.keyboard.press('Meta+Shift+Period');
    await expect(page.locator('.terminal-slot:visible')).toHaveAttribute('data-session-id', sessions[1]!.id);
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await page.waitForTimeout(350);
    const fullRows = (await call(`/sessions/${sessions[1]!.id}`)).rows;
    await page.keyboard.press('Meta+Shift+Comma');
    await page.getByRole('button', { name: '입력창 표시', exact: true }).click();
    await page.getByRole('button', { name: '가상 키보드 열기', exact: true }).tap();
    await page.evaluate(() => {
      Object.defineProperty(visualViewport!, 'height', { configurable: true, value: 460 });
      visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).toHaveClass(/keyboard-open/);
    await page.waitForTimeout(350);
    await expect(page.locator('html')).toHaveClass(/keyboard-open/);
    await page.getByLabel('명령어 또는 메시지').evaluate(el => (el as HTMLTextAreaElement).blur());
    await page.waitForTimeout(40);
    await expect(page.locator('html')).toHaveClass(/keyboard-open/);
    resizes.length = 0;
    const opened = connections;
    // A warm switch hides the old input; the OS starts dismissing its keyboard
    // just after the next frame. Keep the destination's full-size grid intact.
    await page.keyboard.press('Meta+Shift+Period');
    await page.evaluate(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
      for (const height of [530, 640, 760, 844]) {
        Object.defineProperty(visualViewport!, 'height', { configurable: true, value: height });
        visualViewport!.dispatchEvent(new Event('resize'));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });
    await expect(page.locator('.terminal-slot:visible')).toHaveAttribute('data-session-id', sessions[1]!.id);
    await expect(page.getByRole('region', { name: '가상 키보드', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await call(`/sessions/${sessions[1]!.id}`)).rows).toBe(fullRows);
    expect(resizes, 'Cached destination should not be shrunk and expanded during a switch').toEqual([]);
    expect(connections).toBe(opened);
  } finally {
    await context.close();
    for (const session of sessions) await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
  }
});
