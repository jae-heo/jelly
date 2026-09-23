import { useEffect, useRef, useState } from 'react';

export function useFullscreen(active: boolean, onError: (message: string) => void) {
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const pending = useRef(false);
  const available = !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';

  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    if (!active && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [active]);

  async function toggle() {
    if (!available || pending.current) return;
    pending.current = true;
    try {
      // Keep the request in the button's user gesture. The document root also
      // contains dialogs and notices, so they remain visible in fullscreen.
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      onError('전체 화면 전환 실패. 다시 시도하세요.');
    } finally { pending.current = false; }
  }
  return { available, fullscreen, toggle };
}
