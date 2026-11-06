import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ArrowDown, Check, ChevronRight, CircleAlert, TerminalSquare } from 'lucide-react';
import type { ChatAgent, ChatItem } from './api';
import { Markdown } from './ChatMarkdown';
import { agentDraft } from './agentDraft';
import type { TerminalHandle } from './TerminalView';
import './ChatView.css';

type Tool = Extract<ChatItem, { kind: 'tool' }>;
type Row = { kind: 'item'; item: Exclude<ChatItem, Tool> } | { kind: 'tools'; tools: Tool[] };

// Consecutive tool calls become one collapsible row.
function rows(items: ChatItem[]): Row[] {
  const result: Row[] = [];
  for (const item of items) {
    const last = result.at(-1);
    if (item.kind === 'tool') { if (last?.kind === 'tools') last.tools.push(item); else result.push({ kind: 'tools', tools: [item] }); }
    else result.push({ kind: 'item', item });
  }
  return result;
}

// A path reads best as its file name; the full path stays in the tooltip.
const short = (summary: string) => /^\/\S+$/.test(summary) ? summary.split('/').filter(Boolean).at(-1) ?? summary : summary;
const clock = (time?: string) => time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

function State({ tool, running }: { tool: Tool; running: boolean }) {
  if (tool.output === undefined) return running ? <span className="chat-spinner" aria-label="Running" /> : null;
  return tool.error ? <CircleAlert size={14} className="chat-failed" aria-label="Failed" /> : <Check size={14} className="chat-done" aria-label="Done" />;
}

function Diff({ diff }: { diff: NonNullable<Tool['diff']> }) {
  return <div className="chat-diff">{diff.map((edit, index) => <pre key={index}>
    {edit.old.split('\n').map((line, row) => <span key={`o${row}`} className="removed">{line}{'\n'}</span>)}
    {edit.new.split('\n').map((line, row) => <span key={`n${row}`} className="added">{line}{'\n'}</span>)}
  </pre>)}</div>;
}

function ToolCall({ tool, running }: { tool: Tool; running: boolean }) {
  return <details className="chat-tool">
    <summary><ChevronRight size={13} className="chat-chevron" /><strong>{tool.name}</strong><span className="chat-tool-summary" title={tool.summary}>{short(tool.summary)}</span><State tool={tool} running={running} /></summary>
    <div className="chat-tool-body">
      {tool.diff ? <Diff diff={tool.diff} /> : <pre className={tool.name === 'Bash' ? 'chat-command' : undefined}>{tool.input}</pre>}
      {tool.output !== undefined && <pre className={tool.error ? 'chat-output error' : 'chat-output'}>{tool.output || '(no output)'}</pre>}
    </div>
  </details>;
}

function ToolGroup({ tools, running }: { tools: Tool[]; running: boolean }) {
  if (tools.length === 1) return <ToolCall tool={tools[0]!} running={running} />;
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  const failed = tools.filter(tool => tool.error).length;
  const last = tools.at(-1)!;
  const active = running && last.output === undefined;
  return <details className="chat-tools">
    <summary>
      <ChevronRight size={13} className="chat-chevron" />
      <strong>{[...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(' · ')}</strong>
      <span className="chat-tool-summary" title={last.summary}>{short(last.summary)}</span>
      {failed > 0 && <span className="chat-failed-count"><CircleAlert size={13} />{failed}</span>}
      {active ? <span className="chat-spinner" aria-label="Running" /> : <Check size={14} className="chat-done" aria-label="Done" />}
    </summary>
    <div className="chat-tools-list">{tools.map(tool => <ToolCall key={tool.id} tool={tool} running={running} />)}</div>
  </details>;
}

function Message({ item }: { item: Exclude<ChatItem, Tool> }) {
  if (item.kind === 'user') return <div className="chat-user"><p>{item.text}</p>{item.time && <time dateTime={item.time}>{clock(item.time)}</time>}</div>;
  if (item.kind === 'assistant') return <div className="chat-assistant"><Markdown text={item.text} /></div>;
  if (item.text === 'Conversation compacted') return <p className="chat-divider"><span>{item.text}</span></p>;
  return <p className={item.text.startsWith('/') || item.text.startsWith('! ') ? 'chat-note chat-command-note' : 'chat-note'}>{item.text}</p>;
}

export function ChatView({ agent, items, start, onLoadEarlier, onTerminal, terminal, live }: {
  agent: ChatAgent; items: ChatItem[]; start: number; onLoadEarlier: () => Promise<void>; onTerminal: () => void;
  terminal: RefObject<TerminalHandle | null>; live: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const restore = useRef<number | null>(null);
  const [away, setAway] = useState(false);
  // What is typed into the agent's prompt, read from the terminal screen.
  const [draft, setDraft] = useState('');
  const draftBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!live) return;
    return terminal.current?.watchScreen(rows => setDraft(agentDraft(rows) ?? ''));
  }, [terminal, live]);
  useLayoutEffect(() => { if (draftBox.current) draftBox.current.scrollTop = draftBox.current.scrollHeight; }, [draft]);
  const busy = agent.status === 'busy';
  const toEnd = () => { const element = scroller.current; if (element) element.scrollTop = element.scrollHeight; };
  // Follow new messages only while the reader is at the end.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (restore.current !== null) { element.scrollTop = element.scrollHeight - restore.current; restore.current = null; }
    else if (bottom.current) toEnd();
  }, [items, busy]);
  // The on-screen keyboard and rotation resize the view; keep the end in sight.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (bottom.current) toEnd(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const last = items.at(-1);
  return <section className="chat-view" role="region" aria-label="Chat">
    <div className="chat-body">
      <div className="chat-scroll" ref={scroller} onScroll={event => {
        const element = event.currentTarget;
        bottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        setAway(element.scrollHeight - element.scrollTop - element.clientHeight > 400);
      }}>
        <div className="chat-thread">
          {start > 0 && <button className="chat-earlier" onClick={() => {
            restore.current = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop : null;
            void onLoadEarlier().catch(() => { restore.current = null; });
          }}>Load earlier</button>}
          {!items.length && <p className="chat-note">No messages yet</p>}
          {rows(items).map(row => row.kind === 'tools'
            ? <ToolGroup key={`t${row.tools[0]!.index}`} tools={row.tools} running={busy} />
            : <Message key={`${row.item.index}:${row.item.id}`} item={row.item} />)}
          {busy && last?.kind !== 'tool' && <div className="chat-typing" aria-hidden="true"><i /><i /><i /></div>}
        </div>
      </div>
      {away && <button className="chat-jump" aria-label="Latest messages" onClick={() => { bottom.current = true; toEnd(); }}><ArrowDown size={18} /></button>}
    </div>
    {draft && <div className="chat-draft" ref={draftBox} role="group" aria-label="Prompt"><p>{draft}</p></div>}
    <div className="chat-status" role="status">
      <span className={`chat-state ${busy ? 'busy' : ''}`}><i />{busy ? 'Working' : 'Idle'}</span>
      <button className="chat-terminal" onClick={onTerminal}><TerminalSquare size={14} />Terminal</button>
    </div>
  </section>;
}
