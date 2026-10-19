import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const remote of [false, true]) test(`project files: ${remote ? 'SSH' : 'local'} mobile viewer and browser downloads`, async ({ browser, request }) => {
  const info = JSON.parse(readFileSync('.data/browser-test-info.json', 'utf8'));
  const token = readFileSync(info.tokenFile, 'utf8').trim();
  const call = async (path: string, method = 'GET', data?: unknown) => {
    const response = await request.fetch('/api' + path, { method, data, headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const host = remote ? await call('/hosts', 'POST', { name: 'File host', target: 'jelly-remote' }) : null;
  const project = await call('/projects', 'POST', { name: 'File viewer', path: remote ? info.remoteFilePath : info.fileProjectPath, hostId: host?.id });
  const session = await call(`/projects/${project.id}/sessions`, 'POST', { name: 'Still running' });
  // Full Chromium includes the built-in PDF viewer; headless shell does not.
  const pdfBrowser = browser.browserType().name() === 'chromium' ? await chromium.launch({ channel: 'chromium' }) : null;
  const context = await (pdfBrowser ?? browser).newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let connections = 0;
  page.on('websocket', () => connections++);
  try {
    await page.addInitScript(({ token, projectId, sessionId }) => {
      if (window !== window.top) return; // Do not inject app credentials into the PDF viewer's frames.
      sessionStorage.setItem('jelly-token', token); localStorage.setItem('jelly-project', projectId); localStorage.setItem('jelly-session', sessionId);
    }, { token, projectId: project.id, sessionId: session.id });
    await page.goto('/');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    const originalConnections = connections;
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Files' });
    const list = page.getByRole('region', { name: 'Project files' });
    await expect(list.getByRole('button', { name: 'nested', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Parent', exact: true })).toBeDisabled();
    await expect(list.getByRole('button', { name: '.hidden.txt', exact: true })).toHaveCount(0);
    await page.getByLabel('Hidden files', { exact: true }).check();
    await expect(list.getByRole('button', { name: '.hidden.txt', exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search files' }).fill('nested');
    await expect(list.getByRole('button')).toHaveCount(1);
    await list.getByRole('button', { name: 'nested', exact: true }).click();
    await list.getByRole('button', { name: '보고서 & note.txt', exact: true }).click();
    const preview = page.getByRole('region', { name: 'File preview' });
    await expect(preview).toContainText('<script>window.previewExecuted = true</script>');
    await expect(preview).toContainText('한글 🙂');
    expect(await page.evaluate(() => (window as any).previewExecuted)).toBeUndefined();
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeInViewport();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('보고서 & note.txt');
    expect(await download.failure()).toBeNull();
    expect(readFileSync((await download.path())!, 'utf8')).toContain('한글 🙂');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Parent', exact: true }).click();
    await list.getByRole('button', { name: 'pixel.png', exact: true }).click();
    await expect(preview.getByRole('img', { name: 'pixel.png' })).toBeVisible();
    await expect.poll(() => preview.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await list.getByRole('button', { name: 'sample.pdf', exact: true }).click();
    await expect(preview.locator('iframe')).toHaveAttribute('src', /^blob:/);
    if (pdfBrowser) {
      await expect.poll(() => page.frames().some(frame => frame.url().startsWith('chrome-extension:'))).toBe(true);
      const viewer = page.frames().find(frame => frame.url().startsWith('chrome-extension:'))!;
      await expect(viewer.locator('embed')).toBeVisible();
      await page.screenshot({ path: `.data/screenshots/files-pdf-${remote ? 'ssh' : 'local'}.png` });
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await list.getByRole('button', { name: 'archive.bin', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Preview is not available');
    const binaryReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const binary = await binaryReady;
    expect(await binary.failure()).toBeNull();
    expect(readFileSync((await binary.path())!)).toEqual(Buffer.from([0, 255, 65, 66]));
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    expect(connections).toBe(originalConnections);
    expect((await call(`/sessions/${session.id}`)).pid).toBe(session.pid);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await pdfBrowser?.close();
    await call(`/sessions/${session.id}`, 'DELETE');
    await call(`/projects/${project.id}`, 'DELETE');
    if (host) await call(`/hosts/${host.id}`, 'DELETE');
  }
});
