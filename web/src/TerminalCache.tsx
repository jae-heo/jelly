import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { TerminalView, type Connection, type TerminalHandle } from './TerminalView';

interface Props {
  token: string; sessionId: string; runningIds: string[]; enabled: boolean; revision: number; fontSize: number;
  onConnection: (state: Connection) => void; onUnauthorized: () => void;
}
interface Entry { id: string; revision: number }
const CAPACITY = 3;

// Keep only the most recently visited terminals in this project, in memory.
export const TerminalCache = forwardRef<TerminalHandle, Props>(function TerminalCache(props, ref) {
  const activeId = props.enabled && props.runningIds.includes(props.sessionId) ? props.sessionId : null;
  const [cache, setCache] = useState<{ entries: Entry[]; revision: number }>({ entries: [], revision: props.revision });
  const handles = useRef(new Map<string, TerminalHandle>());
  const connections = useRef(new Map<string, { revision: number; state: Connection }>());
  const current = useRef(props);
  current.current = props;

  let entries = cache.entries.filter(entry => props.runningIds.includes(entry.id) && (props.enabled || entry.id !== props.sessionId));
  if (activeId) {
    const previous = entries.find(entry => entry.id === activeId);
    const entry = { id: activeId, revision: previous?.revision ?? props.revision };
    if (cache.revision !== props.revision) entry.revision = props.revision;
    entries = [entry, ...entries.filter(entry => entry.id !== activeId)].slice(0, CAPACITY);
  }
  // Derive the next LRU during render so switching never paints a blank intermediate terminal.
  if (cache.revision !== props.revision || entries.length !== cache.entries.length || entries.some((entry, i) => entry.id !== cache.entries[i]?.id || entry.revision !== cache.entries[i]?.revision)) {
    setCache({ entries, revision: props.revision });
  }

  useImperativeHandle(ref, () => ({
    send: data => { if (activeId) handles.current.get(activeId)?.send(data); },
    pressKey: key => { if (activeId) handles.current.get(activeId)?.pressKey(key); },
    paste: data => { if (activeId) handles.current.get(activeId)?.paste(data); },
    focus: () => { if (activeId) handles.current.get(activeId)?.focus(); },
  }), [activeId]);

  useLayoutEffect(() => {
    for (const id of connections.current.keys()) {
      if (!cache.entries.some(entry => entry.id === id)) connections.current.delete(id);
    }
    if (!props.enabled) current.current.onConnection('disconnected');
    else if (activeId) {
      const saved = connections.current.get(activeId);
      const entry = cache.entries.find(entry => entry.id === activeId);
      current.current.onConnection(saved && saved.revision === entry?.revision ? saved.state : 'connecting');
    }
  }, [activeId, props.enabled, cache]);

  return <div className="terminal-cache" hidden={!props.runningIds.includes(props.sessionId)}>
    {entries.map(entry => <div key={entry.id} className="terminal-slot" hidden={entry.id !== activeId} data-session-id={entry.id}>
      <TerminalView ref={handle => { if (handle) handles.current.set(entry.id, handle); else handles.current.delete(entry.id); }}
        token={props.token} sessionId={entry.id} active={entry.id === activeId} revision={entry.revision} fontSize={props.fontSize}
        onConnection={state => {
          connections.current.set(entry.id, { revision: entry.revision, state });
          if (current.current.enabled && current.current.sessionId === entry.id) current.current.onConnection(state);
        }} onUnauthorized={props.onUnauthorized} />
    </div>)}
  </div>;
});
