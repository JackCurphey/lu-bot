import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, schemaVersion } from '../src/db/index.js';
import { MIGRATIONS } from '../src/db/migrations/index.js';

test('a fresh database is migrated to the newest version', () => {
  const db = openDatabase({ file: ':memory:' });
  assert.equal(schemaVersion(db), MIGRATIONS.at(-1).version);
  const cols = db.prepare("SELECT name FROM pragma_table_info('settings')").all().map((r) => r.name);
  assert.deepEqual(cols, ['guild_id', 'feature', 'key', 'value']);
  db.close();
});

test('migrations are numbered 1, 2, 3... with no gaps', () => {
  MIGRATIONS.forEach((m, i) => assert.equal(m.version, i + 1, m.name));
});

test('reopening an up-to-date database runs nothing again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lu-db-'));
  try {
    const file = join(dir, 'lu.db');
    let runs = 0;
    const counted = [{ version: 1, name: 'count', up(db) { runs += 1; db.exec('CREATE TABLE t (x)'); } }];
    openDatabase({ file, migrations: counted }).close();
    openDatabase({ file, migrations: counted }).close();
    assert.equal(runs, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failing migration leaves no half-applied change and does not advance the version', () => {
  const broken = [
    { version: 1, name: 'ok', up(db) { db.exec('CREATE TABLE a (x)'); } },
    { version: 2, name: 'bad', up(db) { db.exec('CREATE TABLE b (x)'); throw new Error('boom'); } },
  ];
  assert.throws(() => openDatabase({ file: ':memory:', migrations: broken }), /migration 2 \(bad\) failed: boom/);
});

test('migration 2 is rolled back as a whole', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lu-db-'));
  try {
    const file = join(dir, 'lu.db');
    const broken = [
      { version: 1, name: 'ok', up(db) { db.exec('CREATE TABLE a (x)'); } },
      { version: 2, name: 'bad', up(db) { db.exec('CREATE TABLE b (x)'); throw new Error('boom'); } },
    ];
    assert.throws(() => openDatabase({ file, migrations: broken }));
    const db = openDatabase({ file, migrations: broken.slice(0, 1) });
    assert.equal(schemaVersion(db), 1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='b'").all();
    assert.equal(tables.length, 0);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a database newer than this code is refused, not silently used', () => {
  const db = openDatabase({ file: ':memory:', migrations: [] });
  db.exec('PRAGMA user_version = 99');
  assert.throws(() => openDatabase.migrate(db, MIGRATIONS), /schema version 99 is newer/);
  db.close();
});
