#!/usr/bin/env node
// Capture the real UI against a disposable local Jelly server. No production data.
// Run npm run build:test first, then FFMPEG=/path/to/ffmpeg node scripts/capture-demo.mjs.
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { loadConfig } from '../.data/test-build/src/config.js';
import { startServer } from '../.data/test-build/src/server.js';

const exec = promisify(execFile);
const output = resolve('docs/media');
const withCodex = process.env.JELLY_DEMO_CODEX === '1';
const scratch = await mkdtemp(withCodex ? join(tmpdir(), 'jelly-demo-') : resolve('.data/media-'));
let config, app, browser, recording = false, frameTask;
let frameCount = 0;
let mobileVideoStart = 0, mobileVideoDuration = 0, mobileVideoPath;
try {
  const quote = text => "'" + text.replaceAll("'", "'\"'\"'") + "'";
  const codexHome = join(scratch, 'codex');
  const frames = join(scratch, 'frames');
  await mkdir(output, { recursive: true });
  await mkdir(frames);
  const atlas = join(scratch, 'atlas');
  const toolbox = join(scratch, 'toolbox');
  await mkdir(atlas); await mkdir(toolbox);
  if (withCodex) {
    await mkdir(codexHome, { mode: 0o700 });
    await copyFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), join(codexHome, 'auth.json'));
    await writeFile(join(codexHome, 'config.toml'), 'check_for_update_on_startup = false\n');
  }
  const rc = join(scratch, 'bashrc');
  const npmConfig = join(scratch, 'npmrc');
  const npmGlobalConfig = join(scratch, 'npmrc-global');
  await writeFile(npmConfig, '');
  await writeFile(npmGlobalConfig, '');
  await writeFile(rc, String.raw`PS1='\[\e[32m\]\W\[\e[0m\] $ '
  HISTFILE=/dev/null
  unset PROMPT_COMMAND
  export npm_config_update_notifier=false
  export npm_config_userconfig='${npmConfig}'
  export npm_config_globalconfig='${npmGlobalConfig}'
  ${withCodex ? `export CODEX_HOME=${quote(codexHome)}\nalias codex='codex --no-daemon'` : ''}
  `);
  const shell = join(scratch, 'shell');
  await writeFile(shell, `#!/bin/sh\nexec /bin/bash --noprofile --rcfile '${rc}' -i\n`, { mode: 0o700 });
  await writeFile(join(atlas, 'package.json'), JSON.stringify({ name: 'atlas', version: '1.0.0', type: 'module', scripts: { dev: 'node server.mjs', test: 'node --test --test-reporter=spec' } }, null, 2));
  await writeFile(join(atlas, 'server.mjs'), `import { createServer } from 'node:http';
  import { writeFileSync } from 'node:fs';
  export function route(path) {
    if (path === '/health') return { status: 200, body: { ok: true } };
    if (path === '/api/projects') return { status: 200, body: { projects: ['atlas', 'toolbox'] } };
    return { status: 404, body: { error: 'Not found' } };
  }
  if (process.argv[1]?.endsWith('server.mjs')) {
    const server = createServer((req, res) => {
      const result = route(req.url);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
      console.log('  GET ' + req.url.padEnd(18) + '\\x1b[32m' + result.status + '\\x1b[0m');
    });
    server.listen(0, '127.0.0.1', () => {
      writeFileSync('.port', String(server.address().port));
      console.log('\\n  \\x1b[32mAtlas\\x1b[0m · development server\\n');
      console.log('  Local: http://localhost:' + server.address().port);
      console.log('  Press Ctrl+C to stop.\\n');
    });
  }
  `);
  await writeFile(join(atlas, 'routes.test.mjs'), `import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { route } from './server.mjs';
  test('health check returns 200', () => assert.equal(route('/health').status, 200));
  test('health response is ready', () => assert.equal(route('/health').body.ok, true));
  test('project list returns 200', () => assert.equal(route('/api/projects').status, 200));
  test('project names are preserved', () => assert.deepEqual(route('/api/projects').body.projects, ['atlas', 'toolbox']));
  test('unknown routes return 404', () => assert.equal(route('/missing').status, 404));
  test('errors have a readable message', () => assert.equal(route('/missing').body.error, 'Not found'));
  `);
  await writeFile(join(toolbox, 'README.md'), '# Toolbox\n\nSmall scripts for everyday work.\n');
  process.env.JELLY_DATA_DIR = join(scratch, 'runtime');
  process.env.JELLY_HOST = '127.0.0.1';
  process.env.JELLY_PORT = '0';
  process.env.JELLY_SHELL = shell;
  process.env.JELLY_SSH_CONFIG = join(scratch, 'ssh-config');
  await writeFile(process.env.JELLY_SSH_CONFIG, '');
  config = loadConfig();
  app = await startServer(config);
  const origin = `http://127.0.0.1:${app.port}`;
  config.origins.add(origin);
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(origin + '/api' + path, { method, headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Demo API: ${response.status}`);
    return response.json();
  };
  const project = await api('/projects', 'POST', { name: 'Atlas', path: atlas });
  const other = await api('/projects', 'POST', { name: 'Toolbox', path: toolbox });
  const dev = await api(`/projects/${project.id}/sessions`, 'POST', { name: withCodex ? 'Codex' : 'Dev server' });
  const tests = await api(`/projects/${project.id}/sessions`, 'POST', { name: 'Tests' });
  const tools = await api(`/projects/${other.id}/sessions`, 'POST', { name: 'Shell' });
  const tmux = (...args) => exec('tmux', ['-S', config.socket, ...args]);
  const command = async (session, text) => {
    await tmux('send-keys', '-t', `jelly-${session.id}`, '-l', text);
    await tmux('send-keys', '-t', `jelly-${session.id}`, 'Enter');
  };
  if (!withCodex) {
    await command(dev, 'npm run dev');
    await expect.poll(async () => { try { return Number(await readFile(join(atlas, '.port'), 'utf8')); } catch { return 0; } }).toBeGreaterThan(0);
    const demoPort = Number(await readFile(join(atlas, '.port'), 'utf8'));
    for (const path of ['/health', '/api/projects', '/health', '/api/projects', '/health']) await fetch(`http://127.0.0.1:${demoPort}${path}`);
  }
  await command(tests, 'npm test');
  await expect.poll(async () => (await tmux('capture-pane', '-p', '-t', `jelly-${tests.id}`)).stdout).toContain('pass 6');
  await command(tools, 'node --version');
  await command(tools, 'ls');
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 680 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ token, projectId, sessionId }) => {
    sessionStorage.setItem('jelly-token', token);
    if (!localStorage.getItem('jelly-project')) localStorage.setItem('jelly-project', projectId);
    if (!localStorage.getItem('jelly-session')) localStorage.setItem('jelly-session', sessionId);
    localStorage.setItem('jelly-font-size', '17');
  }, { token: config.token, projectId: project.id, sessionId: tests.id });
  const page = await context.newPage();
  const ready = () => expect(page.locator('.connection-label')).toHaveText('Connected');
  const select = async name => { await page.getByRole('button', { name: `${name} · Running`, exact: true }).click(); await ready(); await delay(350); };
  await page.goto(origin); await ready();
  // Warm the actual terminal cache before recording; no mock UI or transport.
  await select(withCodex ? 'Codex' : 'Dev server'); await select('Shell'); await select('Tests');
  await expect(page.locator('.terminal-slot:visible .xterm-rows')).toContainText('pass 6');
  if (withCodex) {
    await select('Codex');
    await command(dev, 'codex');
    // Only open the real CLI and compose a prompt; no model task is submitted.
    await delay(3000);
    const pane = () => tmux('capture-pane', '-p', '-t', `jelly-${dev.id}`).then(result => result.stdout);
    if ((await pane()).includes('trust')) {
      await tmux('send-keys', '-t', `jelly-${dev.id}`, 'Enter');
      await delay(2000);
    }
    await expect.poll(pane, { timeout: 20000 }).toContain('OpenAI Codex');
    await tmux('send-keys', '-t', `jelly-${dev.id}`, '-l', 'Add a /api/status route and a test for it.');
    await delay(700);
  }
  await page.screenshot({ path: join(output, 'desktop.png') });
  if (withCodex) await tmux('send-keys', '-t', `jelly-${dev.id}`, 'C-u');
  recording = true;
  frameTask = (async () => {
    while (recording) {
      const start = performance.now();
      await page.screenshot({ path: join(frames, `${String(frameCount++).padStart(4, '0')}.png`) });
      await delay(Math.max(0, 125 - (performance.now() - start)));
    }
  })();
  // Handle capture failures immediately; the awaited promise still reports them.
  frameTask.catch(() => {});
  if (withCodex) {
    const prompt = page.locator('.terminal-slot:visible').getByLabel('Terminal input', { exact: true });
    await prompt.pressSequentially('Add a /api/status route and a test for it.', { delay: 55 });
  }
  await delay(1700);
  await select(withCodex ? 'Tests' : 'Dev server'); await delay(1600);
  await select('Shell'); await delay(1200);
  await page.keyboard.press('Meta+Shift+Enter');
  await expect(page.locator('.workspace-current strong')).toHaveText('Session 1');
  await ready(); await delay(500);
  const input = page.locator('.terminal-slot:visible').getByLabel('Terminal input', { exact: true });
  await input.pressSequentially('node --version', { delay: 80 }); await input.press('Enter');
  await delay(1400);
  await select(withCodex ? 'Codex' : 'Tests'); await delay(900);
  await page.reload(); await ready();
  await expect(page.locator('.terminal-slot:visible .xterm-rows')).toContainText(withCodex ? 'OpenAI Codex' : 'pass 6');
  const restored = withCodex ? dev : tests;
  if ((await api(`/sessions/${restored.id}`)).pid !== restored.pid) throw new Error('Demo shell changed on reload');
  await delay(1800);
  recording = false; await frameTask;
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    ...(withCodex ? { recordVideo: { dir: join(scratch, 'video'), size: { width: 390, height: 740 } } } : {}) });
  await mobile.addInitScript(({ token, projectId, sessionId }) => {
    sessionStorage.setItem('jelly-token', token);
    if (!localStorage.getItem('jelly-project')) localStorage.setItem('jelly-project', projectId);
    if (!localStorage.getItem('jelly-session')) localStorage.setItem('jelly-session', sessionId);
  }, { token: config.token, projectId: project.id, sessionId: dev.id });
  const phone = await mobile.newPage();
  phone.setDefaultTimeout(10000);
  const videoEpoch = performance.now();
  await phone.goto(origin); await expect(phone.locator('.connection-label')).toHaveText('Connected');
  await expect(phone.locator('.terminal-slot:visible .xterm-rows')).toContainText(withCodex ? 'OpenAI Codex' : 'development server');
  await delay(400);
  await phone.screenshot({ path: join(output, 'mobile-terminal.png') });
  await phone.getByRole('button', { name: 'Open virtual keyboard', exact: true }).tap();
  await phone.getByRole('button', { name: 'Ctrl', exact: true }).tap();
  await phone.getByRole('button', { name: 'C', exact: true }).tap();
  await expect(phone.getByLabel('Selected key combination')).toHaveText('Ctrl + C');
  await phone.screenshot({ path: join(output, 'mobile-keyboard.png') });
  if (!withCodex) {
    await phone.getByRole('button', { name: 'Send key combination', exact: true }).tap();
    await expect(phone.locator('.terminal-slot:visible .xterm-rows')).toContainText('^C');
  } else {
    await phone.getByRole('button', { name: 'Close virtual keyboard', exact: true }).tap();
    await tmux('send-keys', '-t', `jelly-${dev.id}`, 'C-u');
    await delay(300);
    mobileVideoStart = (performance.now() - videoEpoch) / 1000;
    await delay(700);
    const inputField = phone.getByRole('textbox', { name: 'Input', exact: true });
    await inputField.tap();
    const inputHeight = await inputField.evaluate(element => element.getBoundingClientRect().height);
    await inputField.pressSequentially('Add a /api/status route', { delay: 85 });
    // Input must reach Codex before typing is finished, without a Send tap.
    await expect(phone.locator('.terminal-slot:visible .xterm-rows')).toContainText('Add a /api/status route');
    await delay(400);
    await inputField.pressSequentially(' and a test for it.', { delay: 85 });
    await expect(phone.locator('.terminal-slot:visible .xterm-rows')).toContainText('and a test for');
    await expect(phone.getByRole('textbox', { name: 'Command or message', exact: true })).toBeHidden();
    if (await inputField.evaluate(element => element.getBoundingClientRect().height) !== inputHeight) throw new Error('Input changed height while typing');
    await delay(1400);
    await phone.getByRole('button', { name: 'Open virtual keyboard', exact: true }).tap();
    await phone.getByRole('button', { name: 'Ctrl', exact: true }).tap();
    await phone.getByRole('button', { name: 'C', exact: true }).tap();
    await expect(phone.getByLabel('Selected key combination')).toHaveText('Ctrl + C');
    await delay(1400);
    await phone.getByRole('button', { name: 'Close virtual keyboard', exact: true }).tap();
    for (const name of ['Tests', 'Codex']) {
      await phone.getByRole('button', { name: 'Open projects and sessions', exact: true }).tap();
      await delay(650);
      await phone.getByRole('button', { name: `${name} · Running`, exact: true }).tap();
      await expect(phone.locator('.connection-label')).toHaveText('Connected');
      await expect(phone.locator('.terminal-slot:visible .xterm-rows')).toContainText(name === 'Tests' ? 'pass 6' : 'Add a /api/status route');
      await delay(1300);
    }
    await phone.reload();
    await expect(phone.locator('.connection-label')).toHaveText('Connected');
    await expect(phone.locator('.terminal-slot:visible .xterm-rows')).toContainText('Add a /api/status route');
    if ((await api(`/sessions/${dev.id}`)).pid !== dev.pid) throw new Error('Mobile demo shell changed on reload');
    await delay(1300);
    mobileVideoDuration = (performance.now() - videoEpoch) / 1000 - mobileVideoStart;
    mobileVideoPath = await phone.video().path();
  }
  await mobile.close();
  await browser.close(); browser = undefined;

  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '8', '-i', join(frames, '%04d.png'), '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', join(output, 'jelly-demo.gif')], { timeout: 120_000 });
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '8', '-i', join(frames, '%04d.png'), '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'jelly-demo.mp4')], { timeout: 120_000 });
  if (mobileVideoPath) {
    await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(mobileVideoStart), '-t', String(mobileVideoDuration), '-i', mobileVideoPath, '-filter_complex', '[0:v]fps=8,scale=390:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', join(output, 'mobile-codex.gif')], { timeout: 120_000 });
    await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(mobileVideoStart), '-t', String(mobileVideoDuration), '-i', mobileVideoPath, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'mobile-codex.mp4')], { timeout: 120_000 });
    console.log(`Mobile Codex demo: ${mobileVideoDuration.toFixed(1)} seconds.`);
  }
  console.log(`Captured actual Jelly UI: ${frameCount} frames, ${(frameCount / 8).toFixed(1)} seconds.`);
} finally {
  recording = false;
  await frameTask?.catch(() => {});
  try {
    await browser?.close();
  } finally {
    try {
      await app?.close();
    } finally {
      // Only the private tmux server created for this capture is terminated.
      if (app) await exec('tmux', ['-S', config.socket, 'kill-server']).catch(() => {});
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
