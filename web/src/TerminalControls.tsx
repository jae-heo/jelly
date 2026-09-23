import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, ChevronUp, ClipboardPaste, Keyboard, KeyboardOff, Send } from 'lucide-react';
import type { TerminalHandle } from './TerminalView';
import type { TerminalKey } from './terminalKeys';

const navigationKeys: { key: TerminalKey; label: string; name?: string }[] = [
  { key: 'ArrowLeft', label: '←', name: '왼쪽 화살표' }, { key: 'ArrowUp', label: '↑', name: '위 화살표' },
  { key: 'ArrowDown', label: '↓', name: '아래 화살표' }, { key: 'ArrowRight', label: '→', name: '오른쪽 화살표' },
  { key: 'Home', label: 'Home' }, { key: 'End', label: 'End' },
  { key: 'PageUp', label: 'PgUp', name: 'Page Up' }, { key: 'PageDown', label: 'PgDn', name: 'Page Down' },
  { key: 'Backspace', label: 'Bksp', name: 'Backspace' }, { key: 'Delete', label: 'Del', name: 'Delete' },
  { key: 'ShiftTab', label: '⇧ Tab', name: 'Shift Tab' }, { key: 'Insert', label: 'Ins', name: 'Insert' },
];
const controlKeys = ['A', 'B', 'D', 'E', 'F', 'G', 'K', 'L', 'N', 'U', 'W', 'Z'];
const functionKeys: TerminalKey[] = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
const keyGroups = [{ id: 'navigation', label: '이동' }, { id: 'control', label: 'Ctrl' }, { id: 'function', label: 'F1–F12' }] as const;

export function TerminalControls({ enabled, terminal, onPaste }: {
  enabled: boolean; terminal: RefObject<TerminalHandle | null>; onPaste: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [composer, setComposer] = useState(false);
  const [command, setCommand] = useState('');
  const [ctrl, setCtrl] = useState(false);
  const [group, setGroup] = useState<(typeof keyGroups)[number]['id']>('navigation');
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const keepFocus = () => {
    if (document.activeElement !== input.current && matchMedia('(pointer: fine)').matches) terminal.current?.focus();
  };
  const press = (key: TerminalKey) => {
    if (!enabled) return;
    terminal.current?.pressKey(key); keepFocus();
  };
  const control = (letter: string) => {
    if (!enabled) return;
    terminal.current?.send(String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64)); keepFocus();
  };
  const showComposer = (open: boolean) => {
    // Focus during the user's tap so mobile browsers can open the software keyboard.
    if (!open) input.current?.blur();
    flushSync(() => setComposer(open));
    if (open) input.current?.focus({ preventScroll: true });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composing.current || !command || !enabled) return;
    if (ctrl) { if (!/^[a-z]$/i.test(command)) return; control(command); }
    else terminal.current?.paste(command);
    setCommand(''); setCtrl(false);
  };
  return <div className="terminal-dock" onPointerDownCapture={event => {
    // Buttons must not steal focus and dismiss the phone keyboard before their click.
    // Keep keyboard/Tab navigation intact; only suppress pointer-driven focus changes.
    if (event.button === 0 && (event.target as Element).closest('button:not(:disabled)')) event.preventDefault();
  }}>
    <form id="terminal-composer" className="terminal-composer" hidden={!composer} onSubmit={submit}>
      <span className="prompt-symbol">{ctrl ? '⌃' : '❯'}</span>
      <textarea ref={input} aria-label="명령어 또는 메시지" rows={1} value={command} onChange={event => setCommand(event.target.value)}
        placeholder={ctrl ? 'Ctrl + 영문 키' : '명령어 또는 메시지'} spellCheck={false} autoCorrect="off" autoComplete="off" autoCapitalize="off" enterKeyHint="send"
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
      <button type="submit" className="send-button" aria-label="입력 보내기" disabled={!enabled || !command || (ctrl && !/^[a-z]$/i.test(command))}><Send size={17} /></button>
    </form>
    <div id="terminal-extra-keys" className="dock-extra" role="group" aria-label="추가 보조 키" hidden={!expanded}>
      <div className="dock-extra-heading">
        <div className="dock-key-groups" role="group" aria-label="보조 키 종류">{keyGroups.map(item => <button key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>{item.label}</button>)}</div>
        <button className={`dock-control-custom ${ctrl ? 'active' : ''}`} disabled={!enabled} aria-label="Ctrl 키 조합" aria-pressed={ctrl} title="Ctrl + 영문 키" onClick={() => { setCtrl(!ctrl); showComposer(true); }}>Ctrl + …</button>
      </div>
      <div className="dock-key-grid">
        {group === 'navigation' && navigationKeys.map(item => <button key={item.key} className="dock-key" disabled={!enabled} aria-label={item.name ?? item.label} title={item.name ?? item.label} onClick={() => press(item.key)}>{item.label}</button>)}
        {group === 'control' && controlKeys.map(letter => <button key={letter} className="dock-key" disabled={!enabled} onClick={() => control(letter)}>Ctrl {letter}</button>)}
        {group === 'function' && functionKeys.map(key => <button key={key} className="dock-key" disabled={!enabled} onClick={() => press(key)}>{key}</button>)}
      </div>
    </div>
    <div className="terminal-dock-row">
      <div className="dock-primary" role="group" aria-label="터미널 보조 키">
        <button className="dock-key" disabled={!enabled} onClick={() => press('Escape')}>Esc</button>
        <button className="dock-key" disabled={!enabled} onClick={() => press('Tab')}>Tab</button>
        <button className="dock-key" disabled={!enabled} onClick={() => control('C')}>Ctrl C</button>
        <button className="dock-key" disabled={!enabled} aria-label="텍스트 붙여넣기" title="붙여넣기" onClick={onPaste}><ClipboardPaste size={16} /></button>
        <button className="dock-key" disabled={!enabled} onClick={() => press('Enter')}>Enter</button>
        <button className="dock-key" disabled={!enabled} onClick={() => control('R')}>Ctrl R</button>
      </div>
      <div className="dock-toggles">
        <button className={`dock-toggle ${composer ? 'active' : ''}`} aria-label={composer ? '입력창 숨기기' : '입력창 표시'} title={composer ? '입력창과 키보드 닫기' : '입력창과 키보드 열기'} aria-expanded={composer} aria-controls="terminal-composer" onClick={() => showComposer(!composer)}>{composer ? <KeyboardOff size={19} /> : <Keyboard size={19} />}</button>
        <button className={`dock-toggle ${expanded ? 'active' : ''}`} aria-label={expanded ? '보조 키 접기' : '보조 키 더 보기'} title="보조 키" aria-expanded={expanded} aria-controls="terminal-extra-keys" onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={19} /> : <ChevronUp size={19} />}</button>
      </div>
    </div>
  </div>;
}
