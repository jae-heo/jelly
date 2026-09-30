import { sendVirtualKey } from './virtual-keyboard';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('virtual keyboard matches physical terminal keys and preserves input focus', async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const log = join(info.projectPath, 'key-input.bin');
  const probe = join(info.projectPath, 'key-probe.cjs');
  writeFileSync(log, '');
  writeFileSync(probe, `
    const fs = require('node:fs');
    process.stdin.setRawMode(true);
    let application = false;
    process.stdout.write('\\x1b[?1l\\x1b[?2004lKEY_PROBE_READY\\r\\n');
    process.stdin.on('data', data => {
      fs.appendFileSync(${JSON.stringify(log)}, data);
      if (data.length === 1 && data[0] === 14) {
        application = !application;
        process.stdout.write(application ? '\\x1b[?1hMODE_APPLICATION\\r\\n' : '\\x1b[?1lMODE_NORMAL\\r\\n');
      }
    });
  `);
  const project = await call('/projects', 'POST', { name: '보조 키', path: info.projectPath });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: '키 입력 검증' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('연결됨');
    await page.getByRole('button', { name: '입력창 표시', exact: true }).click();
    const composer = page.getByLabel('명령어 또는 메시지');
    const physical = page.getByLabel('터미널 입력', { exact: true });
    await composer.fill(`${shellQuote(process.execPath)} ${shellQuote(probe)}`);
    await page.getByRole('button', { name: '입력 보내기', exact: true }).click();
    await sendVirtualKey(page, 'Enter');
    await expect(page.locator('.xterm-rows')).toContainText('KEY_PROBE_READY');
    const capture = async (action: () => Promise<unknown>) => {
      const start = readFileSync(log).length;
      await action();
      await expect.poll(() => readFileSync(log).length).toBeGreaterThan(start);
      return readFileSync(log).subarray(start).toString('hex');
    };
    const compare = async (button: string, key: string) => {
      const expected = await capture(() => physical.press(key));
      await composer.focus();
      const received = await capture(() => sendVirtualKey(page, button));
      expect(received, button).toBe(expected);
      await expect(composer).toBeFocused();
    };
    // Both submission paths only paste the draft. A following Ctrl+G marks the
    // end of queued input so an accidentally appended Enter cannot escape detection.
    for (const viaKeyboard of [false, true]) {
      const draft = viaKeyboard ? 'keyboard-send' : '한글 보내기';
      await composer.fill(draft);
      const start = readFileSync(log).length;
      if (viaKeyboard) await composer.press('Enter');
      else await page.getByRole('button', { name: '입력 보내기', exact: true }).tap();
      await expect(composer).toHaveValue('');
      await expect(composer).toBeFocused();
      await physical.press('Control+g');
      await expect.poll(() => readFileSync(log).subarray(start).toString('hex'))
        .toBe(Buffer.from(draft + '\x07').toString('hex'));
      await composer.focus();
      expect(await capture(() => sendVirtualKey(page, 'Enter'))).toBe('0d');
      await expect(composer).toBeFocused();
    }
    for (const [button, key] of [['Esc', 'Escape'], ['Tab', 'Tab'], ['Enter', 'Enter'], ['Ctrl C', 'Control+c'], ['Ctrl R', 'Control+r']]) {
      await compare(button!, key!);
    }
    await page.getByRole('button', { name: '가상 키보드 열기', exact: true }).tap();
    for (const application of [false, true]) {
      if (application) {
        await capture(() => physical.press('Control+n'));
        await expect(page.locator('.xterm-rows')).toContainText('MODE_APPLICATION');
      }
      await page.getByRole('button', { name: '이동', exact: true }).tap();
      for (const [button, key] of [['위 화살표', 'ArrowUp'], ['왼쪽 화살표', 'ArrowLeft'], ['Home', 'Home'], ['End', 'End'], ['Page Up', 'PageUp'], ['Delete', 'Delete'], ['Backspace', 'Backspace'], ['Shift Tab', 'Shift+Tab']]) {
        await compare(button!, key!);
      }
    }
    await page.getByRole('button', { name: '문자', exact: true }).tap();
    for (const letter of ['A', 'D', 'G', 'U', 'W', 'Z']) await compare(`Ctrl ${letter}`, `Control+${letter.toLowerCase()}`);
    await page.getByRole('button', { name: 'F1–F12', exact: true }).tap();
    for (const key of ['F1', 'F4', 'F5', 'F10', 'F12']) await compare(key, key);
    expect(await capture(() => physical.press('Shift+Enter'))).toBe('1b5b31333b3275');
    // Paste remains explicit and does not append Enter or run a command.
    await page.getByRole('button', { name: '텍스트 붙여넣기', exact: true }).tap();
    await page.getByLabel('붙여넣을 텍스트').fill('paste-check');
    expect(await capture(() => page.getByRole('button', { name: '터미널로 보내기', exact: true }).click())).toBe(Buffer.from('paste-check').toString('hex'));
    await page.setViewportSize({ width: 320, height: 520 });
    await expect(page.getByRole('button', { name: 'F12', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '입력창 숨기기', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '.data/screenshots/keys-function-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '문자', exact: true }).tap();
    await page.screenshot({ path: '.data/screenshots/keys-control-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '이동', exact: true }).tap();
    await page.screenshot({ path: '.data/screenshots/keys-navigation-mobile.png', fullPage: true });
    // Selecting modifiers/keys does not send anything until explicitly confirmed.
    await page.getByRole('button', { name: '문자', exact: true }).tap();
    await composer.focus();
    const beforeSelection = readFileSync(log).length;
    await page.getByRole('button', { name: 'Ctrl', exact: true }).tap();
    await page.getByRole('button', { name: 'T', exact: true }).tap();
    await expect(page.getByLabel('선택한 키 조합')).toHaveText('Ctrl + T');
    await page.waitForTimeout(150);
    expect(readFileSync(log).length).toBe(beforeSelection);
    expect(await capture(() => page.getByRole('button', { name: '키 조합 보내기', exact: true }).tap())).toBe('14');
    await expect(page.getByRole('button', { name: '키 조합 보내기', exact: true })).toBeDisabled();
    await expect(composer).toBeFocused();
    for (const [button, physicalKey] of [['Alt+c', 'Alt+c'], ['Shift+c', 'Shift+C'], ['Ctrl+위 화살표', 'Control+ArrowUp'], ['Shift+Enter', 'Shift+Enter']]) {
      await compare(button!, physicalKey!);
    }
    const beforeDraft = readFileSync(log).length;
    await composer.fill('first');
    await composer.press('Shift+Enter');
    await expect(composer).toHaveValue('first\n');
    expect(readFileSync(log).length).toBe(beforeDraft);
    await page.getByRole('button', { name: '가상 키보드 닫기', exact: true }).tap();
    await page.getByRole('button', { name: '입력창 숨기기', exact: true }).tap();
    const live = page.getByLabel('라이브 입력', { exact: true });
    expect(await capture(() => live.fill('line'))).toBe(Buffer.from('line').toString('hex'));
    expect(await capture(() => live.press('Shift+Enter'))).toBe('1b5b31333b3275');
    expect(await capture(() => live.press('Enter'))).toBe('0d');
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await call(`/sessions/${session.id}/stop`, 'POST');
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
  }
});
