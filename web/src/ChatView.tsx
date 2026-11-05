import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Check, CircleAlert, TerminalSquare } from 'lucide-react';
import type { ChatAgent, ChatItem } from './api';
import './ChatView.css';

// Inline `code` and **bold**. React escapes everything else; no raw HTML.
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 1 ? <code key={index}>{part.slice(1, -1)}</code>
      : part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={index}>{part.slice(2, -2)}</strong>
        : <Fragment key={index}>{part}</Fragment>);
}

/** Enough Markdown for agent replies: paragraphs, headings, fences and tables. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join('\n'))}</p>);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i]!);
      blocks.push(<pre key={blocks.length}><code>{code.join('\n')}</code></pre>);
    } else if (/^\s*\|/.test(line)) {
      flush();
      const rows = [line];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1]!)) rows.push(lines[++i]!);
      blocks.push(<pre key={blocks.length} className="chat-table">{rows.join('\n')}</pre>);
    } else if (/^#{1,6}\s/.test(line)) {
      flush();
      blocks.push(<p key={blocks.length} className="chat-heading">{inline(line.replace(/^#+\s+/, ''))}</p>);
    } else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return <>{blocks}</>;
}

function Entry({ item, running }: { item: ChatItem; running: boolean }) {
  if (item.kind === 'user') return <div className="chat-user"><p>{item.text}</p></div>;
  if (item.kind === 'assistant') return <div className="chat-assistant"><Markdown text={item.text} /></div>;
  if (item.kind === 'note') return <p className="chat-note">{item.text}</p>;
  const state = item.output === undefined ? running ? <span className="chat-tool-running" aria-label="Running" /> : null
    : item.error ? <CircleAlert size={14} className="chat-tool-error" aria-label="Failed" /> : <Check size={14} className="chat-tool-done" aria-label="Done" />;
  return <details className="chat-tool">
    <summary><strong>{item.name}</strong><span>{item.summary}</span>{state}</summary>
    <pre>{item.input}</pre>
    {item.output !== undefined && <pre className={item.error ? 'chat-tool-output error' : 'chat-tool-output'}>{item.output || '(no output)'}</pre>}
  </details>;
}

export function ChatView({ agent, items, start, onLoadEarlier, onTerminal }: {
  agent: ChatAgent; items: ChatItem[]; start: number; onLoadEarlier: () => Promise<void>; onTerminal: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const restore = useRef<number | null>(null);
  // Follow new messages only while the reader is at the end.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (restore.current !== null) { element.scrollTop = element.scrollHeight - restore.current; restore.current = null; }
    else if (bottom.current) element.scrollTop = element.scrollHeight;
  }, [items, agent.status]);
  // The on-screen keyboard and rotation resize the view; keep the end in sight.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (bottom.current) element.scrollTop = element.scrollHeight; });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const busy = agent.status === 'busy';
  return <section className="chat-view" role="region" aria-label="Chat">
    <div className="chat-scroll" ref={scroller} onScroll={event => {
      const element = event.currentTarget;
      bottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    }}>
      {start > 0 && <button className="text-button chat-earlier" onClick={() => {
        restore.current = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop : null;
        void onLoadEarlier().catch(() => { restore.current = null; });
      }}>Load earlier</button>}
      {!items.length && <p className="chat-note">No messages yet</p>}
      {items.map(item => <Entry key={`${item.index}:${item.id}`} item={item} running={busy} />)}
      <div className="chat-status" role="status">
        {busy ? <><span className="chat-tool-running" />Working</> : 'Idle'}
        <button className="text-button" onClick={onTerminal}><TerminalSquare size={14} />Terminal</button>
      </div>
    </div>
  </section>;
}
