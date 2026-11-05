import { Fragment, type ReactNode } from 'react';

// Agent replies use a small part of Markdown. React escapes all text and raw
// HTML is never rendered; links open only for http(s) URLs.
const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|https?:\/\/[^\s<>)\]]+)/;

function inline(text: string): ReactNode[] {
  return text.split(inlinePattern).filter(part => part !== '').map((part, index) => {
    if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{inline(part.slice(2, -2))}</strong>;
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <em key={index}>{inline(part.slice(1, -1))}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    const url = link ? link[2]! : /^https?:\/\//.test(part) ? part : null;
    if (url && /^https?:\/\//.test(url)) return <a key={index} href={url} target="_blank" rel="noopener noreferrer">{link ? inline(link[1]!) : part}</a>;
    return <Fragment key={index}>{link ? link[1] : part}</Fragment>;
  });
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function List({ lines }: { lines: string[] }) {
  // One level of nesting covers agent replies; deeper levels join their parent.
  const items: { text: string; children: string[] }[] = [];
  const indent = listItem.exec(lines[0]!)![1]!.length;
  for (const line of lines) {
    const match = listItem.exec(line);
    if (match && match[1]!.length <= indent) items.push({ text: match[3]!, children: [] });
    else if (match && items.length) items.at(-1)!.children.push(line);
    else if (items.length) items.at(-1)!.text += `\n${line.trim()}`;
  }
  const ordered = /^\d/.test(listItem.exec(lines[0]!)![2]!);
  const start = ordered ? Number.parseInt(listItem.exec(lines[0]!)![2]!, 10) : undefined;
  const children = items.map((item, index) => <li key={index}>{inline(item.text)}{item.children.length > 0 && <List lines={item.children} />}</li>);
  return ordered ? <ol start={start !== 1 ? start : undefined}>{children}</ol> : <ul>{children}</ul>;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let paragraph: string[] = [];
  const key = () => blocks.length;
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={key()}>{inline(paragraph.join('\n'))}</p>);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*```\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i]!);
      blocks.push(<figure key={key()} className="md-code">{fence[1] && <figcaption>{fence[1]}</figcaption>}<pre><code>{code.join('\n')}</code></pre></figure>);
    } else if (/^\s*\|/.test(line)) {
      flush();
      const rows = [line];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1]!)) rows.push(lines[++i]!);
      const separator = rows.length > 1 && /^[\s|:-]+$/.test(rows[1]!);
      const head = separator ? cells(rows[0]!) : null;
      const body = (separator ? rows.slice(2) : rows).map(cells);
      blocks.push(<div key={key()} className="md-table"><table>
        {head && <thead><tr>{head.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead>}
        <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{inline(cell)}</td>)}</tr>)}</tbody>
      </table></div>);
    } else if (/^#{1,6}\s/.test(line)) {
      flush();
      const level = Math.min(3, /^#+/.exec(line)![0].length);
      blocks.push(<p key={key()} className={`md-heading md-h${level}`}>{inline(line.replace(/^#+\s+/, ''))}</p>);
    } else if (listItem.test(line)) {
      flush();
      const list = [line];
      const [, indent, marker] = listItem.exec(line)!;
      // A top-level switch between bullets and numbers starts a new list.
      const sameList = (next: string) => {
        const match = listItem.exec(next);
        if (!match) return /^\s{2,}\S/.test(next);
        return match[1]!.length > indent!.length || /^\d/.test(match[2]!) === /^\d/.test(marker!);
      };
      while (i + 1 < lines.length && sameList(lines[i + 1]!)) list.push(lines[++i]!);
      blocks.push(<List key={key()} lines={list} />);
    } else if (/^\s*>/.test(line)) {
      flush();
      const quote = [line.replace(/^\s*>\s?/, '')];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1]!)) quote.push(lines[++i]!.replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key()}><Markdown text={quote.join('\n')} /></blockquote>);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push(<hr key={key()} />); }
    else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return <>{blocks}</>;
}
