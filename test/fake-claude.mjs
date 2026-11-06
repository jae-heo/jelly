// Stands in for Claude Code in tests: writes the per-process record and
// transcript files Claude keeps under CLAUDE_CONFIG_DIR, then answers each input
// prompt. "/clear" starts another conversation, as Claude does.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

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

// Draws a prompt like Claude Code's: a dim placeholder between two rules, the
// draft wrapped with two-column continuation rows, and a dim footer.
const width = text => Array.from(text).reduce((sum, char) => sum + (/[ᄀ-ᇿ㄰-㆏가-퟿]/u.test(char) ? 2 : 1), 0);
let draft = '';
function draw() {
  const columns = process.stdout.columns || 80;
  const rows = [];
  for (const paragraph of draft.split('\n')) {
    let row = '';
    for (const char of paragraph) {
      if (width(row + char) > columns - 2) { rows.push(row); row = ''; }
      row += char;
    }
    rows.push(row);
  }
  const box = draft ? rows.map((row, index) => (index ? '  ' : '❯ ') + row) : ['❯ \x1b[2mTry "fix the tests"\x1b[0m'];
  const rule = '─'.repeat(columns);
  process.stdout.write(`\x1b[H\x1b[2JFAKE_CLAUDE_READY ${process.pid}\x1b[${(process.stdout.rows || 24) - box.length - 2}H`
    + [rule, ...box, rule, '\x1b[2m  ? for shortcuts\x1b[0m'].join('\r\n'));
}
function submit(text) {
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
}
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
  for (const char of data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')) {
    if (char === '\x03') process.exit(0);
    if (char === '\r') { const text = draft.trim(); draft = ''; submit(text); }
    else if (char === '\n') draft += '\n';
    else if (char === '\x15') draft = '';
    else if (char === '\x7f') draft = Array.from(draft).slice(0, -1).join('');
    else if (char >= ' ') draft += char;
  }
  draw();
});
process.stdout.on('resize', draw);
draw();
