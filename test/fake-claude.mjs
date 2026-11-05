// Stands in for Claude Code in tests: writes the per-process record and
// transcript files Claude keeps under CLAUDE_CONFIG_DIR, then answers each input
// line. "/clear" starts another conversation, as Claude does.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const config = process.env.CLAUDE_CONFIG_DIR;
if (!config) throw new Error('CLAUDE_CONFIG_DIR is required');
const cwd = process.cwd();
const procStart = readFileSync('/proc/self/stat', 'utf8').replace(/^.*\) /s, '').split(' ')[19];
let sessionId = randomUUID();
let transcript;
const record = status => writeFileSync(join(config, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId, cwd, procStart, status, kind: 'interactive' }));
const line = entry => appendFileSync(transcript, JSON.stringify({ uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId, isSidechain: false, ...entry }) + '\n');
function start(intro) {
  transcript = join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  mkdirSync(join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-')), { recursive: true });
  line({ type: 'mode', mode: 'normal' });
  line({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>hidden</local-command-caveat>' } });
  for (const [type, content] of intro) line({ type, message: { role: type, content } });
}
mkdirSync(join(config, 'sessions'), { recursive: true });
start([
  ['user', '<command-name>/model</command-name>\n<command-args>opus</command-args>'],
  ['user', 'FIRST_QUESTION<system-reminder>hidden reminder</system-reminder>'],
  ['assistant', [{ type: 'thinking', thinking: 'hidden thought' }, { type: 'text', text: '## Plan\nRun **ls** and `pwd`.\n```sh\nls -la\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- first item\n- second item\n  - nested item\n1. one\n2. two\n\nSee [docs](https://example.com/docs) and [bad](javascript:alert(1)).' }]],
  ['assistant', [{ type: 'tool_use', id: 'toolu_fake_1', name: 'Bash', input: { command: 'ls -la\necho second line', description: 'List files' } }]],
  ['user', [{ type: 'tool_result', tool_use_id: 'toolu_fake_1', content: 'TOOL_OUTPUT_OK', is_error: false }]],
  ['assistant', [{ type: 'tool_use', id: 'toolu_fake_2', name: 'Edit', input: { file_path: '/work/app.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' } }]],
  ['user', [{ type: 'tool_result', tool_use_id: 'toolu_fake_2', content: 'Updated', is_error: false }]],
  ['assistant', [{ type: 'tool_use', id: 'toolu_fake_3', name: 'Bash', input: { command: 'false' } }]],
  ['user', [{ type: 'tool_result', tool_use_id: 'toolu_fake_3', content: 'Exit code 1', is_error: true }]],
  ['assistant', [{ type: 'text', text: '<b>not html</b> FIRST_ANSWER' }]],
]);
record('idle');
console.log(`FAKE_CLAUDE_READY ${process.pid}`);
createInterface({ input: process.stdin }).on('line', input => {
  const text = input.trim();
  if (!text) return;
  if (text === '/clear') {
    sessionId = randomUUID();
    start([['assistant', [{ type: 'text', text: 'CLEARED_CONVERSATION' }]]]);
    record('idle');
    return;
  }
  record('busy');
  line({ type: 'user', message: { role: 'user', content: text } });
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${Date.now()}`, name: 'Read', input: { file_path: '/tmp/x' } }] } });
  setTimeout(() => {
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Echo: ${text}` }] } });
    record('idle');
  }, 2500);
});
