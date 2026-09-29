import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

export function terminalGeometry(term: Terminal, fit: FitAddon, container: HTMLElement, active: () => boolean, onSize: (cols: number, rows: number) => void) {
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
  let unobscuredHeight = 0;
  let measuredWidth = 0;
  const mobileKeyboard = () => matchMedia('(pointer: coarse)').matches && document.documentElement.classList.contains('keyboard-open');
  const cellHeight = () => (term.element?.querySelector('.xterm-screen')?.getBoundingClientRect().height ?? 0) / term.rows;
  const positionScreen = () => {
    if (!active() || !term.element || !container) return;
    const height = cellHeight();
    // Keep the input cursor visible when the keyboard covers an otherwise
    // empty shell or a TUI with its prompt near the top of the grid.
    const clipped = Math.max(0, height * term.rows - container.clientHeight);
    const shift = mobileKeyboard() ? Math.max(0, clipped - Math.max(0, term.buffer.active.cursorY - 2) * height) : 0;
    term.element.style.transform = shift ? `translateY(${shift}px)` : '';
  };
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  const cursor = term.onCursorMove(() => {
    // TUIs move the cursor around while repainting. Follow the final input
    // position rather than panning with every intermediate escape sequence.
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(positionScreen, 50);
  });
  const resize = () => {
    if (!active() || !container.clientWidth || !container.clientHeight) return;
    const size = fit.proposeDimensions();
    if (!size) return;
    const cols = Math.min(500, Math.max(2, size.cols));
    const keyboard = mobileKeyboard();
    if (!keyboard) unobscuredHeight = container.clientHeight;
    else if (!unobscuredHeight || measuredWidth !== container.clientWidth) {
      const style = getComputedStyle(document.documentElement);
      unobscuredHeight = container.clientHeight + (parseFloat(style.getPropertyValue('--keyboard-inset')) || 0)
        - (parseFloat(style.getPropertyValue('--terminal-safe-bottom')) || 0);
    }
    measuredWidth = container.clientWidth;
    const height = cellHeight();
    // A keyboard is an occlusion, not a new terminal size. Resizing tmux here
    // reflows applications and moves its copy-mode history even on one resize.
    const rows = Math.min(200, Math.max(2, keyboard && height ? Math.floor(unobscuredHeight / height) : size.rows));
    if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
    positionScreen();
    onSize(cols, rows);
  };
  let frame = 0;
  const scheduleFit = () => {
    positionScreen();
    clearTimeout(fitTimer); cancelAnimationFrame(frame);
    // Activation, font changes and ResizeObserver must share the same quiet
    // period. A warm session can be selected before iOS dismisses its keyboard.
    fitTimer = setTimeout(() => { frame = requestAnimationFrame(resize); }, matchMedia('(pointer: coarse)').matches ? 250 : 120);
  };
  const observer = new ResizeObserver(scheduleFit);
  observer.observe(container);
  resize();
  return { schedule: scheduleFit, dispose: () => {
    clearTimeout(fitTimer); clearTimeout(cursorTimer); cancelAnimationFrame(frame);
    observer.disconnect(); cursor.dispose();
  } };
}
