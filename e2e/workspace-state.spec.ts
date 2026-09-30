import { sendVirtualKey } from './virtual-keyboard';
import { test, expect, type Page, type Route } from '@playwright/test';

const project = { id: 'fixture-project', name: 'Workspace fixture', path: '/fixture', hostId: 'fixture-host' };
const first = { id: 'fixture-first', projectId: project.id, name: 'First session', status: 'running' };
const latest = { ...first, id: 'fixture-latest', name: 'Latest session' };
async function fixture(page: Page, initialStatus = 'running') {
  const state = { sessions: [{ ...first, status: initialStatus }], hold: false, held: undefined as Route | undefined, closed: 0, opened: 0, input: '' };
  await page.addInitScript(({ projectId, sessionId }) => {
    sessionStorage.setItem('jelly-token', 'fixture-token');
    localStorage.setItem('jelly-project', projectId);
    localStorage.setItem('jelly-session', sessionId);
  }, { projectId: project.id, sessionId: first.id });
  await page.routeWebSocket('**/api/sessions/*/terminal*', socket => {
    state.opened++;
    socket.onClose(() => { state.closed++; });
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'input') state.input += message.data;
      if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong', nonce: message.nonce }));
    });
    socket.send(JSON.stringify({ type: 'ready', heartbeat: true }));
    socket.send(JSON.stringify({ type: 'output', data: 'Workspace fixture\r\n' }));
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/sessions') {
      if (state.hold) { state.hold = false; state.held = route; return; }
      return route.fulfill({ json: { sessions: state.sessions } });
    }
    if (path === `/api/projects/${project.id}/sessions`) {
      state.sessions.push(latest);
      return route.fulfill({ status: 201, json: latest });
    }
    const json = path === '/api/projects' ? { projects: [project] }
      : path === '/api/hosts' ? { hosts: [{ id: project.hostId, name: 'Fixture host', target: 'fixture' }] }
      : path.endsWith('/tickets') ? { ticket: 'fixture-ticket' } : null;
    return json ? route.fulfill({ json }) : route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.workspace-current strong')).toHaveText(first.name);
  return state;
}
const refresh = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('a late list response cannot remove a newly created and selected terminal', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.locator('.connection-label')).toHaveText('연결됨');
  state.hold = true;
  await refresh(page);
  await expect.poll(() => !!state.held).toBe(true);
  await page.getByRole('button', { name: '더 보기', exact: true }).click();
  await page.getByRole('button', { name: '새 세션', exact: true }).click();
  await page.getByLabel('세션 이름', { exact: true }).fill(latest.name);
  await page.getByRole('button', { name: '세션 열기', exact: true }).click();
  await expect(page.locator('.workspace-current strong')).toHaveText(latest.name);
  await expect(page.locator('.connection-label')).toHaveText('연결됨');
  await state.held!.fulfill({ json: { sessions: [first] } }).catch(() => {});
  await page.waitForTimeout(200);
  await expect(page.locator('.terminal-slot:visible')).toHaveAttribute('data-session-id', latest.id);
  expect(state.opened).toBe(2);
  expect(state.closed).toBe(0);
});

test('failed SSH status polling preserves live terminal input; explicit stop removes it', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.locator('.connection-label')).toHaveText('연결됨');
  state.sessions[0]!.status = 'unreachable';
  await refresh(page);
  await expect(page.getByRole('button', { name: 'First session · 서버 연결 안 됨', exact: true })).toBeVisible();
  await expect(page.locator('.terminal-slot:visible')).toHaveAttribute('data-session-id', first.id);
  await expect(page.locator('.connection-label')).toHaveText('연결됨');
  await sendVirtualKey(page, 'Enter');
  await expect.poll(() => state.input).toContain('\r');
  expect(state.opened).toBe(1);
  expect(state.closed).toBe(0);
  state.sessions[0]!.status = 'stopped';
  await refresh(page);
  await expect(page.locator('.terminal-slot')).toHaveCount(0);
  await expect.poll(() => state.closed).toBe(1);
});

test('an unreachable session without a cached terminal does not attempt attachment', async ({ page }) => {
  const state = await fixture(page, 'unreachable');
  await expect(page.getByRole('heading', { name: 'SSH 서버 연결 실패' })).toBeVisible();
  await expect(page.locator('.terminal-slot')).toHaveCount(0);
  expect(state.opened).toBe(0);
  state.sessions[0]!.status = 'running';
  await page.getByRole('button', { name: '다시 확인' }).click();
  await expect(page.locator('.connection-label')).toHaveText('연결됨');
  expect(state.opened).toBe(1);
});
