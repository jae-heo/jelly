import type { Terminal } from '@xterm/xterm';

// tmux owns the scrollback, while xterm displays its alternate screen. Translate
// one-finger swipes into wheel events so xterm uses the negotiated mouse protocol
// and tmux can scroll either its history or the application running inside it.
export function attachTouchScroll(term: Terminal): () => void {
  const element = term.element!;
  let gesture: { id: number; x: number; y: number; previousY: number; pending: number; scrolling: boolean } | undefined;
  const start = (event: TouchEvent) => {
    gesture = undefined;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, previousY: touch.clientY, pending: 0, scrolling: false };
    // Avoid xterm's separate viewport gestures: they cannot scroll tmux's history.
    // Do not preventDefault here; a normal tap must still focus the keyboard.
    event.stopPropagation();
  };
  const move = (event: TouchEvent) => {
    if (!gesture || event.touches.length !== 1) { gesture = undefined; return; }
    const touch = event.touches[0];
    if (!touch) return;
    if (touch.identifier !== gesture.id) return;
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (!gesture.scrolling && (Math.abs(dy) < 6 || Math.abs(dy) <= Math.abs(dx))) return;
    gesture.scrolling = true;
    event.preventDefault();
    event.stopPropagation();
    gesture.pending += gesture.previousY - touch.clientY;
    gesture.previousY = touch.clientY;
    const screen = element.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!screen?.height || !screen.width) return;
    // tmux's default wheel binding advances five rows per report.
    const step = Math.max(12, screen.height / term.rows * 5);
    const count = Math.trunc(gesture.pending / step);
    gesture.pending -= count * step;
    if (term.modes.mouseTrackingMode === 'none') {
      // Never turn a swipe into arrow keys / shell command history during startup.
      if (term.buffer.active.type === 'normal') term.scrollLines(count * 5);
      return;
    }
    for (let i = 0; i < Math.min(Math.abs(count), 20); i++) {
      element.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: Math.sign(count),
        clientX: Math.max(screen.left + 1, Math.min(screen.right - 1, gesture.x)),
        clientY: Math.max(screen.top + 1, Math.min(screen.bottom - 1, gesture.y)),
      }));
    }
  };
  const end = (event: TouchEvent) => {
    if (gesture?.scrolling) event.preventDefault(); // Suppress the synthetic click after a swipe.
    if (gesture) event.stopPropagation();
    gesture = undefined;
  };
  element.addEventListener('touchstart', start, { capture: true, passive: true });
  element.addEventListener('touchmove', move, { capture: true, passive: false });
  element.addEventListener('touchend', end, { capture: true, passive: false });
  element.addEventListener('touchcancel', end, { capture: true, passive: false });
  return () => {
    element.removeEventListener('touchstart', start, true);
    element.removeEventListener('touchmove', move, true);
    element.removeEventListener('touchend', end, true);
    element.removeEventListener('touchcancel', end, true);
  };
}
