import type { Terminal } from '@xterm/xterm';
import { copyText } from './clipboard';

// tmux copies mouse selections (drag, double or triple click) to the outer
// terminal with OSC 52. Accept them only right after a pointer gesture in this
// terminal and never answer clipboard queries. If the browser blocks the write,
// as Safari does once the gesture has ended, ⌘C copies the last selection while
// xterm has none of its own.
export function attachTerminalClipboard(term: Terminal, element: HTMLElement, onBlocked: () => void) {
  let gesture = -Infinity;
  let last = '';
  const onPointer = () => { gesture = performance.now(); };
  // Safari enables Copy without a selection only if beforecopy is cancelled.
  const onBeforeCopy = (event: Event) => { if (last && !term.hasSelection()) event.preventDefault(); };
  const onCopy = (event: ClipboardEvent) => {
    if (term.hasSelection() || !last || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', last);
    event.preventDefault();
  };
  element.addEventListener('pointerdown', onPointer, true);
  element.addEventListener('pointerup', onPointer, true);
  element.addEventListener('beforecopy', onBeforeCopy);
  element.addEventListener('copy', onCopy);
  const osc = term.parser.registerOscHandler(52, data => {
    const payload = data.slice(data.indexOf(';') + 1);
    if (payload === '?' || performance.now() - gesture > 5000) return true;
    try { last = new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0))); }
    catch { return true; }
    if (last) void copyText(last).then(ok => { if (!ok) onBlocked(); });
    return true;
  });
  return () => {
    osc.dispose();
    element.removeEventListener('pointerdown', onPointer, true);
    element.removeEventListener('pointerup', onPointer, true);
    element.removeEventListener('beforecopy', onBeforeCopy);
    element.removeEventListener('copy', onCopy);
  };
}
