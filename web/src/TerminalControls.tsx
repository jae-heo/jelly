import { forwardRef, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { Command, LoaderCircle, Paperclip } from 'lucide-react';
import { TerminalInput, type TerminalInputHandle } from './TerminalInput';
import { VirtualKeyboard } from './VirtualKeyboard';
import type { TerminalHandle } from './TerminalView';

export interface TerminalControlsHandle { focus: () => void; reset: () => void; paste: (text: string) => void }
export const TerminalControls = forwardRef<TerminalControlsHandle, {
  enabled: boolean; terminal: RefObject<TerminalHandle | null>; uploading: boolean; onPaste: () => void; onAttach: (files: File[]) => void;
}>(function TerminalControls({ enabled, terminal, uploading, onPaste, onAttach }, ref) {
  const [keyboard, setKeyboard] = useState(false);
  const input = useRef<TerminalInputHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const run = (action: () => void) => { if (enabled) input.current?.run(action); };
  // Pasting commits Input's text first, as a paste in Input does.
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), reset: () => input.current?.reset(), paste: text => input.current?.run(() => terminal.current?.paste(text)) }), [terminal]);
  const attachButton = <>
    <button type="button" className={`dock-toggle ${uploading ? 'busy' : ''}`} aria-label={uploading ? 'Uploading' : 'Attach files'} title={uploading ? 'Uploading' : 'Attach files'}
      disabled={!enabled || uploading} onClick={() => picker.current?.click()}>
      {uploading ? <LoaderCircle className="spin" size={19} aria-hidden="true" /> : <Paperclip size={19} aria-hidden="true" />}
    </button>
    <input ref={picker} type="file" multiple hidden tabIndex={-1} aria-hidden="true" onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      if (files.length) onAttach(files);
    }} />
  </>;
  const keyboardButton = <button type="button" className={`dock-toggle ${keyboard ? 'active' : ''}`} aria-label={keyboard ? 'Close shortcuts' : 'Open shortcuts'}
    title={keyboard ? 'Close shortcuts' : 'Shortcuts'} aria-expanded={keyboard} aria-controls="terminal-virtual-keyboard" onClick={() => setKeyboard(!keyboard)}><Command size={19} aria-hidden="true" /></button>;
  return <div className="terminal-dock" onMouseDownCapture={event => {
    // Keep the native IME and its focus while selecting and sending virtual keys.
    // Cancelling pointerdown also suppresses touch clicks in WebKit.
    if (event.button === 0 && (event.target as Element).closest('button:not(:disabled)')) event.preventDefault();
  }}>
    {keyboard && <VirtualKeyboard enabled={enabled} onSend={(key, modifiers) => { run(() => terminal.current?.chord(key, modifiers)); setKeyboard(false); }} onPaste={() => run(onPaste)} />}
    <TerminalInput ref={input} enabled={enabled} terminal={terminal} actions={<>{attachButton}{keyboardButton}</>} />
  </div>;
});
