// execCommand supports explicit copy gestures on Jelly's HTTP tailnet origin,
// where navigator.clipboard is unavailable. Never read the system clipboard.
export async function copyText(text: string): Promise<boolean> {
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
