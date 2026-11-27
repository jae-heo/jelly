import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('terminal links open with ⌘/Ctrl-click, including wrapped URLs and project files', async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch('/api' + path, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const project = await call('/projects', 'POST', { name: 'Links', path: info.projectPath });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Link shell' });
  const context = await browser.newContext();
  await context.route('https://jelly.test/**', route => route.fulfill({ body: 'ok' }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  mkdirSync(join(info.projectPath, 'link-out'), { recursive: true });
  writeFileSync(join(info.projectPath, 'link-out', 'report.html'), '<h1>LINK_REPORT</h1>');
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      if (window !== window.top) return; // Do not inject app credentials into the previewed page.
      sessionStorage.setItem('jelly-token', token); localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await page.locator('.xterm-screen').click();
    await page.keyboard.type(`clear; printf 'see %s\\n' 'https://jelly.test/a?b=(1).'; printf 'https://jelly.test/%0400d\\n' 0; printf 'Wrote link-out/report.html, open %s:3.\\n' '${info.projectPath}/link-out/report.html'\n`);
    const rows = page.locator('.xterm-rows > div');
    const short = rows.filter({ hasText: /^see https:\/\/jelly\.test\/a/ });
    const long = rows.filter({ hasText: /^https:\/\/jelly\.test\/0+$/ });
    const file = rows.filter({ hasText: /^Wrote link-out/ });
    await expect(short).toHaveCount(1);
    await expect(long).toHaveCount(1);
    const screen = (await page.locator('.xterm-screen').boundingBox())!;
    await expect.poll(async () => (await call(`/sessions/${session.id}`)).cols).toBeGreaterThan(0);
    const cell = screen.width / (await call(`/sessions/${session.id}`)).cols;
    const at = async (row: typeof short, column: number) => {
      const box = (await row.boundingBox())!;
      return { x: screen.x + cell * (column + 0.5), y: box.y + box.height / 2 };
    };
    const opened = async (point: { x: number; y: number }) => {
      const popup = context.waitForEvent('page');
      await page.mouse.move(point.x, point.y);
      await page.keyboard.down('Control');
      await page.mouse.move(point.x + 1, point.y);
      await page.mouse.click(point.x + 1, point.y);
      await page.keyboard.up('Control');
      const target = await popup;
      const url = target.url() === 'about:blank' ? (await target.waitForURL(/jelly\.test/), target.url()) : target.url();
      await target.close();
      return url;
    };

    // A plain click goes to the program, not the browser.
    const point = await at(short, 8);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(500);
    expect(context.pages()).toHaveLength(1);
    // Closing punctuation of the sentence is not part of the URL.
    expect(await opened(point)).toBe('https://jelly.test/a?b=(1)');
    // tmux draws a long URL over several rows; any of them opens the whole URL.
    const rest = rows.nth(await long.evaluate(row => Array.from(row.parentElement!.children).indexOf(row)) + 1);
    expect(await opened(await at(rest, 2))).toBe('https://jelly.test/' + '0'.repeat(400));

    // Holding the modifier over a link shows it as one.
    const pointer = page.locator('.xterm-cursor-pointer');
    const word = await at(file, 8);
    await page.mouse.move(word.x, word.y);
    await page.mouse.move(word.x + 1, word.y);
    await expect(pointer).toHaveCount(0);
    await page.keyboard.down('Control');
    await expect(pointer).toHaveCount(1);
    await page.keyboard.up('Control');
    await expect(pointer).toHaveCount(0);
    // Paths of files in the project open in Files, relative or absolute.
    const files = page.getByRole('dialog', { name: 'Files' });
    for (const column of [8, 'Wrote link-out/report.html, open '.length + 4]) {
      const point = await at(file, column);
      await page.mouse.move(point.x, point.y);
      await page.keyboard.down('Control');
      await page.mouse.move(point.x + 1, point.y);
      await page.mouse.click(point.x + 1, point.y);
      await page.keyboard.up('Control');
      await expect(files.locator('.files-location')).toHaveText('Links / link-out/report.html');
      await expect(page.frameLocator('.file-preview iframe').locator('h1')).toHaveText('LINK_REPORT');
      await files.getByRole('button', { name: 'Close' }).click();
      await expect(files).toHaveCount(0);
    }
    expect(context.pages()).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    rmSync(join(info.projectPath, 'link-out'), { recursive: true, force: true });
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
  }
});
