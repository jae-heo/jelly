import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`uploads: ${remote ? 'SSH' : 'local'} attach, drop and paste put temp paths in the terminal`, async ({ browser, request, browserName }) => {
  test.skip(remote && browserName === 'webkit', 'SSH upload transport is covered in Chromium');
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch('/api' + path, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'Upload host', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: 'Uploads', path: remote ? info.remoteRoot + '/remote-project' : info.projectPath, hostId: host?.id });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Upload shell' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const input = page.getByRole('textbox', { name: 'Input', exact: true });
  const rows = page.locator('.xterm-rows');
  const uploaded = (name: string) => new RegExp(`/jelly-[0-9a-f]{32}/[\\w-]{12}/${name}`);
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      sessionStorage.setItem('jelly-token', token); localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');

    // The attach button commits what Input holds, then pastes the path after it.
    await input.fill('cat ');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach files', exact: true }).click();
    await (await chooser).setFiles({ name: '메모 1.txt', mimeType: 'text/plain', buffer: Buffer.from('UPLOAD_ONE_OK\n') });
    await expect(rows).toContainText(uploaded('메모_1\\.txt'));
    await expect(input).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
    await input.press('Enter');
    await expect(rows).toContainText('UPLOAD_ONE_OK');

    // Several files dropped on the terminal are pasted in order.
    await input.fill('cat ');
    const files = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['UPLOAD_TWO_OK\n'], 'two.txt', { type: 'text/plain' }));
      data.items.add(new File(['UPLOAD_THREE_OK\n'], "three 'x'.txt", { type: 'text/plain' }));
      return data;
    });
    await page.locator('.xterm-screen').dispatchEvent('dragover', { dataTransfer: files });
    await expect(page.getByText('Drop to attach', { exact: true })).toBeVisible();
    await page.locator('.xterm-screen').dispatchEvent('drop', { dataTransfer: files });
    await expect(page.getByText('Drop to attach', { exact: true })).toHaveCount(0);
    await expect(rows).toContainText(uploaded('three__x_\\.txt'));
    await input.press('Enter');
    await expect(rows).toContainText(/UPLOAD_TWO_OK\s*UPLOAD_THREE_OK/);

    // A pasted screenshot is attached; pasted text stays text.
    await input.fill('wc -c ');
    await input.evaluate((field: HTMLTextAreaElement) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(67)], 'image.png', { type: 'image/png' }));
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(rows).toContainText(uploaded('image\\.png'));
    await input.press('Enter');
    await expect(rows).toContainText(/67 \/\S+\/image\.png/);

    const big = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'big.bin'));
      return data;
    });
    await page.locator('.xterm-screen').dispatchEvent('drop', { dataTransfer: big });
    await expect(page.getByRole('alert')).toContainText('Files up to 50 MiB can be uploaded');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
