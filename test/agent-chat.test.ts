import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, stat as fileStat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentChats, claudeState, findClaude } from '../src/agent-chat.js';

const entry = (type: string, content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type, uuid: `u-${Math.random()}`, timestamp: '2026-11-04T00:00:00.000Z', message: { role: type, content }, ...extra }) + '\n';
const stat = (ppid: number, start: string) => `1 (fake (comm) x) S ${ppid} ${'0 '.repeat(17)}${start} 0\n`;

test('finds Claude Code among pane descendants and verifies its process start', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jelly-agent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proc = join(root, 'proc');
  const config = join(root, 'claude');
  const transcript = join(config, 'projects', '-work-my-app', 'conversation-1.jsonl');
  const processes: Record<number, { ppid: number; env: string }> = {
    100: { ppid: 1, env: 'HOME=/nowhere' }, // the pane's shell
    101: { ppid: 100, env: 'HOME=/nowhere' }, // a wrapper such as ccx
    102: { ppid: 101, env: `CLAUDE_CONFIG_DIR=${config}\0HOME=/nowhere` },
    200: { ppid: 1, env: `CLAUDE_CONFIG_DIR=${config}` }, // Claude in another pane
  };
  for (const [pid, value] of Object.entries(processes)) {
    await mkdir(join(proc, pid), { recursive: true });
    await writeFile(join(proc, pid, 'stat'), stat(value.ppid, `${pid}0`));
    await writeFile(join(proc, pid, 'environ'), value.env + '\0');
  }
  await mkdir(join(config, 'sessions'), { recursive: true });
  await mkdir(join(transcript, '..'), { recursive: true });
  await writeFile(transcript, '');
  const record = (pid: number, value: Record<string, unknown>) => writeFile(join(config, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: 'conversation-1', cwd: '/work/my_app', status: 'busy', ...value }));
  await record(102, { procStart: '1020' });
  await record(200, { procStart: '2000' });

  const found = await findClaude(100, proc);
  assert.deepEqual(found, { pid: 102, config, procStart: '1020' });
  assert.deepEqual(await claudeState(found!), { kind: 'claude', status: 'busy', conversation: 'conversation-1', transcript });
  // A plain shell, or a stale record for a reused PID, is not Claude.
  assert.equal(await findClaude(200, proc), undefined);
  await record(102, { procStart: '999' });
  assert.equal(await findClaude(100, proc), undefined);
  assert.equal(await claudeState(found!), undefined);
  // An unusual folder name is found by searching for the conversation file.
  await record(102, { procStart: '1020', cwd: '/elsewhere', sessionId: 'conversation-1', status: 'idle' });
  assert.equal((await claudeState(found!))?.transcript, transcript);
  // Malformed conversation IDs never become paths.
  await record(102, { procStart: '1020', sessionId: '../../etc/passwd' });
  assert.equal(await claudeState(found!), undefined);
});

test('transcripts become chat items incrementally, with tool results attached', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jelly-chat-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'conversation.jsonl');
  await writeFile(path, [
    JSON.stringify({ type: 'mode', mode: 'normal' }) + '\n',
    entry('user', '<local-command-caveat>x</local-command-caveat>', { isMeta: true }),
    entry('user', '<command-name>/model</command-name>\n<command-args>opus</command-args>'),
    entry('user', '<local-command-stdout>\x1b[1mSet model\x1b[22m</local-command-stdout>'),
    entry('user', 'Question<system-reminder>secret</system-reminder>'),
    entry('assistant', [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'Answer' }]),
    entry('assistant', [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls\npwd' } }]),
    entry('assistant', [{ type: 'text', text: 'side' }], { isSidechain: true }),
    // Claude may still be writing the last line.
    entry('user', 'Partial').slice(0, 20),
  ].join(''));
  const chats = new AgentChats();
  const first = await chats.read(path, {});
  assert.equal(first.reset, true);
  assert.deepEqual(first.items.map(item => [item.index, item.kind, 'text' in item ? item.text : item.summary]), [
    [0, 'note', '/model opus'], [1, 'note', 'Set model'], [2, 'user', 'Question'], [3, 'assistant', 'Answer'], [4, 'tool', 'ls'],
  ]);
  assert.deepEqual(first.items[4], { kind: 'tool', id: 'tool-1', name: 'Bash', summary: 'ls', input: 'ls\npwd', time: '2026-11-04T00:00:00.000Z', index: 4 });

  // Finish the partial line, then add a tool result and a task notification.
  await truncate(path, (await fileStat(path)).size - 20);
  await appendFile(path, entry('user', [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'file.txt' }], is_error: true }])
    + entry('user', '<task-notification><summary>Build finished</summary></task-notification>')
    + entry('user', [{ type: 'text', text: '[Request interrupted by user]' }]));
  const next = await chats.read(path, { revision: first.revision });
  assert.equal(next.reset, undefined);
  assert.ok(next.revision > first.revision);
  assert.deepEqual(next.items.map(item => [item.index, item.kind, item.kind === 'tool' ? [item.output, item.error] : item.text]), [
    [4, 'tool', ['file.txt', true]], [5, 'note', 'Build finished'], [6, 'note', 'Interrupted'],
  ]);
  assert.deepEqual((await chats.read(path, { revision: next.revision })).items, []);
  assert.deepEqual((await chats.read(path, { before: 2 })).items.map(item => item.index), [0, 1]);
  // A revision from another server run, or a rewritten file, starts over.
  assert.equal((await chats.read(path, { revision: 1 })).reset, true);
  await writeFile(path, entry('user', 'New'));
  const rewritten = await chats.read(path, { revision: next.revision });
  assert.equal(rewritten.reset, true);
  assert.deepEqual(rewritten.items.map(item => item.kind === 'tool' ? item.name : item.text), ['New']);
});
