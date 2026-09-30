import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Keyboard, PencilLine, Send } from 'lucide-react';
import { LiveInput, type LiveInputHandle } from './LiveInput';
import { VirtualKeyboard } from './VirtualKeyboard';
import type { TerminalHandle } from './TerminalView';

export interface TerminalControlsHandle { focus: () => void }
export const TerminalControls = forwardRef<TerminalControlsHandle, {
  enabled: boolean; terminal: RefObject<TerminalHandle | null>; onPaste: () => void;
}>(function TerminalControls({ enabled, terminal, onPaste }, ref) {
  const [keyboard, setKeyboard] = useState(false);
  const [composer, setComposer] = useState(false);
  const [command, setCommand] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const live = useRef<LiveInputHandle>(null);
  useImperativeHandle(ref, () => ({ focus: () => { if (composer) input.current?.focus({ preventScroll: true }); else live.current?.focus(); } }), [composer]);
  const run = (action: () => void) => { if (!enabled) return; if (composer) action(); else live.current?.run(action); };
  const showComposer = (open: boolean) => {
    if (!open) input.current?.blur();
    flushSync(() => setComposer(open));
    if (open) input.current?.focus({ preventScroll: true });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composing.current || !command || !enabled) return;
    terminal.current?.paste(command);
    setCommand('');
  };
  const keyboardButton = <button type="button" className={`dock-toggle ${keyboard ? 'active' : ''}`} aria-label={keyboard ? '가상 키보드 닫기' : '가상 키보드 열기'}
    title="키 조합" aria-expanded={keyboard} aria-controls="terminal-virtual-keyboard" onClick={() => setKeyboard(!keyboard)}><Keyboard size={19} /></button>;
  const composerButton = <button type="button" className={`dock-toggle ${composer ? 'active' : ''}`} aria-label={composer ? '입력창 숨기기' : '입력창 표시'}
    title={composer ? '라이브 입력으로' : '문장 입력'} aria-expanded={composer} aria-controls="terminal-composer"
    onClick={() => { if (composer) showComposer(false); else run(() => showComposer(true)); }}><PencilLine size={18} /></button>;
  return <div className="terminal-dock" onMouseDownCapture={event => {
    // Keep the native IME and its focus while selecting and sending virtual keys.
    // Cancelling pointerdown also suppresses touch clicks in WebKit.
    if (event.button === 0 && (event.target as Element).closest('button:not(:disabled)')) event.preventDefault();
  }}>
    {keyboard && <VirtualKeyboard enabled={enabled} onSend={(key, modifiers) => run(() => terminal.current?.chord(key, modifiers))} onPaste={() => run(onPaste)} />}
    <LiveInput ref={live} enabled={enabled} hidden={composer} terminal={terminal} actions={<>{keyboardButton}{composerButton}</>} />
    <form id="terminal-composer" className="terminal-composer" hidden={!composer} onSubmit={submit}>
      <textarea ref={input} aria-label="명령어 또는 메시지" rows={1} value={command} onChange={event => setCommand(event.target.value)}
        placeholder="명령어 또는 메시지" spellCheck={false} autoCorrect="off" autoComplete="off" autoCapitalize="off" enterKeyHint="send"
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
      <button type="submit" className="send-button" aria-label="입력 보내기" disabled={!enabled || !command}><Send size={17} /></button>
      {keyboardButton}{composerButton}
    </form>
  </div>;
});
