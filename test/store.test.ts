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
