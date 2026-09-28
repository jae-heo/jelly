import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { api, ApiError } from './api';
import { attachTouchScroll } from './touchScroll';
import './TerminalViewport.css';
import { terminalKeySequence, type TerminalKey } from './terminalKeys';

export type Connection = 'connecting' | 'connected' | 'retrying' | 'disconnected' | 'taken' | 'ended';
export interface TerminalHandle { send: (data: string) => void; pressKey: (key: TerminalKey) => void; paste: (data: string) => void; focus: () => void }
interface Props {
  token: string; sessionId: string; active: boolean; revision: number; fontSize: number;
  onConnection: (state: Connection) => void; onUnauthorized: () => void;
}

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const sendRef = useRef<(data: string) => void>(() => {});
  const fitRef = useRef<() => void>(() => {});
  const wakeRef = useRef<() => void>(() => {});
  const callbacks = useRef(props);
  callbacks.current = props;
  useImperativeHandle(ref, () => ({
    send: data => sendRef.current(data),
    pressKey: key => sendRef.current(terminalKeySequence(key, termRef.current?.modes.applicationCursorKeysMode ?? false)),
    paste: data => { if (callbacks.current.active) termRef.current?.paste(data); },
    focus: () => { if (callbacks.current.active) termRef.current?.focus(); },
  }), []);

  useEffect(() => {
    if (!container.current) return;
    const term = new Terminal({
      cursorBlink: true, cursorStyle: 'bar', fontSize: callbacks.current.fontSize, lineHeight: 1.3,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      scrollback: 2000, allowProposedApi: false,
      theme: {
        background: '#0b1110', foreground: '#d6e3dd', cursor: '#b6eed1', selectionBackground: '#2d5141',
        black: '#26332d', red: '#ef9a94', green: '#b6eed1', yellow: '#e7cf92', blue: '#95bce7', magenta: '#c7addb', cyan: '#8bd3cd', white: '#e5eee9',
        brightBlack: '#75877c', brightRed: '#f9b4ae', brightGreen: '#ccf8df', brightYellow: '#f0dfb8', brightBlue: '#bbd4f1', brightMagenta: '#decaec', brightCyan: '#b5e5de', brightWhite: '#f3f8f5',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current);
    const disposeTouchScroll = attachTouchScroll(term);
    term.textarea?.setAttribute('aria-label', '터미널 입력');
    termRef.current = term;
    let alive = true;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let writeTimer: ReturnType<typeof setTimeout> | undefined;
    let fitTimer: ReturnType<typeof setTimeout> | undefined;
    let sentSize = '';
    let attempts = 0;
    let stopped = false;
    let opening = false;
    let ready = false;
    let inputQueue: string[] = [];
    const controller = new AbortController();
    const status = (value: Connection) => { if (alive) callbacks.current.onConnection(value); };
    let unobscuredHeight = 0;
    let measuredWidth = 0;
    const mobileKeyboard = () => matchMedia('(pointer: coarse)').matches && document.documentElement.classList.contains('keyboard-open');
    const cellHeight = () => (term.element?.querySelector('.xterm-screen')?.getBoundingClientRect().height ?? 0) / term.rows;
    const positionScreen = () => {
      if (!callbacks.current.active || !term.element || !container.current) return;
      const height = cellHeight();
      // Keep the input cursor visible when the keyboard covers an otherwise
      // empty shell or a TUI with its prompt near the top of the grid.
      const clipped = Math.max(0, height * term.rows - container.current.clientHeight);
      const shift = mobileKeyboard() ? Math.max(0, clipped - Math.max(0, term.buffer.active.cursorY - 2) * height) : 0;
      term.element.style.transform = shift ? `translateY(${shift}px)` : '';
    };
    let cursorTimer: ReturnType<typeof setTimeout> | undefined;
    const cursor = term.onCursorMove(() => {
      // TUIs move the cursor around while repainting. Follow the final input
      // position rather than panning with every intermediate escape sequence.
      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(positionScreen, 50);
    });
    const resize = () => {
      if (!alive || !callbacks.current.active || !container.current?.clientWidth || !container.current.clientHeight) return;
      const size = fit.proposeDimensions();
      if (!size) return;
      const cols = Math.min(500, Math.max(2, size.cols));
      const keyboard = mobileKeyboard();
      if (!keyboard) unobscuredHeight = container.current.clientHeight;
      else if (!unobscuredHeight || measuredWidth !== container.current.clientWidth) {
        const style = getComputedStyle(document.documentElement);
        unobscuredHeight = container.current.clientHeight + (parseFloat(style.getPropertyValue('--keyboard-inset')) || 0)
          - (parseFloat(style.getPropertyValue('--terminal-safe-bottom')) || 0);
      }
      measuredWidth = container.current.clientWidth;
      const height = cellHeight();
      // A keyboard is an occlusion, not a new terminal size. Resizing tmux here
      // reflows applications and moves its copy-mode history even on one resize.
      const rows = Math.min(200, Math.max(2, keyboard && height ? Math.floor(unobscuredHeight / height) : size.rows));
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
      positionScreen();
      if (ready && ws?.readyState === WebSocket.OPEN && sentSize !== `${cols}:${rows}`) {
        sentSize = `${cols}:${rows}`;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };
    let frame = 0;
    const scheduleFit = () => {
      positionScreen();
      clearTimeout(fitTimer); cancelAnimationFrame(frame);
      // Activation, font changes and ResizeObserver must share the same quiet
      // period. A warm session can be selected before iOS dismisses its keyboard.
      fitTimer = setTimeout(() => { frame = requestAnimationFrame(resize); }, matchMedia('(pointer: coarse)').matches ? 250 : 120);
    };
    fitRef.current = scheduleFit;
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container.current);
    resize();
    const flushInput = () => {
      writeTimer = undefined;
      if (!callbacks.current.active || !ready || ws?.readyState !== WebSocket.OPEN) { inputQueue = []; return; }
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
    sendRef.current = send;
    const input = term.onData(send);
    const binaryInput = term.onBinary(send);
    const scheduleReconnect = () => {
      if (!alive || stopped) return;
      status('retrying');
      if (!callbacks.current.active) return;
      timer = setTimeout(() => { void connect(); }, Math.min(8000, 700 * 2 ** Math.min(attempts++, 4)));
    };
    async function connect() {
      if (!alive || stopped || !callbacks.current.active || opening || ws?.readyState === WebSocket.CONNECTING || ws?.readyState === WebSocket.OPEN) return;
      opening = true;
      status(attempts ? 'retrying' : 'connecting');
      try {
        const { ticket } = await api<{ ticket: string }>(props.token, `/sessions/${props.sessionId}/tickets`, 'POST', undefined, controller.signal);
        if (!alive || stopped || !callbacks.current.active) return;
        const url = new URL(`/api/sessions/${props.sessionId}/terminal`, location.href);
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
            term.reset(); ready = true; sentSize = ''; attempts = 0; status('connected'); scheduleFit();
            if (callbacks.current.active && matchMedia('(pointer: fine)').matches) term.focus();
          } else if (message.type === 'output') term.write(message.data);
        };
        socket.onclose = event => {
          if (!alive || socket !== ws) return;
          ready = false; inputQueue = [];
          if (stopped) return;
          if (event.code === 4001) { stopped = true; status('taken'); }
          else if (event.code === 1000) { stopped = true; status('ended'); }
          else scheduleReconnect();
        };
        socket.onerror = () => { /* onclose drives reconnect; credentials never appear in UI errors. */ };
      } catch (error) {
        if (!alive || stopped) return;
        if (error instanceof ApiError && error.status === 401) { stopped = true; callbacks.current.onUnauthorized(); }
        else if (error instanceof ApiError && [404, 409].includes(error.status)) { stopped = true; status('ended'); }
        else scheduleReconnect();
      } finally { opening = false; }
    }
    const wake = () => {
      if (document.visibilityState !== 'visible' || !callbacks.current.active || stopped || ws?.readyState === WebSocket.OPEN || opening) return;
      clearTimeout(timer); void connect();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    wakeRef.current = wake;
    void connect();
    return () => {
      alive = false; stopped = true; ready = false; controller.abort();
      clearTimeout(timer); clearTimeout(writeTimer); clearTimeout(fitTimer); cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake);
      ws?.close(); clearTimeout(cursorTimer); cursor.dispose(); input.dispose(); binaryInput.dispose(); disposeTouchScroll(); term.dispose();
      termRef.current = null; sendRef.current = () => {}; fitRef.current = () => {}; wakeRef.current = () => {};
    };
  }, [props.token, props.sessionId, props.revision]);

  useLayoutEffect(() => {
    if (props.active) {
      fitRef.current();
      wakeRef.current();
      if (matchMedia('(pointer: fine)').matches) termRef.current?.focus();
    } else termRef.current?.blur();
  }, [props.active]);

  // Update the existing renderer and PTY size without replacing the WebSocket or terminal.
  useEffect(() => {
    if (termRef.current) termRef.current.options.fontSize = props.fontSize;
    fitRef.current();
  }, [props.fontSize]);

  return <div className="terminal-viewport" ref={container} data-testid="terminal" />;
});
