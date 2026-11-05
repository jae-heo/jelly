import { open, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// A read-only chat view of Claude Code running in a local Jelly session. Claude
// records each interactive process in <config>/sessions/<pid>.json and the
// conversation in <config>/projects/<cwd>/<sessionId>.jsonl. Jelly only reads
// these files; input still goes through the terminal.

export type ChatItem =
  | { kind: 'user' | 'assistant' | 'note'; id: string; text: string; time?: string }
  | { kind: 'tool'; id: string; name: string; summary: string; input: string; diff?: { old: string; new: string }[]; output?: string; error?: boolean; time?: string };
export interface ChatAgent { kind: 'claude'; status: string; conversation: string; transcript: string }
export interface ClaudeProcess { pid: number; config: string; procStart?: string }

const textLimit = 20_000;
const detailLimit = 4_000;
const pageSize = 150;
const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}\n…` : value;

/** Finds Claude Code among the descendants of a tmux pane's shell. */
export async function findClaude(panePid: number, proc = '/proc'): Promise<ClaudeProcess | undefined> {
  const children = new Map<number, number[]>();
  let entries: string[];
  try { entries = await readdir(proc); } catch { return undefined; }
  await Promise.all(entries.filter(name => /^\d+$/.test(name)).map(async name => {
    try {
      const fields = (await readFile(join(proc, name, 'stat'), 'utf8')).replace(/^.*\) /s, '').split(' ');
      const parent = Number(fields[1]);
      children.set(parent, [...children.get(parent) ?? [], Number(name)]);
    } catch { /* The process exited. */ }
  }));
  const queue = [...children.get(panePid) ?? []];
  for (let checked = 0; queue.length && checked < 200; checked++) {
    const pid = queue.shift()!;
    queue.push(...children.get(pid) ?? []);
    try {
      const env = new Map((await readFile(join(proc, String(pid), 'environ'), 'utf8')).split('\0').map(entry => {
        const at = entry.indexOf('=');
        return [entry.slice(0, at), entry.slice(at + 1)] as const;
      }));
      const config = env.get('CLAUDE_CONFIG_DIR') || join(env.get('HOME') || homedir(), '.claude');
      const record = await claudeRecord({ pid, config });
      // A record left behind by an exited process must not match a reused PID.
      const procStart = (await readFile(join(proc, String(pid), 'stat'), 'utf8')).replace(/^.*\) /s, '').split(' ')[19];
      if (record && (!record.procStart || record.procStart === procStart)) return { pid, config, ...(record.procStart ? { procStart } : {}) };
    } catch { /* Not Claude Code, or not readable. */ }
  }
  return undefined;
}

async function claudeRecord({ pid, config }: ClaudeProcess) {
  const record = JSON.parse(await readFile(join(config, 'sessions', `${pid}.json`), 'utf8')) as { pid?: number; sessionId?: string; cwd?: string; status?: string; procStart?: string };
  return record.pid === pid && record.sessionId && /^[a-zA-Z0-9-]+$/.test(record.sessionId) ? record as typeof record & { sessionId: string } : undefined;
}

/** Claude rewrites its record when its status or conversation changes; read it each time. */
export async function claudeState(process: ClaudeProcess): Promise<ChatAgent | undefined> {
  try {
    const record = await claudeRecord(process);
    if (!record || record.procStart !== process.procStart) return undefined;
    const transcript = await transcriptPath(process.config, record.sessionId, record.cwd);
    return transcript ? { kind: 'claude', status: record.status ?? 'unknown', conversation: record.sessionId, transcript } : undefined;
  } catch { return undefined; }
}

async function transcriptPath(config: string, sessionId: string, cwd?: string): Promise<string | undefined> {
  const projects = join(config, 'projects');
  const file = `${sessionId}.jsonl`;
  const exists = async (path: string) => { try { return (await stat(path)).isFile(); } catch { return false; } };
  if (cwd) {
    const direct = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'), file);
    if (await exists(direct)) return direct;
  }
  // Long or unusual folder names are shortened differently; search instead.
  try {
    for (const dir of await readdir(projects)) if (await exists(join(projects, dir, file))) return join(projects, dir, file);
  } catch { /* No projects directory yet. */ }
  return undefined;
}

type Block = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
interface Entry { type?: string; subtype?: string; uuid?: string; timestamp?: string; isMeta?: boolean; isSidechain?: boolean; isCompactSummary?: boolean; message?: { content?: string | Block[] } }

const toolText = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(block => (block as Block).type === 'text' ? (block as Block).text ?? '' : (block as Block).type === 'image' ? '[Image]' : '').filter(Boolean).join('\n') : '';
const tag = (text: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim();

function toolSummary(name: string, input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;
  const question = Array.isArray(value.questions) ? (value.questions[0] as { question?: unknown } | undefined)?.question : undefined;
  if (typeof question === 'string') return clip(question.split('\n')[0]!, 200);
  // A Bash description reads better than the command; the command is in the details.
  for (const key of [name === 'Bash' ? 'description' : '', 'command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'].filter(Boolean)) {
    if (typeof value[key] === 'string' && value[key]) return clip(String(value[key]).split('\n')[0]!, 200);
  }
  return name;
}

const toolInput = (name: string, input: unknown) => {
  const value = (input ?? {}) as { command?: unknown; content?: unknown };
  if (name === 'Bash' && typeof value.command === 'string') return value.command;
  if (name === 'Write' && typeof value.content === 'string') return value.content;
  return JSON.stringify(input ?? {}, null, 2);
};
// Edits are shown as removed and added lines.
function toolDiff(name: string, input: unknown) {
  const value = (input ?? {}) as { old_string?: unknown; new_string?: unknown; edits?: unknown };
  const edits = name === 'Edit' ? [value] : name === 'MultiEdit' && Array.isArray(value.edits) ? value.edits as typeof value[] : [];
  const diff = edits.filter(edit => typeof edit.old_string === 'string' && typeof edit.new_string === 'string')
    .slice(0, 20).map(edit => ({ old: clip(edit.old_string as string, detailLimit), new: clip(edit.new_string as string, detailLimit) }));
  return diff.length ? { diff } : {};
}

/** Turns one transcript line into chat items. Tool results update earlier items. */
function parse(entry: Entry, emit: (item: ChatItem) => void, result: (toolId: string, output: string, error: boolean) => void) {
  if (entry.isSidechain || entry.isMeta) return;
  const id = entry.uuid ?? '';
  const time = entry.timestamp;
  if (entry.type === 'system') {
    if (entry.subtype === 'compact_boundary') emit({ kind: 'note', id, text: 'Conversation compacted', time });
    return;
  }
  if (entry.isCompactSummary || (entry.type !== 'user' && entry.type !== 'assistant')) return;
  const content = entry.message?.content;
  if (typeof content === 'string') {
    if (entry.type === 'assistant') { if (content.trim()) emit({ kind: 'assistant', id, text: clip(content, textLimit), time }); return; }
    const command = tag(content, 'command-name');
    if (command) { emit({ kind: 'note', id, text: [command, tag(content, 'command-args')].filter(Boolean).join(' '), time }); return; }
    const output = tag(content, 'local-command-stdout') ?? tag(content, 'bash-stdout');
    if (output !== undefined) { if (output) emit({ kind: 'note', id, text: clip(output.replace(/\x1b\[[0-9;]*m/g, ''), 500), time }); return; }
    const bash = tag(content, 'bash-input');
    if (bash) { emit({ kind: 'note', id, text: `! ${bash}`, time }); return; }
    if (content.includes('<task-notification>')) { emit({ kind: 'note', id, text: clip(tag(content, 'summary') ?? 'Background task finished', 300), time }); return; }
    const text = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<\/?pasted_content[^>]*>/g, '').trim();
    if (text) emit({ kind: 'user', id, text: clip(text, textLimit), time });
    return;
  }
  if (!Array.isArray(content)) return;
  content.forEach((block, index) => {
    const blockId = `${id}:${index}`;
    if (block.type === 'tool_result' && block.tool_use_id) result(block.tool_use_id, clip(toolText(block.content), detailLimit), !!block.is_error);
    else if (block.type === 'tool_use' && block.id) {
      emit({ kind: 'tool', id: block.id, name: block.name ?? 'Tool', summary: toolSummary(block.name ?? '', block.input), input: clip(toolInput(block.name ?? '', block.input), detailLimit), ...toolDiff(block.name ?? '', block.input), time });
    } else if (block.type === 'text' && block.text?.trim()) {
      const interrupted = /^\[Request interrupted by user/.test(block.text);
      emit({ kind: entry.type === 'assistant' ? 'assistant' : interrupted ? 'note' : 'user', id: blockId, text: clip(interrupted ? 'Interrupted' : block.text, textLimit), time });
    } else if (block.type === 'image' && entry.type === 'user') emit({ kind: 'user', id: blockId, text: '[Image]', time });
  });
}

interface Transcript { offset: number; items: ChatItem[]; revisions: number[]; revision: number; resetAt: number; tools: Map<string, number>; used: number; reading?: Promise<void> }

/** Incrementally parsed transcripts, shared by every viewer of a session. */
export class AgentChats {
  private transcripts = new Map<string, Transcript>();

  async read(path: string, query: { revision?: number; before?: number }) {
    const transcript = await this.update(path);
    const { items, revisions } = transcript;
    const page = (from: number, to: number) => items.slice(from, to).map((item, offset) => ({ ...item, index: from + offset }));
    if (query.before !== undefined) {
      const end = Math.max(0, Math.min(query.before, items.length));
      return { revision: transcript.revision, start: Math.max(0, end - pageSize), items: page(Math.max(0, end - pageSize), end) };
    }
    if (query.revision !== undefined && query.revision >= transcript.resetAt && query.revision <= transcript.revision) {
      const changed: number[] = [];
      revisions.forEach((value, index) => { if (value > query.revision!) changed.push(index); });
      if (changed.length <= pageSize) return { revision: transcript.revision, items: changed.map(index => ({ ...items[index]!, index })) };
    }
    // First load, or too far behind: start again from the latest page.
    const start = Math.max(0, items.length - pageSize);
    return { revision: transcript.revision, start, reset: true, items: page(start, items.length) };
  }

  private async update(path: string): Promise<Transcript> {
    const now = Date.now();
    for (const [key, value] of this.transcripts) if (now - value.used > 10 * 60_000) this.transcripts.delete(key);
    let transcript = this.transcripts.get(path);
    if (!transcript) {
      // Start from the clock so a viewer's revision from before a restart resets.
      transcript = { offset: 0, items: [], revisions: [], revision: now, resetAt: now, tools: new Map(), used: now };
      this.transcripts.set(path, transcript);
    }
    transcript.used = now;
    // Concurrent viewers share one read of the new bytes.
    while (transcript.reading) await transcript.reading;
    transcript.reading = this.append(transcript, path).finally(() => { transcript.reading = undefined; });
    await transcript.reading;
    return transcript;
  }

  private async append(transcript: Transcript, path: string) {
    const file = await open(path, 'r');
    try {
      const { size } = await file.stat();
      // A rewritten file invalidates every index a viewer holds.
      if (size < transcript.offset) Object.assign(transcript, { offset: 0, items: [], revisions: [], tools: new Map(), revision: transcript.revision + 1, resetAt: transcript.revision + 1 });
      while (transcript.offset < size) {
        const length = Math.min(size - transcript.offset, 8 * 1024 * 1024);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, transcript.offset);
        // Parse complete lines only; Claude may be writing the last one.
        let end = buffer.subarray(0, bytesRead).lastIndexOf(0x0a) + 1;
        if (end === 0) {
          if (bytesRead < 8 * 1024 * 1024) break;
          end = bytesRead; // A single oversized line: skip it.
        } else this.lines(transcript, buffer.subarray(0, end).toString('utf8'));
        transcript.offset += end;
      }
    } finally { await file.close(); }
  }

  private lines(transcript: Transcript, text: string) {
    const revision = transcript.revision + 1;
    let changed = false;
    const emit = (item: ChatItem) => {
      transcript.items.push(item); transcript.revisions.push(revision); changed = true;
      if (item.kind === 'tool') transcript.tools.set(item.id, transcript.items.length - 1);
    };
    const result = (toolId: string, output: string, error: boolean) => {
      const index = transcript.tools.get(toolId);
      if (index === undefined) return;
      transcript.items[index] = { ...transcript.items[index] as Extract<ChatItem, { kind: 'tool' }>, output, ...(error ? { error } : {}) };
      transcript.revisions[index] = revision; changed = true;
    };
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { parse(JSON.parse(line) as Entry, emit, result); } catch { /* Not a transcript entry. */ }
    }
    if (changed) transcript.revision = revision;
  }
}
