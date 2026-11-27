import type { IBufferCell, ILink, ILinkDecorations, Terminal } from '@xterm/xterm';

const urlPattern = /https?:\/\/[^\s<>"'`]+/g;
// A path whose last part has a file extension, optionally with :line:column.
const pathPattern = /(?<![\p{L}\p{N}_.~@%+=/:-])(?:\/|(?:\.{1,2}\/)+)?(?:\.?[\p{L}\p{N}_@%+=-][\p{L}\p{N}_.@%+=-]*\/)*\.?[\p{L}\p{N}_@%+=-][\p{L}\p{N}_.@%+=-]*\.(?=\p{N}*\p{L})[\p{L}\p{N}]{1,10}(?::\d+){0,2}(?![\p{L}\p{N}_/-])/gu;

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

export const isFilePath = (text: string) => new RegExp(`^(?:${pathPattern.source})$`, 'u').test(text);

// The project-relative path of a file path written by a program in the
// project folder, or null when it points outside the project.
export function projectFile(text: string, root: string): string | null {
  const path = text.replace(/(?::\d+){1,2}$/, '');
  // A lone x.y is an abbreviation such as e.g. more often than a file.
  if (!path || path.includes('\0') || /^[^/]\.[^/.]$/.test(path)) return null;
  const parts: string[] = [];
  for (const part of (path.startsWith('/') ? path : `${root}/${path}`).split('/')) {
    if (!part || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (!parts.pop()) return null;
  }
  const base = root.split('/').filter(Boolean);
  if (parts.length <= base.length || base.some((part, i) => parts[i] !== part)) return null;
  return parts.slice(base.length).join('/');
}

// ⌘-click on Mac, Ctrl-click elsewhere, as in native terminals.
const held = (event: MouseEvent | KeyboardEvent) => event.metaKey || event.ctrlKey;

export function openLink(event: MouseEvent, url: string) {
  if (!held(event)) return;
  event.preventDefault();
  window.open(url, '_blank', 'noopener,noreferrer');
}

export interface FileLinks { root: () => string | undefined; open: (path: string) => void }

// Finds http(s) URLs and project file paths on screen, including ones that run
// past the last column onto the next row, as tmux draws wrapped output.
export function attachTerminalLinks(term: Terminal, files: FileLinks) {
  let cell: IBufferCell | undefined;
  // Links look like links only while ⌘ or Ctrl is held; a plain click goes to
  // the program. xterm reads a link's decorations when the pointer enters it.
  let modifier = false;
  let hovered: ILink | undefined;
  const decorations: ILinkDecorations = { get pointerCursor() { return modifier; }, get underline() { return modifier; } } as ILinkDecorations;
  const track = (event: MouseEvent | KeyboardEvent) => {
    if (held(event) === modifier) return;
    modifier = held(event);
    if (hovered?.decorations) { hovered.decorations.pointerCursor = modifier; hovered.decorations.underline = modifier; }
  };
  const release = () => track(new KeyboardEvent('keyup'));
  for (const type of ['keydown', 'keyup', 'mousemove'] as const) window.addEventListener(type, track, true);
  window.addEventListener('blur', release);
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
  const provider = term.registerLinkProvider({
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
      const taken: [number, number][] = [];
      const add = (index: number, length: number, linkText: string, activate: (event: MouseEvent) => void) => {
        taken.push([index, index + length]);
        const start = positions[index]!; const end = positions[index + length - 1]!;
        if (start.y > bufferLine || end.y < bufferLine) return;
        const link: ILink = { text: linkText, range: { start: { x: start.from, y: start.y }, end: { x: end.to, y: end.y } }, decorations, activate,
          hover: () => { hovered = link; }, leave: () => { if (hovered === link) hovered = undefined; } };
        links.push(link);
      };
      for (const match of text.matchAll(urlPattern)) {
        const url = trimUrl(match[0]);
        try { if (!['http:', 'https:'].includes(new URL(url).protocol)) continue; } catch { continue; }
        add(match.index, url.length, url, event => openLink(event, url));
      }
      const root = files.root();
      for (const match of root ? text.matchAll(pathPattern) : []) {
        if (taken.some(([from, to]) => match.index < to && match.index + match[0].length > from)) continue;
        const path = projectFile(match[0], root!);
        if (path) add(match.index, match[0].length, match[0], event => {
          if (!held(event)) return;
          event.preventDefault();
          files.open(path);
        });
      }
      callback(links.length ? links : undefined);
    },
  });
  return {
    dispose() {
      provider.dispose();
      for (const type of ['keydown', 'keyup', 'mousemove'] as const) window.removeEventListener(type, track, true);
      window.removeEventListener('blur', release);
    },
  };
}
