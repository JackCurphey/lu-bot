import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations/index.js';

// The applied version is SQLite's own user_version pragma: one integer in the
// file header, no bookkeeping table to keep in step.
export function schemaVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function migrate(db, migrations) {
  const current = schemaVersion(db);
  const newest = migrations.at(-1)?.version ?? 0;
  if (current > newest) {
    // Code rolled back behind its data. Running on would mean reading tables
    // this code does not understand.
    throw new Error(`Database schema version ${current} is newer than this code knows (${newest}).`);
  }
  for (const m of migrations) {
    if (m.version <= current) continue;
    // One transaction per migration: a failure leaves the file exactly as it
    // was before that migration, and the next start retries it.
    db.exec('BEGIN');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${Number(m.version)}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${m.version} (${m.name}) failed: ${err.message}`);
    }
  }
}

export function openDatabase({ file, migrations = MIGRATIONS }) {
  const db = new DatabaseSync(file);
  // WAL lets a second reader -- the web settings page, later -- read while Lu
  // writes. busy_timeout makes a brief lock a wait, not an error.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  try {
    migrate(db, migrations);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

// Exposed for the test that an already-open, too-new database is refused.
openDatabase.migrate = migrate;
