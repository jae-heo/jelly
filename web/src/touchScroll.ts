import type { Terminal } from '@xterm/xterm';

// tmux owns scrollback. Keep using xterm's negotiated mouse protocol so swipes
// also work inside terminal applications, without turning them into arrow keys.
export function attachTerminalScroll(term: Terminal, onTap: () => void, active: () => boolean, selection?: { surface: HTMLElement; onScroll: () => void }) {
  const element = term.element!;
  const surface = selection?.surface ?? element;
  const selecting = () => !!selection && !window.getSelection()?.isCollapsed;
  type Gesture = { id: number; x: number; y: number; previousY: number; pending: number;
    scrolling: boolean; horizontal: boolean; time: number; velocity: number };
  let gesture: Gesture | undefined;
  let frame = 0;
  let coasting = false;
  let stoppingTap = false;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; coasting = false; gesture = undefined; };
  let dispatchingWheel = false;
  let wheelPending = 0;
  let wheelTime = 0;
  let wheelMode = -1;
  // xterm emits only one mouse report per wheel event, regardless of delta.
  // Split the distance into reports while retaining its negotiated encoding.
  const reportWheel = (count: number, x: number, y: number, modifiers?: WheelEvent) => {
    dispatchingWheel = true;
    try {
      for (let i = 0; i < Math.min(Math.abs(count), 40); i++) {
        element.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: Math.sign(count),
          clientX: x, clientY: y, altKey: modifiers?.altKey, ctrlKey: modifiers?.ctrlKey,
        }));
      }
    } finally { dispatchingWheel = false; }
  };
  const desktopWheel = (event: WheelEvent) => {
    if (dispatchingWheel || !active() || document.hidden || (!selection && term.modes.mouseTrackingMode === 'none') || event.ctrlKey || event.shiftKey) return;
    if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const screen = element.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!screen?.height) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const now = performance.now();
    if (now - wheelTime > 150 || wheelMode !== event.deltaMode || Math.sign(wheelPending) !== Math.sign(event.deltaY)) wheelPending = 0;
    wheelTime = now; wheelMode = event.deltaMode;
    const line = screen.height / term.rows;
    const distance = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * term.rows
      : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY : event.deltaY / line;
    wheelPending += distance;
    const count = Math.trunc(wheelPending);
    wheelPending -= count;
    if (count) selection?.onScroll();
    if (selection && term.modes.mouseTrackingMode === 'none') term.scrollLines(count);
    else if (selection) {
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: count, deltaMode: WheelEvent.DOM_DELTA_LINE, clientX: screen.left + 1, clientY: screen.top + 1 }));
    } else reportWheel(count, event.clientX, event.clientY, event);
  };
  // Slow dragging stays precise; quick swipes cover substantially more output.
  const touchGain = (velocity: number) => 1 + Math.min(3, Math.max(0, Math.abs(velocity) - 0.5));
  const scroll = (state: Gesture, pixels: number) => {
    const screen = element.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!screen?.height || !screen.width || !active() || document.hidden) return false;
    state.pending += pixels;
    const line = screen.height / term.rows;
    const mouse = term.modes.mouseTrackingMode !== 'none';
    // A tmux wheel report advances five rows; native xterm scrollback can move
    // one row at a time. Keep both proportional to the finger's travel.
    const rows = mouse ? 5 : 1;
    const step = Math.max(1, line * rows);
    const count = Math.trunc(state.pending / step);
    state.pending -= count * step;
    if (count) selection?.onScroll();
    if (!mouse) {
      if (term.buffer.active.type !== 'normal') return false;
      term.scrollLines(count);
    } else {
      reportWheel(count,
        Math.max(screen.left + 1, Math.min(screen.right - 1, state.x)),
        Math.max(screen.top + 1, Math.min(screen.bottom - 1, state.y)));
    }
    return true;
  };
  const coast = (state: Gesture) => {
    // Preserve slow gestures while allowing fast flicks to cover longer output.
    let velocity = Math.max(-12, Math.min(12, state.velocity)); // CSS pixels / ms.
    if (Math.abs(velocity) < 0.25 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let previous = performance.now();
    const started = previous;
    coasting = true;
    const tick = (now: number) => {
      // Never catch up a stalled/backgrounded frame with a large jump.
      const elapsed = now - previous;
      if (elapsed > 80 || now - started > 1200 || !active() || document.hidden) { stop(); return; }
      previous = now;
      const decay = Math.exp(-elapsed / 300);
      const distance = velocity * 300 * (1 - decay) * touchGain(velocity);
      velocity *= decay;
      if (!scroll(state, distance) || Math.abs(velocity) < 0.08) { stop(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  const interrupt = (event: Event) => {
    // A touch that catches moving output should only stop it, not open input.
    stoppingTap = coasting && element.contains(event.target as Node);
    stop();
  };
  const pointer = (event: PointerEvent) => { if (event.pointerType !== 'touch') stop(); };
  const wheel = (event: WheelEvent) => { if (event.isTrusted) stop(); };
  const start = (event: TouchEvent) => {
    stop();
    if (!active() || event.touches.length !== 1 || selecting()) return;
    const touch = event.touches[0];
    if (!touch) return;
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, previousY: touch.clientY,
      pending: 0, scrolling: false, horizontal: false, time: performance.now(), velocity: 0 };
    event.stopPropagation();
  };
  const move = (event: TouchEvent) => {
    if (!gesture || event.touches.length !== 1) { stop(); return; }
    const touch = event.touches[0];
    if (!touch || touch.identifier !== gesture.id) return;
    event.stopPropagation();
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (gesture.horizontal) return;
    if (!gesture.scrolling) {
      // Leave long presses and native selection handles to the browser.
      if (selection && (selecting() || performance.now() - gesture.time > 350)) { stop(); return; }
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (Math.abs(dx) >= Math.abs(dy)) { gesture.horizontal = true; return; }
      gesture.scrolling = true;
    }
    event.preventDefault();
    const now = performance.now();
    const distance = gesture.previousY - touch.clientY;
    const elapsed = Math.max(8, now - gesture.time);
    const velocity = distance / elapsed;
    gesture.velocity = Math.sign(velocity) !== Math.sign(gesture.velocity) || elapsed > 100
      ? velocity : gesture.velocity * 0.4 + velocity * 0.6;
    if (distance && Math.sign(distance) !== Math.sign(gesture.pending)) gesture.pending = 0;
    gesture.previousY = touch.clientY; gesture.time = now;
    scroll(gesture, distance * touchGain(gesture.velocity));
  };
  const end = (event: TouchEvent) => {
    const state = gesture;
    gesture = undefined;
    if (state) event.stopPropagation();
    if (state?.scrolling) {
      event.preventDefault();
      // A held finger, cancelled gesture or second touch never starts momentum.
      if (event.type === 'touchend' && !event.touches.length && performance.now() - state.time < 100) coast(state);
    } else if (state && event.type === 'touchend' && !event.touches.length) {
      if (!selection) event.preventDefault();
      if (!state.horizontal && !stoppingTap) onTap();
    }
    stoppingTap = false;
  };
  document.addEventListener('touchstart', interrupt, { capture: true, passive: true });
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('wheel', wheel, { capture: true, passive: true });
  document.addEventListener('keydown', stop, true);
  document.addEventListener('beforeinput', stop, true);
  document.addEventListener('focusin', stop, true);
  document.addEventListener('visibilitychange', stop);
  window.addEventListener('resize', stop);
  visualViewport?.addEventListener('resize', stop);
  surface.addEventListener('wheel', desktopWheel, { capture: true, passive: false });
  surface.addEventListener('touchstart', start, { capture: true, passive: true });
  surface.addEventListener('touchmove', move, { capture: true, passive: false });
  surface.addEventListener('touchend', end, { capture: true, passive: false });
  surface.addEventListener('touchcancel', end, { capture: true, passive: false });
  return { stop, dispose: () => {
    stop();
    document.removeEventListener('touchstart', interrupt, true);
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('wheel', wheel, true);
    document.removeEventListener('keydown', stop, true);
    document.removeEventListener('beforeinput', stop, true);
    document.removeEventListener('focusin', stop, true);
    document.removeEventListener('visibilitychange', stop);
    window.removeEventListener('resize', stop);
    visualViewport?.removeEventListener('resize', stop);
    surface.removeEventListener('wheel', desktopWheel, true);
    surface.removeEventListener('touchstart', start, true);
    surface.removeEventListener('touchmove', move, true);
    surface.removeEventListener('touchend', end, true);
    surface.removeEventListener('touchcancel', end, true);
  } };
}
