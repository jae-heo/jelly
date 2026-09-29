import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

test('live input: native composition, Korean fallback, ordered controls, edits and session isolation', async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const project = await call('/projects', 'POST', { name: '라이브 입력', path: info.projectPath });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: '입력 A' });
  const second = await call(`/projects/${project.id}/sessions`, 'POST', { name: '입력 B' });
  const log = join(info.projectPath, 'live-input.bin');
  const probe = join(info.projectPath, 'live-input-probe.cjs');
  writeFileSync(log, '');
  writeFileSync(probe, `const fs = require('node:fs'); process.stdin.setRawMode(true); process.stdout.write('\\x1b[?2004lLIVE_READY\\r\\n'); process.stdin.on('data', data => fs.appendFileSync(${JSON.stringify(log)}, data));`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors: string[] = [];
  const inputFrames: { id: string; data: string }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    const id = new URL(socket.url()).pathname.split('/')[3]!;
    socket.on('framesent', frame => {
      const event = JSON.parse(String(frame.payload));
      if (event.type === 'input') inputFrames.push({ id, data: event.data });
    });
  });
  const live = page.getByRole('textbox', { name: '라이브 입력', exact: true });
  const compose = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const expected = async (start: number, value: string) => {
    await expect.poll(() => readFileSync(log).subarray(start).toString('hex')).toBe(Buffer.from(value).toString('hex'));
  };
  const fieldValue = async (text: string) => live.evaluate((field: HTMLTextAreaElement, value) => {
    field.value = value; field.setSelectionRange(value.length, value.length);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }, text);
  try {
    await page.goto('/');
    await page.evaluate(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token); localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.reload();
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await expect(live).toBeVisible();
    await expect(live).not.toBeFocused();
    await page.locator('.xterm-screen').tap();
    await expect(live).toBeFocused();
    await live.fill(`${shellQuote(process.execPath)} ${shellQuote(probe)}`);
    await page.getByRole('button', { name: 'Enter', exact: true }).tap();
    await expect(page.locator('.xterm-rows')).toContainText('LIVE_READY');

    let start = readFileSync(log).length;
    await compose('ㅎ');
    await page.waitForTimeout(360); // Even a pause must not leak active preedit jamo.
    expect(readFileSync(log).length).toBe(start);
    for (const value of ['하', '한', '한ㄱ', '한그', '한글']) await compose(value);
    await expected(start, '한');
    await cdp.send('Input.insertText', { text: '한글' });
    await expected(start, '한글');
    await live.press('Enter');
    await expected(start, '한글\r');
    await expect(live).toHaveValue('');
    await expect(live).toBeFocused();

    // The accessory key commits the native IME first and reaches the PTY once.
    start = readFileSync(log).length;
    for (const value of ['ㄱ', '가', '간', '가나']) await compose(value);
    await page.getByRole('button', { name: 'Enter', exact: true }).tap();
    await expected(start, '가나\r');
    await expect(live).toBeFocused();
    start = readFileSync(log).length;
    await compose('한');
    await page.getByRole('button', { name: 'Ctrl C', exact: true }).tap();
    await expected(start, '한\x03');

    // Model keyboards that update the field without composition events.
    start = readFileSync(log).length;
    for (const value of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) await fieldValue(value);
    await expected(start, '한글');
    await live.press('Control+g');
    await expected(start, '한글\x07');
    start = readFileSync(log).length;
    await fieldValue('하');
    await expected(start, '하');
    await fieldValue('한');
    await expected(start, '하\x7f한');
    await live.press('Control+g');
    await expected(start, '하\x7f한\x07');

    start = readFileSync(log).length;
    await live.pressSequentially('abc');
    await live.press('Backspace');
    await live.press('Control+g');
    await live.press('Backspace');
    await expected(start, 'abc\x7f\x07\x7f');
    start = readFileSync(log).length;
    await live.fill('🙂');
    await live.press('Backspace');
    await live.press('Control+g');
    await expected(start, '🙂\x7f\x07');

    // Paste has no implicit Enter and ends the local mirror before later edits.
    start = readFileSync(log).length;
    await live.fill('a');
    await live.evaluate(field => {
      const data = new DataTransfer(); data.setData('text/plain', '붙여넣기');
      field.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await live.fill('b');
    await live.press('Control+g');
    await expected(start, 'a붙여넣기b\x07');

    // Browsers can emit a line-break beforeinput without a keydown.
    start = readFileSync(log).length;
    await live.fill('mobile');
    await live.evaluate(field => field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertLineBreak' })));
    await expected(start, 'mobile\r');
    await page.getByRole('button', { name: '키보드 닫기', exact: true }).tap();
    await expect(live).not.toBeFocused();
    await expect(live).toBeVisible();
    await live.tap();
    await expect(live).toBeFocused();
    await page.setViewportSize({ width: 320, height: 520 });
    await expect(live).toBeInViewport();
    await expect(page.getByRole('button', { name: '키보드 닫기', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    mkdirSync('.data/screenshots', { recursive: true });
    await page.screenshot({ path: '.data/screenshots/live-input-mobile.png', fullPage: true });

    // A settling syllable can never be sent to the next session by its timer.
    await fieldValue('미');
    await page.getByRole('button', { name: '프로젝트와 세션 열기' }).tap();
    await page.getByRole('button', { name: /입력 B/ }).tap();
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await page.waitForTimeout(360);
    // xterm can send terminal capability replies during attachment; none may
    // contain the pending text owned by the previous session.
    expect(inputFrames.filter(frame => frame.id === second.id).map(frame => frame.data).join('')).not.toContain('미');
    await expect(live).toHaveValue('');
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    for (const item of [session, second]) { await call(`/sessions/${item.id}/stop`, 'POST'); await call(`/sessions/${item.id}`, 'DELETE'); }
    await call(`/projects/${project.id}`, 'DELETE');
  }
});
