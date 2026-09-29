import test from 'node:test';
import assert from 'node:assert/strict';
import { MutationQueue } from '../src/mutation-queue.js';
import { HostStateCache } from '../src/host-state-cache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('a blocked host does not block another host; same-host operations and shutdown wait', async () => {
  const queue = new MutationQueue();
  const remote = deferred<void>();
  const events: string[] = [];
  const first = queue.run('remote', async () => { events.push('start'); await remote.promise; events.push('created'); });
  const second = queue.run('remote', async () => { events.push('deleted'); throw new Error('expected'); });
  const rejection = assert.rejects(second, /expected/);
  await queue.run('local', async () => { events.push('local'); });
  assert.deepEqual(events, ['start', 'local']);
  let idle = false;
  const drained = queue.idle().then(() => { idle = true; });
  await Promise.resolve();
  assert.equal(idle, false);
  remote.resolve();
  await Promise.all([first, rejection, drained]);
  assert.deepEqual(events, ['start', 'local', 'created', 'deleted']);
  await queue.run('remote', async () => { events.push('recovered'); });
  assert.equal(events.at(-1), 'recovered');
});

test('list probes are bounded and deduplicated while actions await a current result', async () => {
  const cache = new HostStateCache<string>(1000, 10);
  const remote = deferred<string>();
  let calls = 0;
  const probe = () => { calls++; return remote.promise; };
  assert.deepEqual(await Promise.all([cache.get('slow', probe, true), cache.get('slow', probe, true)]), [undefined, undefined]);
  assert.equal(calls, 1);
  assert.equal(await cache.get('fast', async () => 'fast', true), 'fast');
  const fresh = cache.get('slow', probe);
  remote.resolve('running');
  assert.equal(await fresh, 'running');
  assert.equal(calls, 1);
  assert.equal(await cache.get('slow', async () => { throw Error(); }, true), 'running');
  assert.equal(await cache.get('slow', async () => { throw Error(); }), undefined);
  assert.equal(await cache.get('slow', probe, true), undefined);
});

test('a probe started before mutation cannot overwrite the new state', async () => {
  const cache = new HostStateCache<string>();
  const old = deferred<string>();
  const pending = cache.get('host', () => old.promise);
  cache.invalidate('host');
  assert.equal(await cache.get('host', async () => 'new'), 'new');
  old.resolve('old');
  await pending;
  assert.equal(await cache.get('host', async () => 'unexpected', true), 'new');
});
