import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { KeyboardOff } from 'lucide-react';
import { liveInputDelta, liveInputTarget } from './liveInput';
import type { TerminalHandle } from './TerminalView';
import type { TerminalKey } from './terminalKeys';

export interface LiveInputHandle { focus: () => void; run: (action: () => void) => void }
interface Props { enabled: boolean; hidden: boolean; terminal: React.RefObject<TerminalHandle | null> }

export const LiveInput = forwardRef<LiveInputHandle, Props>(function LiveInput(props, ref) {
  const field = useRef<HTMLTextAreaElement>(null);
  const current = useRef(props);
  current.current = props;
  const actions = useRef<LiveInputHandle>({ focus: () => {}, run: () => {} });
  const reset = useRef(() => {});
  useImperativeHandle(ref, () => ({ focus: () => actions.current.focus(), run: action => actions.current.run(action) }), []);

  useLayoutEffect(() => {
    const input = field.current!;
    let alive = true;
    let sent = '';
    let composing = false;
    let compositionStart = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finishing: (() => void)[] | null = null;
    const available = () => alive && current.current.enabled && !current.current.hidden;
    const focus = () => { if (available()) input.focus({ preventScroll: true }); };
    const clear = () => {
      clearTimeout(timer); timer = undefined; finishing = null;
      sent = ''; composing = false; compositionStart = 0; input.value = '';
    };
    reset.current = clear;
    const mirror = (commit: boolean) => {
      if (!available()) return;
      const target = liveInputTarget(input.value, composing, compositionStart, commit);
      const delta = liveInputDelta(sent, target);
      if (delta) current.current.terminal.current?.send(delta);
      sent = target;
    };
    const settle = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (!available() || composing || finishing) return;
        mirror(true);
      }, delay);
    };
    const finish = (action: () => void) => {
      if (!available()) return;
      if (finishing) { finishing.push(action); return; }
      clearTimeout(timer);
      if (!composing) { mirror(true); clear(); action(); return; }
      // Blur commits the native IME. Refocus in this tap's user activation so
      // iOS keeps its keyboard, then wait for the final input event before keys.
      finishing = [action];
      const wasFocused = document.activeElement === input;
      input.blur();
      if (wasFocused) focus();
      timer = setTimeout(() => {
        if (!available()) { clear(); return; }
        const pending = finishing ?? [];
        mirror(true); clear();
        for (const next of pending) { if (available()) next(); }
      }, 0);
    };
    actions.current = { focus, run: finish };
    const onStart = () => {
      if (!available() || finishing) return;
      clearTimeout(timer);
      composing = true; compositionStart = input.selectionStart;
    };
    const onEnd = () => {
      composing = false;
      if (!finishing) settle(0);
    };
    const onInput = (event: Event) => {
      if (!available() || finishing) return;
      const native = event as InputEvent;
      const isComposing = composing || native.isComposing;
      if (native.inputType === 'insertLineBreak' || native.inputType === 'insertParagraph') {
        input.value = input.value.replace(/\r?\n$/, '');
        finish(() => current.current.terminal.current?.pressKey('Enter'));
        return;
      }
      const target = liveInputTarget(input.value, isComposing, compositionStart, false);
      const delta = liveInputDelta(sent, target);
      if (delta) current.current.terminal.current?.send(delta);
      sent = target;
      if (!isComposing) settle(300);
    };
    const onBeforeInput = (event: InputEvent) => {
      if (!available() || composing || event.isComposing) return;
      if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
        if (!event.cancelable) return; // The input fallback handles this path.
        event.preventDefault(); finish(() => current.current.terminal.current?.pressKey('Enter'));
      } else if (event.inputType === 'deleteContentBackward' && !input.value && event.cancelable) {
        event.preventDefault(); finish(() => current.current.terminal.current?.pressKey('Backspace'));
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!available() || composing || event.isComposing || event.keyCode === 229) return;
      if (event.metaKey || (event.ctrlKey && ['v', 'V'].includes(event.key))) return;
      if (event.ctrlKey && /^[a-z]$/i.test(event.key)) {
        event.preventDefault();
        finish(() => current.current.terminal.current?.send(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64)));
        return;
      }
      // Backspace edits the native capture while it contains text. Otherwise
      // it belongs to the terminal, including after history/navigation keys.
      if (event.key === 'Backspace' && input.value) return;
      const key: TerminalKey | undefined = event.key === 'Tab' ? (event.shiftKey ? 'ShiftTab' : 'Tab')
        : ['Enter', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)].includes(event.key) ? event.key as TerminalKey : undefined;
      if (key) { event.preventDefault(); finish(() => current.current.terminal.current?.pressKey(key)); }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!available() || !event.clipboardData) return;
      event.preventDefault();
      const value = event.clipboardData.getData('text/plain');
      finish(() => current.current.terminal.current?.paste(value));
    };
    const onBlur = () => { if (!finishing) finish(() => {}); };
    input.addEventListener('compositionstart', onStart);
    input.addEventListener('compositionend', onEnd);
    input.addEventListener('input', onInput);
    input.addEventListener('beforeinput', onBeforeInput);
    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('paste', onPaste);
    input.addEventListener('blur', onBlur);
    return () => {
      alive = false; clear();
      input.removeEventListener('compositionstart', onStart);
      input.removeEventListener('compositionend', onEnd);
      input.removeEventListener('input', onInput);
      input.removeEventListener('beforeinput', onBeforeInput);
      input.removeEventListener('keydown', onKeyDown);
      input.removeEventListener('paste', onPaste);
      input.removeEventListener('blur', onBlur);
    };
  }, []);

  useLayoutEffect(() => { if (!props.enabled || props.hidden) reset.current(); }, [props.enabled, props.hidden]);

  return <div className="terminal-live-input" hidden={props.hidden}>
    <span className="live-indicator" aria-hidden="true" />
    <textarea ref={field} aria-label="라이브 입력" placeholder="라이브 입력" rows={1} maxLength={16384} disabled={!props.enabled}
      autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false} enterKeyHint="enter" />
    <button type="button" className="dock-toggle" aria-label="키보드 닫기" onClick={() => actions.current.run(() => field.current?.blur())}><KeyboardOff size={18} /></button>
  </div>;
});
