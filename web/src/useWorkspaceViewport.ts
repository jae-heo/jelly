import { useEffect } from 'react';

export function useWorkspaceViewport(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    let width = window.innerWidth;
    let fullHeight = window.innerHeight;
    let keyboardOpen = false;
    const update = () => {
      // Keep native pinch zoom/panning: don't resize or chase the zoomed viewport.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement && focused.inputMode !== 'none' && (
        focused.isContentEditable ||
        (focused instanceof HTMLTextAreaElement && !focused.readOnly) ||
        (focused instanceof HTMLInputElement && !focused.readOnly && /^(text|search|url|tel|email|password|number)$/.test(focused.type))
      );
      const layoutHeight = Math.max(window.innerHeight, root.clientHeight);
      // Remember the height before focus for browsers that shrink both viewports.
      // A width change resets the baseline so rotation doesn't look like a keyboard.
      if (window.innerWidth !== width) { fullHeight = layoutHeight; keyboardOpen = false; }
      else if (editing || keyboardOpen) fullHeight = Math.max(fullHeight, layoutHeight);
      else fullHeight = layoutHeight;
      width = window.innerWidth;
      // Focus alone can mean a hardware keyboard. Require a substantial viewport
      // reduction too; toolbar changes and pinch zoom must keep the safe area.
      // iOS blurs the old input before its keyboard finishes closing (including
      // session switches). Keep the inset stable until the viewport recovers.
      keyboardOpen = (editing || keyboardOpen) && fullHeight - height > Math.max(100, fullHeight * 0.2);
      root.classList.toggle('keyboard-open', keyboardOpen);
      root.style.setProperty('--keyboard-inset', `${keyboardOpen ? Math.max(0, fullHeight - height) : 0}px`);
      root.style.setProperty('--app-height', `${height}px`);
      root.style.setProperty('--app-top', `${Math.max(0, viewport?.offsetTop ?? 0)}px`);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    root.classList.add('workspace-open');
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('fullscreenchange', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('fullscreenchange', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      root.classList.remove('workspace-open', 'keyboard-open');
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-top');
      root.style.removeProperty('--keyboard-inset');
    };
  }, [active]);
}
