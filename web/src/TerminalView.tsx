import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { terminalConnection } from './terminalConnection';
import { terminalGeometry } from './terminalGeometry';
import { attachTouchScroll } from './touchScroll';
import './TerminalViewport.css';
import { terminalKeySequence, type TerminalKey } from './terminalKeys';

export type Connection = 'connecting' | 'connected' | 'retrying' | 'disconnected' | 'taken' | 'ended';
export interface TerminalHandle { send: (data: string) => void; pressKey: (key: TerminalKey) => void; paste: (data: string) => void; focus: () => void }
interface Props {
  token: string; sessionId: string; active: boolean; revision: number; fontSize: number;
  onConnection: (state: Connection) => void; onUnauthorized: () => void;
  onTouchInput: () => void;
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
    const disposeTouchScroll = attachTouchScroll(term, () => callbacks.current.onTouchInput());
    if (matchMedia('(pointer: coarse)').matches && term.textarea) term.textarea.inputMode = 'none';
    term.textarea?.setAttribute('aria-label', '터미널 입력');
    termRef.current = term;
    let connection: ReturnType<typeof terminalConnection> | undefined;
    const geometry = terminalGeometry(term, fit, container.current, () => callbacks.current.active,
      (cols, rows) => connection?.resize(cols, rows));
    connection = terminalConnection(term, props.token, props.sessionId, callbacks, geometry.schedule);
    sendRef.current = connection.send;
    fitRef.current = geometry.schedule;
    wakeRef.current = connection.wake;
    return () => {
      connection?.dispose(); geometry.dispose(); disposeTouchScroll(); term.dispose();
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
