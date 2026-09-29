import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { Tmux } from '../src/tmux.js';

test('an empty tmux server reports lost sessions and accepts repeated stop', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'jelly-empty-'));
  process.env.JELLY_DATA_DIR = dataDir;
  process.env.JELLY_HOST = '127.0.0.1'; process.env.JELLY_PORT = '0';
  const tmux = new Tmux(loadConfig());
  t.after(async () => { await tmux.run('kill-server').catch(() => {}); await rm(dataDir, { recursive: true, force: true }); });
  const id = randomUUID();
  await tmux.create(id, dataDir, 80, 24);
  // Keep the empty server alive to deterministically exercise the interval
  // between the last session disappearing and the server exiting.
  await tmux.run('set-option', '-s', 'exit-empty', 'off');
  await tmux.stop(id);
  await tmux.stop(id);
  assert.equal((await tmux.states()).size, 0);
});
