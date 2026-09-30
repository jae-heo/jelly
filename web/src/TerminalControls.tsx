import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Keyboard, PencilLine, Send } from 'lucide-react';
import { TerminalInput, type TerminalInputHandle } from './TerminalInput';
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
  const terminalInput = useRef<TerminalInputHandle>(null);
  useImperativeHandle(ref, () => ({ focus: () => { if (composer) input.current?.focus({ preventScroll: true }); else terminalInput.current?.focus(); } }), [composer]);
  const run = (action: () => void) => { if (!enabled) return; if (composer) action(); else terminalInput.current?.run(action); };
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
  const keyboardButton = <button type="button" className={`dock-toggle ${keyboard ? 'active' : ''}`} aria-label={keyboard ? 'Close virtual keyboard' : 'Open virtual keyboard'}
    title="Key combination" aria-expanded={keyboard} aria-controls="terminal-virtual-keyboard" onClick={() => setKeyboard(!keyboard)}><Keyboard size={19} /></button>;
  const composerButton = <button type="button" className={`dock-toggle ${composer ? 'active' : ''}`} aria-label={composer ? 'Hide draft input' : 'Show draft input'}
    title={composer ? 'Switch to input' : 'Draft input'} aria-expanded={composer} aria-controls="terminal-composer"
    onClick={() => { if (composer) showComposer(false); else run(() => showComposer(true)); }}><PencilLine size={18} /></button>;
  return <div className="terminal-dock" onMouseDownCapture={event => {
    // Keep the native IME and its focus while selecting and sending virtual keys.
    // Cancelling pointerdown also suppresses touch clicks in WebKit.
    if (event.button === 0 && (event.target as Element).closest('button:not(:disabled)')) event.preventDefault();
  }}>
    {keyboard && <VirtualKeyboard enabled={enabled} onSend={(key, modifiers) => run(() => terminal.current?.chord(key, modifiers))} onPaste={() => run(onPaste)} />}
    <TerminalInput ref={terminalInput} enabled={enabled} hidden={composer} terminal={terminal} actions={<>{keyboardButton}{composerButton}</>} />
    <form id="terminal-composer" className="terminal-composer" hidden={!composer} onSubmit={submit}>
      <textarea ref={input} aria-label="Command or message" rows={1} value={command} onChange={event => setCommand(event.target.value)}
        placeholder="Command or message" spellCheck={false} autoCorrect="off" autoComplete="off" autoCapitalize="off" enterKeyHint="send"
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
      <button type="submit" className="send-button" aria-label="Send input" disabled={!enabled || !command}><Send size={17} /></button>
      {keyboardButton}{composerButton}
    </form>
  </div>;
});
