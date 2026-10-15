import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const mobile of [false, true]) test(`clipboard: ${mobile ? 'mobile selection' : 'desktop selection'} and paste without history or grid changes`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.status() === 204 ? undefined : response.json();
  };
  const project = await call('/projects', 'POST', { name: 'Clipboard', path: info.projectPath });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Selected screen' });
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const errors: string[] = [];
  const sent: { type: string; data?: string }[] = [];
  let connections = 0;
  let historyRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/history')) historyRequests++; });
  page.on('websocket', socket => {
    connections++;
    socket.on('framesent', frame => sent.push(JSON.parse(String(frame.payload))));
  });
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId);
      localStorage.setItem('jelly-session', sessionId);
      // Loopback is secure in automation. Exercise the actual HTTP fallback
      // used on a tailnet IP, with a real browser clipboard, not a fake writer.
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    }, { token, projectId: project.id, sessionId: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.getByRole('button', { name: 'History', exact: true })).toHaveCount(0);
    const input = page.getByRole('textbox', { name: 'Input', exact: true });
    await input.fill("printf '\\033[2J\\033[H%s\\n' 'COPY_한글_🙂_<tag>&'; sleep 2; printf 'STILL_%s\\n' RUNNING");
    await input.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('COPY_한글_🙂_<tag>&');
    await expect(page.locator('.xterm-rows')).toContainText('STILL_RUNNING');
    await page.getByRole('button', { name: 'Hide keyboard', exact: true }).click();
    await page.waitForTimeout(350);
    const grid = await call(`/sessions/${session.id}`);
    const bounds = await page.locator('.terminal-viewport').boundingBox();
    const opened = connections;
    sent.length = 0;
    const press = async (name: string) => {
      const button = page.getByRole('button', { name, exact: true });
      if (mobile) await button.tap(); else await button.click();
    };
    await press('Select text');
    const text = page.locator('.selection-text');
    await expect(text).toContainText('COPY_한글_🙂_<tag>&');
    await expect(text.locator('tag')).toHaveCount(0);
    if (mobile) await page.screenshot({ path: '.data/screenshots/selection-mobile.png' });
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
    // Select a substring, as native selection handles do, then use a real
    // click/tap. A button taking focus must not lose or expand the range.
    await text.evaluate(element => {
      const node = element.firstChild!;
      const start = node.textContent!.indexOf('COPY_');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 'COPY_한글_🙂_<tag>&'.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
    });
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
    await press('Copy');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.waitForTimeout(350);
    expect(sent).toEqual([]);
    expect(await page.locator('.terminal-viewport').boundingBox()).toEqual(bounds);
    const after = await call(`/sessions/${session.id}`);
    expect([after.pid, after.cols, after.rows]).toEqual([grid.pid, grid.cols, grid.rows]);
    expect(connections).toBe(opened);
    expect(historyRequests).toBe(0);
    await press('Close selection');

    // Read back through a real browser paste into an independent textarea.
    // No clipboard API permissions are needed, just the user's paste gesture.
    await page.evaluate(() => {
      const field = document.createElement('textarea');
      field.id = 'clipboard-check'; field.style.position = 'fixed'; field.style.top = '0'; field.style.zIndex = '1000';
      document.body.append(field); field.focus();
    });
    const modifier = await page.evaluate(() => /Mac/.test(navigator.platform) ? 'Meta' : 'Control');
    await page.keyboard.press(`${modifier}+V`);
    await expect(page.locator('#clipboard-check')).toHaveValue('COPY_한글_🙂_<tag>&');
    await page.locator('#clipboard-check').evaluate(element => element.remove());

    // Paste through Input and directly into xterm: both must use xterm's
    // bracketed-paste encoding and must not submit an Enter on their own.
    await input.fill("printf '\\033[?2004h'; cat");
    await input.press('Enter');
    await expect.poll(() => page.locator('.xterm-rows').innerText()).toContain('cat');
    for (const target of [input, page.getByLabel('Terminal input', { exact: true })]) {
      await target.focus();
      sent.length = 0;
      await page.keyboard.press(`${modifier}+V`);
      await expect.poll(() => sent.filter(message => message.type === 'input').map(message => message.data).join('')).toBe('\x1b[200~COPY_한글_🙂_<tag>&\x1b[201~');
    }
    // Exit cat, then prove the snapshot remains frozen while the shell works.
    await page.getByLabel('Terminal input', { exact: true }).press('Control+C');
    await input.fill("sleep 2; printf 'SNAPSHOT_%s\\n' UPDATED");
    await input.press('Enter');
    await press('Select text');
    const frozen = await text.innerText();
    await expect(page.locator('.xterm-rows')).toContainText('SNAPSHOT_UPDATED');
    expect(await text.innerText()).toBe(frozen);
    await press('Select all');
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(await text.textContent());
    // If copying is denied, preserve native selection and provide an actionable
    // error. Never report success or read the system clipboard.
    await page.evaluate(() => { document.execCommand = () => false; });
    await press('Copy');
    await expect(page.getByRole('alert')).toHaveText('Copy was blocked. Use your device’s Copy menu.');
    await press('Close selection');
    await expect(page.getByRole('region', { name: 'Select terminal text' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await call(`/sessions/${session.id}/stop`, 'POST');
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
  }
});

for (const macSelection of [false, true]) test(`native terminal selection: ${macSelection ? 'Mac Option' : 'Shift'} drag bypasses tmux mouse capture`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch(`/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.status() === 204 ? undefined : response.json();
  };
  const project = await call('/projects', 'POST', { name: 'Native selection', path: info.projectPath });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Mouse capture' });
  const context = await browser.newContext();
  const page = await context.newPage();
  const sent: string[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.type === 'input') sent.push(message.data);
  }));
  try {
    await page.addInitScript(({ token, projectId, sessionId, macSelection }) => {
      sessionStorage.setItem('jelly-token', token);
      localStorage.setItem('jelly-project', projectId);
      localStorage.setItem('jelly-session', sessionId);
      // Exercise xterm's Mac selection branch on Linux CI too.
      Object.defineProperty(navigator, 'platform', { value: macSelection ? 'MacIntel' : 'Linux x86_64' });
    }, { token, projectId: project.id, sessionId: session.id, macSelection });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    const input = page.getByRole('textbox', { name: 'Input', exact: true });
    await input.fill("printf '\\033[2J\\033[HNATIVE_COPY_OK\\n'");
    await input.press('Enter');
    const row = page.locator('.xterm-rows > div').filter({ hasText: /^NATIVE_COPY_OK/ });
    await expect(row).toHaveCount(1);
    const screen = (await page.locator('.xterm-screen').boundingBox())!;
    const line = (await row.boundingBox())!;
    const { cols } = await call(`/sessions/${session.id}`);
    const cell = screen.width / cols;
    sent.length = 0;
    await page.keyboard.down(macSelection ? 'Alt' : 'Shift');
    await page.mouse.move(screen.x + cell * 0.1, line.y + line.height / 2);
    await page.mouse.down();
    await page.mouse.move(screen.x + cell * 14.1, line.y + line.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up(macSelection ? 'Alt' : 'Shift');
    await expect(page.locator('.xterm-selection > div')).not.toHaveCount(0);
    expect(sent).toEqual([]);
    // The browser runs on Linux in CI, even when xterm's platform is mocked.
    // Its real Ctrl+C/ Ctrl+V gestures exercise the system clipboard round trip.
    await page.keyboard.press('Control+C');
    expect(sent).toEqual([]);
    await input.focus();
    await page.keyboard.press('Control+V');
    await expect.poll(() => sent.join('')).toContain('NATIVE_COPY_OK');
    expect(sent.join('')).not.toContain('\x03');
    // A normal click clears selection; Ctrl+C must then reach the program.
    await page.locator('.xterm-screen').click();
    sent.length = 0;
    await page.keyboard.press('Control+C');
    await expect.poll(() => sent.join('')).toContain('\x03');
  } finally {
    await context.close();
    await call(`/sessions/${session.id}/stop`, 'POST');
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
  }
});
