import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TerminalHandle } from './TerminalView';
import type { RefObject } from 'react';
import { X } from 'lucide-react';

// execCommand supports explicit copy gestures on Jelly's HTTP tailnet origin,
// where navigator.clipboard is unavailable. Never read the system clipboard.
async function copyText(text: string): Promise<boolean> {
  let copied = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    copied = true;
  };
  document.addEventListener('copy', onCopy);
  try {
    if (document.execCommand('copy') && copied) return true;
  } catch { /* Try the secure-context API if available. */ }
  finally { document.removeEventListener('copy', onCopy); }
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

export function TerminalSelection({ text, fontSize, terminal, onClose }: { text: string; fontSize: number; terminal: RefObject<TerminalHandle | null>; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState(text);
  const content = useRef<HTMLPreElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    close.current?.focus({ preventScroll: true });
    const onSelection = () => {
      const selection = window.getSelection();
      if (!selection || !content.current) return;
      const inside = content.current.contains(selection.anchorNode) && content.current.contains(selection.focusNode);
      setSelected(inside ? selection.toString() : '');
      setError('');
    };
    document.addEventListener('selectionchange', onSelection);
    return () => {
      alive.current = false;
      document.removeEventListener('selectionchange', onSelection);
      const selection = window.getSelection();
      if (selection && content.current?.contains(selection.anchorNode)) selection.removeAllRanges();
      if (previous instanceof HTMLElement && previous.isConnected && !previous.matches('input, textarea')) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (content.current) return terminal.current?.selectScroll(content.current, setSnapshot);
  }, [terminal]);
  useLayoutEffect(() => {
    // The toolbar takes a few rows; keep the bottom of each screen reachable.
    if (content.current) content.current.scrollTop = content.current.scrollHeight;
  }, [snapshot]);
  const selectAll = () => {
    if (!content.current) return;
    const range = document.createRange();
    range.selectNodeContents(content.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setSelected(selection?.toString() ?? '');
  };
  return <section className="terminal-selection" role="region" aria-label="Select terminal text" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); }
  }}>
    <div className="selection-toolbar" onMouseDown={event => {
      // Preserve the range while clicking Copy, including synthesized touch clicks.
      if (event.button === 0) event.preventDefault();
    }}>
      <span>Select text</span>
      <button className="text-button" onClick={selectAll}>Select all</button>
      <button className="text-button" disabled={!selected} onClick={() => {
        void copyText(selected).then(ok => { if (alive.current && !ok) setError('Copy was blocked. Use your device’s Copy menu.'); });
      }}>Copy</button>
      <button ref={close} className="icon-button" aria-label="Close selection" onClick={onClose}><X size={18} /></button>
    </div>
    {error && <p className="selection-error" role="alert">{error}</p>}
    <pre ref={content} className="selection-text" tabIndex={0} style={{ fontSize }}>{snapshot}</pre>
  </section>;
}
