import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:47932', browserName: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'off' },
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: /(?:keyboard-viewport|switch-viewport|workspace-state|output-flow|quick-session|keys|rename)\.spec\.ts/ },
  ],
  webServer: { command: 'node scripts/browser-test-server.mjs', url: 'http://127.0.0.1:47932/healthz', reuseExistingServer: false, timeout: 180_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 } },
});
