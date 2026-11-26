import type { IBufferCell, ILink, Terminal } from '@xterm/xterm';

const urlPattern = /https?:\/\/[^\s<>"'`]+/g;

// Trailing punctuation belongs to the sentence; a closing bracket stays when
// the URL opened it, as in Wikipedia links.
export function trimUrl(text: string): string {
  let end = text.length;
  while (end > 0) {
    const char = text[end - 1]!;
    const open = { ')': '(', ']': '[', '}': '{' }[char];
    const body = text.slice(0, end);
    if ('.,;:!?*'.includes(char) || (open && body.split(open).length <= body.split(char).length - 1)) end--;
    else break;
  }
  return text.slice(0, end);
}

export function openLink(event: MouseEvent, url: string) {
  // ⌘-click on Mac, Ctrl-click elsewhere, as in native terminals.
  if (!event.metaKey && !event.ctrlKey) return;
  event.preventDefault();
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Finds http(s) URLs on screen, including ones that run past the last column
// onto the next row, as tmux draws wrapped output.
export function attachTerminalLinks(term: Terminal) {
  let cell: IBufferCell | undefined;
  const filled = (y: number) => {
    const line = term.buffer.active.getLine(y);
    cell = line?.getCell(term.cols - 1, cell);
    return !!cell && cell.getChars().trim() !== '';
  };
  const startsText = (y: number) => {
    const line = term.buffer.active.getLine(y);
    cell = line?.getCell(0, cell);
    return !!cell && cell.getChars().trim() !== '';
  };
  return term.registerLinkProvider({
    provideLinks(bufferLine, callback) {
      const y = bufferLine - 1;
      let first = y; let last = y;
      while (first > 0 && y - first < 8 && filled(first - 1) && startsText(first)) first--;
      while (last - y < 8 && last + 1 < term.buffer.active.length && filled(last) && startsText(last + 1)) last++;
      let text = '';
      // Each string index's cell: first and last column (1-based) and row.
      const positions: { from: number; to: number; y: number }[] = [];
      for (let row = first; row <= last; row++) {
        const line = term.buffer.active.getLine(row);
        for (let x = 0; line && x < term.cols; x++) {
          cell = line.getCell(x, cell);
          if (!cell || !cell.getWidth()) continue;
          const chars = cell.getChars() || ' ';
          for (let i = 0; i < chars.length; i++) positions.push({ from: x + 1, to: x + cell.getWidth(), y: row + 1 });
          text += chars;
        }
      }
      const links: ILink[] = [];
      for (const match of text.matchAll(urlPattern)) {
        const url = trimUrl(match[0]);
        try { if (!['http:', 'https:'].includes(new URL(url).protocol)) continue; } catch { continue; }
        const start = positions[match.index]!; const end = positions[match.index + url.length - 1]!;
        if (start.y > bufferLine || end.y < bufferLine) continue;
        // Look like a link only while ⌘ or Ctrl is held; a plain click goes to the program.
        const link: ILink = { text: url, range: { start: { x: start.from, y: start.y }, end: { x: end.to, y: end.y } }, activate: openLink,
          decorations: { pointerCursor: false, underline: false },
          hover: event => { const held = event.metaKey || event.ctrlKey; link.decorations = { pointerCursor: held, underline: held }; } };
        links.push(link);
      }
      callback(links.length ? links : undefined);
    },
  });
}
