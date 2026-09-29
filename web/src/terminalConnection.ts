import type { Terminal } from '@xterm/xterm';
import { api, ApiError } from './api';
import type { Connection } from './TerminalView';

interface Callbacks { active: boolean; onConnection: (state: Connection) => void; onUnauthorized: () => void }
export function terminalConnection(term: Terminal, token: string, sessionId: string, callbacks: { current: Callbacks }, onReady: () => void) {
  let alive = true;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingProbe: string | null = null;
  let probeSequence = 0;
  let supportsProbe = false;
  let needsResumeCheck = false;
  let generation = 0;
  let request: AbortController | null = null;
  let sentSize = '';
  let attempts = 0;
  let stopped = false;
  let opening = false;
  let ready = false;
  let inputQueue: string[] = [];
  const status = (value: Connection) => { if (alive) callbacks.current.onConnection(value); };
  const flushInput = () => {
    writeTimer = undefined;
    if (!callbacks.current.active || !ready || ws?.readyState !== WebSocket.OPEN) { inputQueue = []; return; }
    if (pendingProbe) return;
    const data = inputQueue.shift();
    if (data !== undefined) ws.send(JSON.stringify({ type: 'input', data }));
    if (inputQueue.length) writeTimer = setTimeout(flushInput, 35);
  };
  const send = (data: string) => {
    if (!callbacks.current.active || !ready || ws?.readyState !== WebSocket.OPEN) return;
    // Paste in bounded UTF-8 chunks to respect server limits and keep control input responsive.
    const points = Array.from(data);
    if (inputQueue.length + Math.ceil(points.length / 1024) > 512) return;
    for (let i = 0; i < points.length; i += 1024) inputQueue.push(points.slice(i, i + 1024).join(''));
    if (!writeTimer) flushInput();
  };
  const input = term.onData(send);
  const binaryInput = term.onBinary(send);
  const scheduleReconnect = () => {
    if (!alive || stopped) return;
    status('retrying');
    if (!callbacks.current.active || document.hidden) return;
    timer = setTimeout(() => { void connect(); }, Math.min(8000, 700 * 2 ** Math.min(attempts++, 4)));
  };
  const clearProbe = () => { clearTimeout(probeTimer); probeTimer = undefined; pendingProbe = null; };
  const discardTransport = () => {
    generation++; request?.abort(); request = null; opening = false;
    clearTimeout(startupTimer); clearTimeout(timer); clearTimeout(writeTimer); clearProbe();
    writeTimer = undefined; ready = false; inputQueue = []; supportsProbe = false;
    const previous = ws; ws = null; previous?.close();
  };
  const reconnectNow = () => { discardTransport(); attempts = 0; void connect(); };
  async function connect() {
    if (!alive || stopped || !callbacks.current.active || document.hidden || opening || ws?.readyState === WebSocket.CONNECTING || ws?.readyState === WebSocket.OPEN) return;
    const currentGeneration = ++generation;
    const controller = new AbortController();
    request = controller;
    opening = true;
    clearTimeout(timer);
    status(attempts ? 'retrying' : 'connecting');
    // Bound the entire ticket/upgrade/PTY startup, including a WebSocket that
    // remains CONNECTING indefinitely after a mobile network change.
    startupTimer = setTimeout(() => {
      if (!alive || currentGeneration !== generation) return;
      discardTransport(); scheduleReconnect();
    }, 12_000);
    try {
      const { ticket } = await api<{ ticket: string }>(token, `/sessions/${sessionId}/tickets`, 'POST', undefined, controller.signal);
      if (!alive || stopped || currentGeneration !== generation) return;
      if (!callbacks.current.active || document.hidden) { clearTimeout(startupTimer); return; }
      const url = new URL(`/api/sessions/${sessionId}/terminal`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', ticket);
      url.searchParams.set('cols', String(term.cols));
      url.searchParams.set('rows', String(term.rows));
      const socket = new WebSocket(url);
      ws = socket;
      socket.onmessage = event => {
        if (!alive || socket !== ws) return;
        const message = JSON.parse(event.data);
        if (message.type === 'ready') {
          clearTimeout(startupTimer); supportsProbe = message.heartbeat === true;
          term.reset(); ready = true; sentSize = ''; attempts = 0; status('connected'); onReady();
          if (callbacks.current.active && matchMedia('(pointer: fine)').matches) term.focus();
        } else if (message.type === 'pong' && pendingProbe && message.nonce === pendingProbe) {
          clearProbe();
          if (!writeTimer && inputQueue.length) flushInput();
        } else if (message.type === 'output') term.write(message.data);
      };
      socket.onclose = event => {
        if (!alive || socket !== ws) return;
        const wasChecking = pendingProbe !== null;
        clearTimeout(startupTimer); clearProbe();
        ready = false; inputQueue = [];
        if (stopped) return;
        if (event.code === 4001) { stopped = true; status('taken'); }
        else if (event.code === 1000) { stopped = true; status('ended'); }
        else if (wasChecking && callbacks.current.active && !document.hidden) reconnectNow();
        else scheduleReconnect();
      };
      socket.onerror = () => { /* onclose drives reconnect; credentials never appear in UI errors. */ };
    } catch (error) {
      if (!alive || stopped || currentGeneration !== generation) return;
      clearTimeout(startupTimer);
      if (error instanceof ApiError && error.status === 401) { stopped = true; callbacks.current.onUnauthorized(); }
      else if (error instanceof ApiError && [404, 409].includes(error.status)) { stopped = true; status('ended'); }
      else scheduleReconnect();
    } finally { if (currentGeneration === generation) { opening = false; request = null; } }
  }
  const wake = () => {
    if (document.visibilityState !== 'visible' || !callbacks.current.active || stopped) return;
    if (needsResumeCheck) {
      needsResumeCheck = false; attempts = 0;
      if (opening || ws?.readyState === WebSocket.CONNECTING || ws?.readyState === WebSocket.CLOSING || (ws?.readyState === WebSocket.OPEN && !ready)) {
        reconnectNow(); return;
      }
      if (ws?.readyState === WebSocket.OPEN) {
        // readyState can stay OPEN on iOS after the transport has disappeared.
        // Probe the application channel; a new nonce cannot match queued data.
        if (!supportsProbe) { reconnectNow(); return; }
        if (pendingProbe) return;
        pendingProbe = String(++probeSequence);
        try { ws.send(JSON.stringify({ type: 'ping', nonce: pendingProbe })); }
        catch { reconnectNow(); return; }
        probeTimer = setTimeout(() => {
          clearProbe();
          if (callbacks.current.active && !document.hidden) reconnectNow();
          else needsResumeCheck = true;
        }, 1200);
        return;
      }
    }
    if (ws?.readyState === WebSocket.OPEN || opening) return;
    clearTimeout(timer); void connect();
  };
  const visibility = () => {
    if (document.hidden) { needsResumeCheck = true; clearTimeout(timer); clearProbe(); }
    else wake();
  };
  const online = () => { needsResumeCheck = true; wake(); };
  const restored = (event: PageTransitionEvent) => { if (event.persisted) { needsResumeCheck = true; wake(); } };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', online);
  window.addEventListener('pageshow', restored);
  void connect();
  return { send, wake, resize: (cols: number, rows: number) => {
    if (ready && ws?.readyState === WebSocket.OPEN && sentSize !== `${cols}:${rows}`) {
      sentSize = `${cols}:${rows}`;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, dispose: () => {
    alive = false; stopped = true; discardTransport();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', online); window.removeEventListener('pageshow', restored);
    input.dispose(); binaryInput.dispose();
  } };
}
