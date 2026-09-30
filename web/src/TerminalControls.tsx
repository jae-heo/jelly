import { forwardRef, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { Command } from 'lucide-react';
import { TerminalInput, type TerminalInputHandle } from './TerminalInput';
import { VirtualKeyboard } from './VirtualKeyboard';
import type { TerminalHandle } from './TerminalView';

export interface TerminalControlsHandle { focus: () => void }
export const TerminalControls = forwardRef<TerminalControlsHandle, {
  enabled: boolean; terminal: RefObject<TerminalHandle | null>; onPaste: () => void;
}>(function TerminalControls({ enabled, terminal, onPaste }, ref) {
  const [keyboard, setKeyboard] = useState(false);
  const input = useRef<TerminalInputHandle>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  const run = (action: () => void) => { if (enabled) input.current?.run(action); };
  const keyboardButton = <button type="button" className={`dock-toggle ${keyboard ? 'active' : ''}`} aria-label={keyboard ? 'Close shortcuts' : 'Open shortcuts'}
    title={keyboard ? 'Close shortcuts' : 'Shortcuts'} aria-expanded={keyboard} aria-controls="terminal-virtual-keyboard" onClick={() => setKeyboard(!keyboard)}><Command size={19} aria-hidden="true" /></button>;
  return <div className="terminal-dock" onMouseDownCapture={event => {
    // Keep the native IME and its focus while selecting and sending virtual keys.
    // Cancelling pointerdown also suppresses touch clicks in WebKit.
    if (event.button === 0 && (event.target as Element).closest('button:not(:disabled)')) event.preventDefault();
  }}>
    {keyboard && <VirtualKeyboard enabled={enabled} onSend={(key, modifiers) => run(() => terminal.current?.chord(key, modifiers))} onPaste={() => run(onPaste)} />}
    <TerminalInput ref={input} enabled={enabled} terminal={terminal} actions={keyboardButton} />
  </div>;
});
