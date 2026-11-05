import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ChatAgent, type ChatItem, type ChatResponse } from './api';

const merge = (current: ChatItem[], updates: ChatItem[]) => {
  const byIndex = new Map(current.map(item => [item.index, item]));
  for (const item of updates) byIndex.set(item.index, item);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
};

// Checks for an agent occasionally; while the chat is open, polls for new and
// updated transcript items. The server parses the transcript incrementally.
export function useAgentChat(token: string, sessionId: string | null, open: boolean) {
  const [agent, setAgent] = useState<ChatAgent | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [start, setStart] = useState(0);
  const cursor = useRef<{ conversation: string; revision: number } | null>(null);
  useEffect(() => { setAgent(null); setItems([]); setStart(0); cursor.current = null; }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const previous = cursor.current;
        const query = !open ? '?probe=true' : previous ? `?revision=${previous.revision}` : '';
        const data = await api<ChatResponse>(token, `/sessions/${sessionId}/chat${query}`, 'GET', undefined, controller.signal);
        if (controller.signal.aborted) return;
        setAgent(data.agent);
        if (!data.agent) cursor.current = null;
        else if (open && data.items && data.revision !== undefined) {
          // /clear and /resume start another conversation with its own indexes.
          if (data.reset || previous?.conversation !== data.agent.conversation) { setItems(data.items); setStart(data.start ?? 0); }
          else if (data.items.length) setItems(current => merge(current, data.items!));
          cursor.current = { conversation: data.agent.conversation, revision: data.revision };
        }
      } catch { /* Keep the last view; try again on the next tick. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => void tick(), open ? 1500 : 10_000);
    };
    void tick();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, sessionId, open]);
  const loadEarlier = useCallback(async () => {
    const conversation = cursor.current?.conversation;
    if (!sessionId || !conversation || start === 0) return;
    const data = await api<ChatResponse>(token, `/sessions/${sessionId}/chat?before=${start}`);
    if (cursor.current?.conversation !== conversation || data.agent?.conversation !== conversation || !data.items) return;
    setItems(current => merge(current, data.items!));
    setStart(data.start ?? 0);
  }, [token, sessionId, start]);
  return { agent, items, start, loadEarlier };
}
