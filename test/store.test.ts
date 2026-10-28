import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.js';

test('existing projects and session references survive migration to per-server paths', async () => {
  const root = resolve('.data'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'schema-test-'));
  try {
    const old = new DatabaseSync(join(directory, 'jelly.sqlite'));
    old.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL) STRICT;
      CREATE TABLE sessions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, createdAt TEXT NOT NULL, stoppedAt TEXT) STRICT;
      INSERT INTO projects VALUES ('original', 'Existing', '/work', '2026-01-01');
      INSERT INTO sessions VALUES ('session', 'original', 'Running work', '2026-01-01', NULL);`);
    old.close();
    const store = new Store(directory);
    try {
      assert.equal(store.project('original')?.hostId, null);
      assert.equal(store.session('session')?.projectId, 'original');
      assert.equal(store.session('session')?.stoppedAt, null);
      assert.ok((await readdir(directory)).some(name => name.startsWith('before-ssh-')));
      const host = store.addHost({ name: 'Remote', target: 'alias', port: null, identityFile: null });
      const remote = store.addProject('Remote', '/work', host.id);
      assert.equal(store.projectByPath('/work')?.id, 'original');
      assert.equal(store.projectByPath('/work', host.id)?.id, remote.id);
      assert.throws(() => store.addProject('Duplicate', '/work', host.id));
      assert.throws(() => store.deleteHost(host.id));
      assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { store.close(); }
    const reopened = new Store(directory); reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('manual order preserves old metadata, persists, appends new items and rejects cross-project moves', async () => {
  const directory = await mkdtemp(join(resolve('.data'), 'order-test-'));
  let store = new Store(directory);
  try {
    const a = store.addProject('A', '/a'), b = store.addProject('B', '/b'), c = store.addProject('C', '/c');
    const one = store.addSession(a.id, 'One'), two = store.addSession(a.id, 'Two'), other = store.addSession(b.id, 'Other');
    [a, b, c].forEach((p, i) => store.db.prepare('UPDATE projects SET createdAt = ? WHERE id = ?').run(`2026-01-0${i + 1}`, p.id));
    const names = [a, b, c].map(p => store.project(p.id));
    assert.deepEqual(store.move('project', c.id, a.id), [c.id, a.id, b.id]);
    assert.deepEqual(store.move('session', two.id, one.id), [two.id, one.id]);
    assert.deepEqual([a, b, c].map(p => store.project(p.id)), names);
    assert.deepEqual({ ...store.session(one.id) }, one);
    assert.throws(() => store.move('session', one.id, other.id), /same list/);
    assert.deepEqual(store.sessions(a.id).map(s => s.id), [two.id, one.id]);
    store.close(); store = new Store(directory);
    assert.deepEqual(store.projects().map(p => p.id), [c.id, a.id, b.id]);
    assert.deepEqual(store.sessions(a.id).map(s => s.id), [two.id, one.id]);
    const last = store.addSession(a.id, 'Last');
    const d = store.addProject('D', '/d');
    assert.deepEqual(store.projects().map(p => p.id), [c.id, a.id, b.id, d.id]);
    assert.deepEqual(store.sessions(a.id).map(s => s.id), [two.id, one.id, last.id]);
    assert.deepEqual(store.move('session', two.id, null), [one.id, last.id, two.id]);
    store.deleteSession(two.id);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM session_order WHERE id = ?').get(two.id)!.n, 0);
    store.deleteProject(c.id);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM project_order WHERE id = ?').get(c.id)!.n, 0);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
