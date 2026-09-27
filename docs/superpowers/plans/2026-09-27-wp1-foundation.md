# WP-1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Lu the shared machinery that the moderation, logging, welcome
and role-menu features all stand on. That is a SQLite database with
migrations, per-guild settings, an in-memory message store, a slash-command
registry, and a guild-event dispatcher. None of it changes how Lu behaves
until a feature switch is turned on.

**Architecture:** Every new unit is a plain module with a factory function
(`createX`), tested without Discord. This follows the codebase's existing
pattern: `src/discord.js` converts discord.js objects into plain "views", and
the logic never touches discord.js. `src/discord.js` grows the adapters:
intents chosen from config, interaction views, event forwarding, and command
registration. `src/index.js` wires it all together.

**Tech Stack:** Node ≥26 (`node:sqlite` `DatabaseSync`, `node:test`),
discord.js 14.27.0. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-27-sapphire-replacement-design.md`,
sub-project 1 (read it before starting).

## Global Constraints

- No new npm dependency. SQLite comes from `node:sqlite` (confirmed on the
  mini's Node v26.8.1 and on the development Mac).
- Credits are untouched: `data/credits.json` and the regex commands stay as
  they are (D16, D18).
- The feature switches `MODERATION_ENABLED`, `LOGGING_ENABLED`,
  `WELCOME_ENABLED` and `ROLE_MENUS_ENABLED` **default to off**. With all four
  off, Lu must behave exactly as he does today, apart from creating `data/lu.db`
  and registering `/lu-status`.
- **The privileged `GuildMembers` intent is requested only when a feature that
  needs it is on.** Discord rejects the entire login (close code 4014) if the
  intent is requested and not enabled in the Developer Portal. Requesting it
  unconditionally would take Lu offline, chat included.
- Every handler that the new code adds to the Discord client catches its own
  errors. A failure is logged and never reaches chat (see `startBot`'s existing
  `MessageCreate` handler).
- Rows from `node:sqlite` are null-prototype objects. `assert.deepEqual` in
  `node:assert/strict` compares prototypes, so either spread rows (`{ ...row }`)
  before returning them from a module, or compare field by field.
- Ephemeral replies use `flags: MessageFlags.Ephemeral`. The `ephemeral: true`
  option is deprecated in 14.27.0 (checked in `typings/index.d.ts`).
- Test command: `npm test` (`node --test`). The baseline on 2026-09-27 was
  **564 pass, 0 fail**.
- Commit after every task, on the branch that executes this plan, never
  `main`. Every commit message ends with the attribution line from the session.

## Deltas from the spec (need the owner's nod before execution)

1. **`/lu-status`** is a slash command the spec does not list. It is registered
   whenever Lu starts, and its default permission is Manage Server. It replies
   ephemerally with Lu's version, which feature switches are on, and whether
   the database opened. Without it, WP-1 has nothing a person can exercise
   in the server. The spec's done-condition needs the owner to exercise each
   sub-project live, and this is the only way to prove live that slash
   commands register and route.
2. **Migrations** live in `src/db/migrations/` as numbered modules imported by
   `src/db/migrations/index.js`. The alternative was reading the directory at
   runtime. The spec says migrations come "from `src/db/migrations/`", so this
   meets it without dynamic imports.
3. **The message store records messages in `DISCORD_ALLOWED_GUILDS` only.** It
   does not record the explicitly allowed channels in other guilds (for example
   the thread in `781966929198841886`), because the spec keeps server-wide
   features to the allowed guild. It runs only while moderation or logging
   is on.

## File structure

| File | Responsibility |
|---|---|
| `src/config.js` (modify) | Parse the four feature switches and `DATABASE_FILE`; add a startup warning |
| `src/db/index.js` (create) | Open the database, set pragmas, run migrations |
| `src/db/migrations/index.js` (create) | The ordered list of migrations |
| `src/db/migrations/001-settings.js` (create) | The `settings` table |
| `src/settings.js` (create) | Per-guild, per-feature JSON settings |
| `src/message-store.js` (create) | In-memory recent messages, 24 h / 10,000 cap |
| `src/commands/registry.js` (create) | Command definitions, the permission re-check, routing, error containment |
| `src/commands/status.js` (create) | `/lu-status` |
| `src/guild-events.js` (create) | Dispatch member, ban and message events to feature handlers, scoped to managed guilds |
| `src/discord.js` (modify) | `intentsFor`, `interactionView`, `messageRecordOf`, event forwarding, command registration |
| `src/index.js` (modify) | Wire the database, settings, store, registry and events |
| `.gitignore`, `.env.example`, `README.md`, `CHANGELOG.md` (modify) | Ignore the database files, document the switches, record v1.2 |
| `test/config.test.js`, `test/db.test.js`, `test/settings.test.js`, `test/message-store.test.js`, `test/commands-registry.test.js`, `test/commands-status.test.js`, `test/guild-events.test.js`, `test/discord.test.js` | Tests, written first |

---

### Task 1: Feature switches and intents

**Files:**
- Modify: `src/config.js` (the `loadConfig` return object; `startupWarnings`)
- Modify: `src/discord.js` (the import line, a new exported `intentsFor`, and
  `startBot`'s `intents` array)
- Test: `test/config.test.js`, `test/discord.test.js`

**Interfaces:**
- Produces:
  - `config.features = { moderation, logging, welcome, roleMenus }` (booleans)
  - `config.database = { file }` (a string, relative to the project root)
  - `intentsFor(config) → number[]` (`GatewayIntentBits` values)

- [ ] **Step 1: Write the failing tests.** Append to `test/config.test.js`:

```js
// --- Server features (WP-1) ---
// Each server-wide feature ships switched off: with no test bot (D5), the
// first live run is in Cry's Cantina, so nothing turns on by accident.

test('server feature switches default to off', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg.features, { moderation: false, logging: false, welcome: false, roleMenus: false });
});

test('server feature switches turn on only with the exact word true', () => {
  const cfg = loadConfig({
    ...valid, MODERATION_ENABLED: 'true', LOGGING_ENABLED: 'yes', WELCOME_ENABLED: 'TRUE', ROLE_MENUS_ENABLED: 'true',
  });
  assert.deepEqual(cfg.features, { moderation: true, logging: false, welcome: false, roleMenus: true });
});

test('the database file defaults to data/lu.db and can be moved', () => {
  assert.equal(loadConfig(valid).database.file, 'data/lu.db');
  assert.equal(loadConfig({ ...valid, DATABASE_FILE: ' data/other.db ' }).database.file, 'data/other.db');
});

test('warns when a server feature is on but no server is allowed', () => {
  const warnings = startupWarnings({
    discord: { allowedChannels: ['123'], allowedGuilds: [] },
    features: { moderation: true },
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /DISCORD_ALLOWED_GUILDS/);
});

test('no server-feature warning when the features are off or a server is allowed', () => {
  assert.deepEqual(startupWarnings({ discord: { allowedChannels: ['123'] }, features: { moderation: false } }), []);
  assert.deepEqual(startupWarnings({
    discord: { allowedChannels: [], allowedGuilds: ['g1'] }, features: { logging: true },
  }), []);
});
```

Append to `test/discord.test.js`, and add `intentsFor` to its import from
`../src/discord.js`. Put the new `import` line with the file's other imports
at the top:

```js
import { GatewayIntentBits } from 'discord.js';

// --- Intents (WP-1) ---
// Discord refuses the whole login (close code 4014) when a privileged intent
// is asked for but not enabled in the Developer Portal. So Server Members is
// asked for only when a feature that needs it is switched on.

const off = { moderation: false, logging: false, welcome: false, roleMenus: false };

test('with every server feature off, only the three chat intents are asked for', () => {
  assert.deepEqual(intentsFor({ features: off }).sort((a, b) => a - b), [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
  ].sort((a, b) => a - b));
});

test('moderation, logging and welcome each need Server Members', () => {
  for (const key of ['moderation', 'logging', 'welcome']) {
    assert.ok(intentsFor({ features: { ...off, [key]: true } }).includes(GatewayIntentBits.GuildMembers), key);
  }
});

test('role menus alone do not ask for the privileged intent', () => {
  assert.ok(!intentsFor({ features: { ...off, roleMenus: true } }).includes(GatewayIntentBits.GuildMembers));
});

test('moderation and logging need the moderation intent; welcome does not', () => {
  assert.ok(intentsFor({ features: { ...off, moderation: true } }).includes(GatewayIntentBits.GuildModeration));
  assert.ok(intentsFor({ features: { ...off, logging: true } }).includes(GatewayIntentBits.GuildModeration));
  assert.ok(!intentsFor({ features: { ...off, welcome: true } }).includes(GatewayIntentBits.GuildModeration));
});

test('a config with no features block asks for the chat intents only', () => {
  assert.equal(intentsFor({}).length, 3);
});
```

- [ ] **Step 2: Run the tests and see them fail.**
  Run: `node --test test/config.test.js test/discord.test.js`
  Expected: FAIL. `cfg.features` is undefined, and `intentsFor` is not
  exported (a SyntaxError on the import).

- [ ] **Step 3: Implement.** In `src/config.js`, add these before
  `return {` in `loadConfig`:

```js
  // Server-wide features (WP-1 onwards). Off unless the value is exactly
  // "true": with no separate test bot (D5) their first run is live, so a typo
  // must leave them off rather than on.
  const on = (key) => env[key] === 'true';
  const features = {
    moderation: on('MODERATION_ENABLED'),
    logging: on('LOGGING_ENABLED'),
    welcome: on('WELCOME_ENABLED'),
    roleMenus: on('ROLE_MENUS_ENABLED'),
  };
```

Then add these to the returned object, after `suggestions`:

```js
    features,
    database: {
      // Relative to the project root, resolved in src/index.js like the
      // credit ledger. Gitignored runtime state.
      file: env.DATABASE_FILE?.trim() || 'data/lu.db',
    },
```

In `startupWarnings`, add this before `return warnings;`:

```js
  // The server-wide features act only in DISCORD_ALLOWED_GUILDS. On with no
  // server allowed, they would do nothing, silently.
  const features = config.features ?? {};
  if (Object.values(features).some(Boolean) && allowedGuilds.length === 0) {
    warnings.push(
      'A server feature (moderation, logging, welcome or role menus) is on but ' +
      'DISCORD_ALLOWED_GUILDS is empty: server features only act in allowed servers, ' +
      'so it will do nothing.',
    );
  }
```

In `src/discord.js`, add this after `shouldObserve`:

```js
// Discord refuses the whole login (close code 4014) when a privileged intent
// is requested but not enabled in the Developer Portal -- chat would go down
// with it. So Server Members (privileged) is requested only when a feature
// that needs member events is on, and the portal switch is a precondition of
// turning that feature on, not of deploying.
export function intentsFor(config) {
  const f = config.features ?? {};
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ];
  if (f.moderation || f.logging || f.welcome) intents.push(GatewayIntentBits.GuildMembers);
  // Bans, unbans and audit-log entries. Not privileged.
  if (f.moderation || f.logging) intents.push(GatewayIntentBits.GuildModeration);
  return intents;
}
```

In `startBot`, replace the literal `intents: [ ... ]` array with
`intents: intentsFor(config),`.

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npm test`
  Expected: PASS, with 574 tests (564 plus 10 new).

- [ ] **Step 5: Mutation check.** Change `f.moderation || f.logging || f.welcome`
  to `f.moderation || f.logging`. Confirm with `git diff src/discord.js` that
  the edit landed. Run `node --test test/discord.test.js` and confirm the
  "Server Members" test fails on `welcome`. Restore the line and re-run to
  green.

- [ ] **Step 6: Commit.**
  `git add src/config.js src/discord.js test/config.test.js test/discord.test.js`
  `git commit -m "Add server feature switches and ask for member intents only when needed"`

---

### Task 2: Database and migrations

**Files:**
- Create: `src/db/index.js`, `src/db/migrations/index.js`,
  `src/db/migrations/001-settings.js`
- Modify: `.gitignore`
- Test: `test/db.test.js`

**Interfaces:**
- Produces:
  - `openDatabase({ file, migrations = MIGRATIONS }) → DatabaseSync`, with
    migrations applied. `file` may be `':memory:'`.
  - `schemaVersion(db) → number`
  - `MIGRATIONS: { version: number, name: string, up(db): void }[]`, in
    ascending order
  - the `settings(guild_id TEXT, feature TEXT, key TEXT, value TEXT,
    PRIMARY KEY (guild_id, feature, key))` table

- [ ] **Step 1: Write the failing tests** in `test/db.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests and see them fail.**
  Run: `node --test test/db.test.js`
  Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/db/index.js`.

- [ ] **Step 3: Implement.** Create `src/db/migrations/001-settings.js`:

```js
// Per-guild, per-feature settings (src/settings.js). The value is JSON text so
// one table holds strings, numbers, id lists and small objects alike.
export default {
  version: 1,
  name: 'settings',
  up(db) {
    db.exec(`
      CREATE TABLE settings (
        guild_id TEXT NOT NULL,
        feature  TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (guild_id, feature, key)
      )
    `);
  },
};
```

Create `src/db/migrations/index.js`:

```js
// Every schema change, in order. Append only: a migration that has run on the
// mini is never edited -- a fix is a new migration.
import settings from './001-settings.js';

export const MIGRATIONS = [settings];
```

Create `src/db/index.js`:

```js
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
```

Append to `.gitignore`, after the `data/suggestions.jsonl` block:

```
# Server features: settings, cases, role menus (src/db). WAL mode adds the
# -wal and -shm files beside it.
data/lu.db
data/lu.db-wal
data/lu.db-shm
```

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npm test`
  Expected: PASS. Also run `git status --short data/` after creating the
  database once with `node -e "import('./src/db/index.js').then(m=>m.openDatabase({file:'data/lu.db'}).close())"`.
  Expected: nothing listed, because the files are ignored. Then delete them
  with `rm data/lu.db*`.

- [ ] **Step 5: Mutation check.** Delete the `db.exec('ROLLBACK');` line and
  confirm the removal with `git diff`. Run `node --test test/db.test.js`, and
  expect "migration 2 is rolled back as a whole" to fail, because table `b`
  exists or the transaction errors on the next `BEGIN`. Restore the line and
  re-run to green.

- [ ] **Step 6: Commit.**
  `git add src/db test/db.test.js .gitignore`
  `git commit -m "Add a SQLite database with numbered migrations"`

---

### Task 3: Settings

**Files:**
- Create: `src/settings.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes: `openDatabase` (Task 2) and the `settings` table.
- Produces: `createSettings(db) → { get(guildId, feature, key, fallback), set(guildId, feature, key, value), remove(guildId, feature, key), all(guildId, feature) → object }`.
  Values round-trip through JSON. `undefined` is refused.

- [ ] **Step 1: Write the failing tests** in `test/settings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { createSettings } from '../src/settings.js';

const fresh = () => createSettings(openDatabase({ file: ':memory:' }));

test('an unset key returns the fallback', () => {
  assert.equal(fresh().get('g1', 'logging', 'channel', null), null);
  assert.equal(fresh().get('g1', 'logging', 'channel', 'x'), 'x');
});

test('values keep their type through the database', () => {
  const s = fresh();
  s.set('g1', 'welcome', 'channel', '123');
  s.set('g1', 'welcome', 'enabled', true);
  s.set('g1', 'joinroles', 'humans', ['1', '2']);
  s.set('g1', 'moderation', 'dm', { onWarn: false });
  assert.equal(s.get('g1', 'welcome', 'channel'), '123');
  assert.equal(s.get('g1', 'welcome', 'enabled'), true);
  assert.deepEqual(s.get('g1', 'joinroles', 'humans'), ['1', '2']);
  assert.deepEqual(s.get('g1', 'moderation', 'dm'), { onWarn: false });
});

test('set overwrites', () => {
  const s = fresh();
  s.set('g1', 'welcome', 'channel', '1');
  s.set('g1', 'welcome', 'channel', '2');
  assert.equal(s.get('g1', 'welcome', 'channel'), '2');
});

test('guilds and features do not see each other', () => {
  const s = fresh();
  s.set('g1', 'welcome', 'channel', 'a');
  assert.equal(s.get('g2', 'welcome', 'channel', null), null);
  assert.equal(s.get('g1', 'leave', 'channel', null), null);
});

test('remove clears a key back to the fallback', () => {
  const s = fresh();
  s.set('g1', 'welcome', 'channel', 'a');
  s.remove('g1', 'welcome', 'channel');
  assert.equal(s.get('g1', 'welcome', 'channel', 'none'), 'none');
});

test('all returns one feature of one guild as a plain object', () => {
  const s = fresh();
  s.set('g1', 'logging', 'messages', '10');
  s.set('g1', 'logging', 'members', '11');
  s.set('g1', 'welcome', 'channel', '12');
  assert.deepEqual(s.all('g1', 'logging'), { members: '11', messages: '10' });
});

test('undefined is refused rather than stored as nothing', () => {
  assert.throws(() => fresh().set('g1', 'welcome', 'channel', undefined), /undefined/);
});
```

- [ ] **Step 2: Run the tests and see them fail.**
  Run: `node --test test/settings.test.js`
  Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/settings.js`.

- [ ] **Step 3: Implement** `src/settings.js`:

```js
// Per-guild, per-feature configuration. The only way a feature reads its
// settings, so the web page (sub-project 6) can later write the same rows.
export function createSettings(db) {
  const getStmt = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND feature = ? AND key = ?');
  const setStmt = db.prepare(`
    INSERT INTO settings (guild_id, feature, key, value) VALUES (?, ?, ?, ?)
    ON CONFLICT (guild_id, feature, key) DO UPDATE SET value = excluded.value
  `);
  const removeStmt = db.prepare('DELETE FROM settings WHERE guild_id = ? AND feature = ? AND key = ?');
  const allStmt = db.prepare('SELECT key, value FROM settings WHERE guild_id = ? AND feature = ? ORDER BY key');

  return {
    get(guildId, feature, key, fallback = null) {
      const row = getStmt.get(guildId, feature, key);
      return row ? JSON.parse(row.value) : fallback;
    },
    set(guildId, feature, key, value) {
      // JSON.stringify(undefined) is undefined, which would bind as NULL and
      // break the NOT NULL column with an unhelpful message.
      if (value === undefined) throw new Error(`Setting ${feature}.${key} cannot be undefined; use remove()`);
      setStmt.run(guildId, feature, key, JSON.stringify(value));
    },
    remove(guildId, feature, key) {
      removeStmt.run(guildId, feature, key);
    },
    all(guildId, feature) {
      const out = {};
      for (const row of allStmt.all(guildId, feature)) out[row.key] = JSON.parse(row.value);
      return out;
    },
  };
}
```

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Mutation check.** In `getStmt`, drop `AND feature = ?` and pass
  only two parameters. Confirm the change with `git diff`. Run the tests and
  expect "guilds and features do not see each other" to fail. Restore the line
  and re-run to green.

- [ ] **Step 6: Commit.**
  `git add src/settings.js test/settings.test.js`
  `git commit -m "Add per-guild feature settings stored as JSON"`

---

### Task 4: Message store

**Files:**
- Create: `src/message-store.js`
- Test: `test/message-store.test.js`

**Interfaces:**
- Produces: `createMessageStore({ ttlMs = 86_400_000, max = 10_000, now = Date.now }) →`
  - `record(msg)`, where `msg = { id, guildId, channelId, authorId, authorName, text, attachments: string[], at }`
  - `get(id) → msg | null`
  - `updateText(id, text) → previous msg | null`. This stores the new text and
    returns a copy of the message as it was.
  - `forget(id) → msg | null`, which removes the message and returns it
  - `recentByAuthor(guildId, authorId, n) → msg[]`, newest first
  - `size() → number`

- [ ] **Step 1: Write the failing tests** in `test/message-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageStore } from '../src/message-store.js';

const msg = (id, over = {}) => ({
  id, guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'sam',
  text: `text ${id}`, attachments: [], at: 0, ...over,
});

test('a recorded message can be read back', () => {
  const s = createMessageStore({ now: () => 0 });
  s.record(msg('1'));
  assert.equal(s.get('1').text, 'text 1');
  assert.equal(s.get('missing'), null);
});

test('messages expire after the time limit', () => {
  let t = 0;
  const s = createMessageStore({ ttlMs: 1000, now: () => t });
  s.record(msg('1', { at: 0 }));
  t = 999;
  assert.ok(s.get('1'));
  t = 1001;
  assert.equal(s.get('1'), null);
});

test('the oldest message is dropped when the cap is reached', () => {
  const s = createMessageStore({ max: 2, now: () => 0 });
  s.record(msg('1'));
  s.record(msg('2'));
  s.record(msg('3'));
  assert.equal(s.get('1'), null);
  assert.ok(s.get('2'));
  assert.ok(s.get('3'));
  assert.equal(s.size(), 2);
});

test('an edit returns the text as it was and keeps the new text', () => {
  const s = createMessageStore({ now: () => 0 });
  s.record(msg('1', { text: 'before' }));
  assert.equal(s.updateText('1', 'after').text, 'before');
  assert.equal(s.get('1').text, 'after');
  assert.equal(s.updateText('missing', 'x'), null);
});

test('forget removes a message and hands it back', () => {
  const s = createMessageStore({ now: () => 0 });
  s.record(msg('1'));
  assert.equal(s.forget('1').id, '1');
  assert.equal(s.get('1'), null);
  assert.equal(s.forget('1'), null);
});

test("an author's recent messages come newest first, from that guild only", () => {
  const s = createMessageStore({ now: () => 10 });
  s.record(msg('1', { at: 1 }));
  s.record(msg('2', { at: 2, authorId: 'u2' }));
  s.record(msg('3', { at: 3, guildId: 'g2' }));
  s.record(msg('4', { at: 4 }));
  s.record(msg('5', { at: 5 }));
  assert.deepEqual(s.recentByAuthor('g1', 'u1', 2).map((m) => m.id), ['5', '4']);
});

test('expired messages are not returned as recent', () => {
  let t = 0;
  const s = createMessageStore({ ttlMs: 100, now: () => t });
  s.record(msg('1', { at: 0 }));
  t = 500;
  s.record(msg('2', { at: 500 }));
  assert.deepEqual(s.recentByAuthor('g1', 'u1', 5).map((m) => m.id), ['2']);
});

test('what is read back is a copy, not the stored record', () => {
  const s = createMessageStore({ now: () => 0 });
  s.record(msg('1'));
  s.get('1').text = 'tampered';
  assert.equal(s.get('1').text, 'text 1');
});
```

- [ ] **Step 2: Run the tests and see them fail.**
  Run: `node --test test/message-store.test.js`
  Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement** `src/message-store.js`:

```js
// Recent message text, in memory only. Discord does not send the text of a
// deleted message, and sends only the new text of an edited one; this is
// where the old text comes from (logging) and where a case's "last 5
// messages" come from (moderation). A restart empties it -- the README
// promises message history is not kept on disk.
//
// A Map keeps insertion order, so the first key is always the oldest: the cap
// evicts from the front, and expiry is checked lazily on read.
export function createMessageStore({ ttlMs = 86_400_000, max = 10_000, now = Date.now } = {}) {
  const byId = new Map();

  const expired = (m) => now() - m.at > ttlMs;
  const copy = (m) => ({ ...m, attachments: [...m.attachments] });

  function live(id) {
    const m = byId.get(id);
    if (!m) return null;
    if (expired(m)) {
      byId.delete(id);
      return null;
    }
    return m;
  }

  return {
    record(msg) {
      byId.delete(msg.id);
      byId.set(msg.id, copy(msg));
      while (byId.size > max) byId.delete(byId.keys().next().value);
    },
    get(id) {
      const m = live(id);
      return m ? copy(m) : null;
    },
    updateText(id, text) {
      const m = live(id);
      if (!m) return null;
      const before = copy(m);
      m.text = text;
      return before;
    },
    forget(id) {
      const m = live(id);
      if (!m) return null;
      byId.delete(id);
      return copy(m);
    },
    recentByAuthor(guildId, authorId, n) {
      const out = [];
      for (const m of [...byId.values()].reverse()) {
        if (out.length >= n) break;
        if (m.guildId === guildId && m.authorId === authorId && !expired(m)) out.push(copy(m));
      }
      return out;
    },
    size: () => byId.size,
  };
}
```

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Mutation check.** Change `now() - m.at > ttlMs` to
  `now() - m.at > ttlMs * 10`. Confirm it with `git diff`, run the tests, and
  expect both expiry tests to fail. Restore and re-run to green.

- [ ] **Step 6: Commit.**
  `git add src/message-store.js test/message-store.test.js`
  `git commit -m "Add an in-memory store of recent message text"`

---

### Task 5: Command registry and `/lu-status`

**Files:**
- Create: `src/commands/registry.js`, `src/commands/status.js`
- Test: `test/commands-registry.test.js`, `test/commands-status.test.js`

**Interfaces:**
- Produces:
  - `createCommandRegistry() → { register(command), definitions() → object[], handle(view, io) → Promise<void> }`
  - `command = { name, description, permission: string | null, options?: object[], run(ctx) }`.
    `permission` is a `PermissionFlagsBits` key such as `'BanMembers'`, or null
    for none.
  - `view = { commandName, guildId, channelId, user: { id, name }, memberPermissions: string[], options: { [name]: value } }`
    (built by `interactionView` in Task 7)
  - `io = { reply({ content?, embeds? }, { ephemeral = true } = {}) }`
  - `ctx = { view, reply: io.reply }`
  - `createStatusCommand({ version, features, databaseOk }) → command`

- [ ] **Step 1: Write the failing tests.** Create `test/commands-registry.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { createCommandRegistry } from '../src/commands/registry.js';

const view = (over = {}) => ({
  commandName: 'ping', guildId: 'g1', channelId: 'c1', user: { id: 'u1', name: 'sam' },
  memberPermissions: [], options: {}, ...over,
});
const recordingIo = () => {
  const replies = [];
  return { replies, reply: async (body, opts = {}) => { replies.push({ body, ephemeral: opts.ephemeral ?? true }); } };
};

test('definitions carry the default permission as Discord expects it', () => {
  const r = createCommandRegistry();
  r.register({ name: 'ban', description: 'Ban someone', permission: 'BanMembers', run: async () => {} });
  r.register({ name: 'open', description: 'Anyone', permission: null, run: async () => {} });
  const [ban, open] = r.definitions();
  assert.equal(ban.name, 'ban');
  assert.equal(ban.default_member_permissions, PermissionFlagsBits.BanMembers.toString());
  assert.equal(open.default_member_permissions, undefined);
});

test('a command is routed to its handler', async () => {
  const r = createCommandRegistry();
  let seen = null;
  r.register({ name: 'ping', description: 'p', permission: null, run: async (ctx) => { seen = ctx.view.user.id; } });
  await r.handle(view(), recordingIo());
  assert.equal(seen, 'u1');
});

// The integration setting in Server Settings can be loosened by an admin. The
// re-check means that loosening can never let a member without the power use it.
test('the permission is re-checked, and a member without it is refused', async () => {
  const r = createCommandRegistry();
  let ran = false;
  r.register({ name: 'ban', description: 'b', permission: 'BanMembers', run: async () => { ran = true; } });
  const io = recordingIo();
  await r.handle(view({ commandName: 'ban', memberPermissions: ['SendMessages'] }), io);
  assert.equal(ran, false);
  assert.equal(io.replies.length, 1);
  assert.equal(io.replies[0].ephemeral, true);
  assert.match(io.replies[0].body.content, /Ban Members/);
});

test('Administrator passes every permission check', async () => {
  const r = createCommandRegistry();
  let ran = false;
  r.register({ name: 'ban', description: 'b', permission: 'BanMembers', run: async () => { ran = true; } });
  await r.handle(view({ commandName: 'ban', memberPermissions: ['Administrator'] }), recordingIo());
  assert.equal(ran, true);
});

test('commands are refused outside a server', async () => {
  const r = createCommandRegistry();
  let ran = false;
  r.register({ name: 'ping', description: 'p', permission: null, run: async () => { ran = true; } });
  const io = recordingIo();
  await r.handle(view({ guildId: null }), io);
  assert.equal(ran, false);
  assert.match(io.replies[0].body.content, /server/);
});

test('a handler that throws gets a private error reply, and the error does not escape', async () => {
  const r = createCommandRegistry();
  r.register({ name: 'ping', description: 'p', permission: null, run: async () => { throw new Error('kaboom'); } });
  const io = recordingIo();
  await r.handle(view(), io);
  assert.equal(io.replies[0].ephemeral, true);
  assert.match(io.replies[0].body.content, /went wrong/);
  assert.doesNotMatch(io.replies[0].body.content, /kaboom/);
});

test('an unknown command is answered, not ignored', async () => {
  const io = recordingIo();
  await createCommandRegistry().handle(view({ commandName: 'nope' }), io);
  assert.match(io.replies[0].body.content, /don't know/);
});

test('registering the same name twice is a programming error', () => {
  const r = createCommandRegistry();
  const c = { name: 'ping', description: 'p', permission: null, run: async () => {} };
  r.register(c);
  assert.throws(() => r.register(c), /already registered/);
});

test('an unknown permission name is a programming error', () => {
  assert.throws(
    () => createCommandRegistry().register({ name: 'x', description: 'x', permission: 'BanMember', run: async () => {} }),
    /BanMember/,
  );
});
```

Create `test/commands-status.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStatusCommand } from '../src/commands/status.js';

const run = async (cmd) => {
  const replies = [];
  await cmd.run({ view: {}, reply: async (body, opts = {}) => { replies.push({ body, opts }); } });
  return replies;
};

test('lu-status needs Manage Server by default', () => {
  const cmd = createStatusCommand({ version: '1.2', features: {}, databaseOk: true });
  assert.equal(cmd.name, 'lu-status');
  assert.equal(cmd.permission, 'ManageGuild');
});

test('lu-status reports the version, each switch and the database, privately', async () => {
  const cmd = createStatusCommand({
    version: '1.2',
    features: { moderation: true, logging: false, welcome: false, roleMenus: false },
    databaseOk: true,
  });
  const [r] = await run(cmd);
  assert.equal(r.opts.ephemeral ?? true, true);
  const text = r.body.content;
  assert.match(text, /v1\.2/);
  assert.match(text, /moderation: on/);
  assert.match(text, /logging: off/);
  assert.match(text, /welcome: off/);
  assert.match(text, /role menus: off/);
  assert.match(text, /database: ok/);
});

test('lu-status says when the database did not open', async () => {
  const [r] = await run(createStatusCommand({ version: '1.2', features: {}, databaseOk: false }));
  assert.match(r.body.content, /database: not available/);
});
```

- [ ] **Step 2: Run the tests and see them fail.**
  Run: `node --test test/commands-registry.test.js test/commands-status.test.js`
  Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement.** Create `src/commands/registry.js`:

```js
import { PermissionFlagsBits } from 'discord.js';

// "BanMembers" -> "Ban Members", for refusal messages people read.
const spaced = (flag) => flag.replace(/([a-z])([A-Z])/g, '$1 $2');

// Every slash command goes through here. Each command declares a Discord
// default permission; the handler then re-checks it, because an admin can
// loosen the default in Server Settings -> Integrations and that must never
// let a member without the power use it.
export function createCommandRegistry() {
  const commands = new Map();

  return {
    register(command) {
      if (commands.has(command.name)) throw new Error(`Command /${command.name} is already registered`);
      if (command.permission && !(command.permission in PermissionFlagsBits)) {
        throw new Error(`Command /${command.name} names unknown permission "${command.permission}"`);
      }
      commands.set(command.name, command);
    },

    definitions() {
      return [...commands.values()].map((c) => ({
        name: c.name,
        description: c.description,
        options: c.options ?? [],
        ...(c.permission ? { default_member_permissions: PermissionFlagsBits[c.permission].toString() } : {}),
      }));
    },

    async handle(view, io) {
      const command = commands.get(view.commandName);
      if (!command) {
        await io.reply({ content: "I don't know that command. It may be from an older version of me." });
        return;
      }
      if (!view.guildId) {
        await io.reply({ content: 'That only works in a server.' });
        return;
      }
      const perms = view.memberPermissions ?? [];
      if (command.permission && !perms.includes('Administrator') && !perms.includes(command.permission)) {
        await io.reply({ content: `You need the ${spaced(command.permission)} permission to use /${command.name}.` });
        return;
      }
      try {
        await command.run({ view, reply: io.reply });
      } catch (err) {
        console.error(`/${command.name} failed:`, err);
        // Best effort: the interaction may already have been answered, and a
        // second failure here must not escape either.
        await io.reply({ content: 'Something went wrong running that. It has been logged.' }).catch(() => {});
      }
    },
  };
}
```

Create `src/commands/status.js`:

```js
// The one command WP-1 ships: proof that slash commands register and route,
// and a quick look at which server features are switched on.
const LABELS = { moderation: 'moderation', logging: 'logging', welcome: 'welcome', roleMenus: 'role menus' };

export function createStatusCommand({ version, features, databaseOk }) {
  return {
    name: 'lu-status',
    description: "Lu's version and which of his server features are switched on",
    permission: 'ManageGuild',
    async run({ reply }) {
      const lines = [
        `Lu v${version}`,
        ...Object.entries(LABELS).map(([key, label]) => `${label}: ${features[key] ? 'on' : 'off'}`),
        `database: ${databaseOk ? 'ok' : 'not available'}`,
      ];
      await reply({ content: lines.join('\n') }, { ephemeral: true });
    },
  };
}
```

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Mutation check.** In `handle`, change
  `!perms.includes(command.permission)` to `false`, so the re-check never
  refuses. Confirm the change with `git diff`, run
  `node --test test/commands-registry.test.js`, and expect "the permission is
  re-checked" to fail because the command runs. Restore and re-run to green.

- [ ] **Step 6: Commit.**
  `git add src/commands test/commands-registry.test.js test/commands-status.test.js`
  `git commit -m "Add a slash-command registry that re-checks permissions, and /lu-status"`

---

### Task 6: Guild event dispatcher

**Files:**
- Create: `src/guild-events.js`
- Test: `test/guild-events.test.js`

**Interfaces:**
- Produces:
  - `GUILD_EVENTS`: a frozen array of `['memberAdd', 'memberRemove', 'memberUpdate', 'banAdd', 'banRemove', 'messageUpdate', 'messageDelete', 'messageBulkDelete', 'auditLogEntry']`
  - `createGuildEvents({ managedGuilds: string[] }) → { on(name, handler), emit(name, guildId, payload) → Promise<void>, has(name) → boolean }`
  - Handlers are called as `handler(payload, { guildId })`.

- [ ] **Step 1: Write the failing tests** in `test/guild-events.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuildEvents, GUILD_EVENTS } from '../src/guild-events.js';

test('a handler receives events from a managed guild', async () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  const seen = [];
  ev.on('memberAdd', (payload, meta) => { seen.push([payload.id, meta.guildId]); });
  await ev.emit('memberAdd', 'g1', { id: 'u1' });
  assert.deepEqual(seen, [['u1', 'g1']]);
});

// Lu chats in a thread in another server (DISCORD_ALLOWED_CHANNELS), but
// server-wide features act only in DISCORD_ALLOWED_GUILDS.
test('events from other guilds are dropped', async () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  let calls = 0;
  ev.on('memberAdd', () => { calls += 1; });
  await ev.emit('memberAdd', 'g2', { id: 'u1' });
  await ev.emit('memberAdd', null, { id: 'u1' });
  assert.equal(calls, 0);
});

test('one failing handler does not stop the others or escape', async () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  let second = false;
  ev.on('banAdd', () => { throw new Error('first broke'); });
  ev.on('banAdd', async () => { second = true; });
  await ev.emit('banAdd', 'g1', {});
  assert.equal(second, true);
});

test('an unknown event name is a programming error', () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  assert.throws(() => ev.on('memberJoin', () => {}), /memberJoin/);
});

test('has() says whether anything listens, so unused events cost nothing', () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  assert.equal(ev.has('messageDelete'), false);
  ev.on('messageDelete', () => {});
  assert.equal(ev.has('messageDelete'), true);
});

test('the event list is fixed', () => {
  assert.ok(Object.isFrozen(GUILD_EVENTS));
  assert.ok(GUILD_EVENTS.includes('auditLogEntry'));
});
```

- [ ] **Step 2: Run the tests and see them fail.**
  Run: `node --test test/guild-events.test.js`
  Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement** `src/guild-events.js`:

```js
// Server-wide events, fanned out to whichever features listen. Scoped to the
// managed guilds (DISCORD_ALLOWED_GUILDS): an explicitly allowed channel in
// another server gets chat, never moderation or logging.
export const GUILD_EVENTS = Object.freeze([
  'memberAdd', 'memberRemove', 'memberUpdate',
  'banAdd', 'banRemove',
  'messageUpdate', 'messageDelete', 'messageBulkDelete',
  'auditLogEntry',
]);

export function createGuildEvents({ managedGuilds }) {
  const handlers = new Map(GUILD_EVENTS.map((name) => [name, []]));

  return {
    on(name, handler) {
      if (!handlers.has(name)) throw new Error(`Unknown guild event "${name}"`);
      handlers.get(name).push(handler);
    },
    has: (name) => (handlers.get(name)?.length ?? 0) > 0,
    async emit(name, guildId, payload) {
      if (!guildId || !managedGuilds.includes(guildId)) return;
      for (const handler of handlers.get(name) ?? []) {
        // Each feature's failure stays its own: logging breaking must not stop
        // moderation recording the same ban.
        try {
          await handler(payload, { guildId });
        } catch (err) {
          console.error(`Guild event ${name} handler failed:`, err);
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Mutation check.** Remove `|| !managedGuilds.includes(guildId)`
  and confirm the change with `git diff`. Expect "events from other guilds are
  dropped" to fail. Restore and re-run to green.

- [ ] **Step 6: Commit.**
  `git add src/guild-events.js test/guild-events.test.js`
  `git commit -m "Add a guild event dispatcher scoped to managed servers"`

---

### Task 7: Discord adapters

**Files:**
- Modify: `src/discord.js`
  - imports
  - new exports `interactionView`, `createInteractionIo`, `messageRecordOf`,
    `registerGuildCommands`
  - `startBot`, which gains `commands`, `guildEvents` and `messageStore`
- Test: `test/discord.test.js`

**Interfaces:**
- Consumes: the registry `handle` and `definitions` (Task 5); `guildEvents.emit`
  and `has` (Task 6); `messageStore.record`, `updateText` and `forget` (Task 4);
  `intentsFor` (Task 1).
- Produces:
  - `interactionView(interaction) → view` (the Task 5 shape). `options` maps
    each option name to its resolved value:
    - a user option gives `{ id, name }`;
    - a channel or role option gives `{ id, name }`;
    - anything else gives its raw value.
  - `createInteractionIo(interaction) → io` (the Task 5 shape). It uses
    `flags: MessageFlags.Ephemeral`, and uses `followUp` once the interaction
    has been replied to or deferred.
  - `messageRecordOf(message) → msg | null` (the Task 4 shape). It returns
    `null` for bots, direct messages and system messages.
  - `registerGuildCommands({ client, guildIds, definitions }) → Promise<void>`.
    It logs the outcome for each guild and never throws.
  - `startBot({ config, onMessage, commands = null, guildEvents = null, messageStore = null })`

- [ ] **Step 1: Write the failing tests.** Append to `test/discord.test.js`,
  and extend its import from `../src/discord.js` with `interactionView`,
  `createInteractionIo`, `messageRecordOf` and `registerGuildCommands`. Merge
  the new `discord.js` import into the one Task 1 added at the top:

```js
import { MessageFlags, ApplicationCommandOptionType } from 'discord.js';

// --- Interaction adapter (WP-1) ---

const fakeInteraction = (over = {}) => ({
  commandName: 'ban', guildId: 'g1', channelId: 'c1',
  user: { id: 'u1', username: 'sam', displayName: 'Sam' },
  member: { displayName: 'Sammy' },
  memberPermissions: { toArray: () => ['BanMembers', 'SendMessages'] },
  options: {
    data: [
      { name: 'target', type: ApplicationCommandOptionType.User, value: 'u2', user: { id: 'u2', displayName: 'Bo' }, member: { displayName: 'Bobby' } },
      { name: 'reason', type: ApplicationCommandOptionType.String, value: 'spam' },
      { name: 'where', type: ApplicationCommandOptionType.Channel, value: 'c9', channel: { id: 'c9', name: 'logs' } },
    ],
  },
  replied: false, deferred: false,
  ...over,
});

test('an interaction becomes a plain view', () => {
  const v = interactionView(fakeInteraction());
  assert.equal(v.commandName, 'ban');
  assert.equal(v.guildId, 'g1');
  assert.deepEqual(v.user, { id: 'u1', name: 'Sammy' });
  assert.deepEqual(v.memberPermissions, ['BanMembers', 'SendMessages']);
  assert.deepEqual(v.options.target, { id: 'u2', name: 'Bobby' });
  assert.equal(v.options.reason, 'spam');
  assert.deepEqual(v.options.where, { id: 'c9', name: 'logs' });
});

test('an interaction outside a server has no guild and no permissions', () => {
  const v = interactionView(fakeInteraction({ guildId: null, member: null, memberPermissions: null }));
  assert.equal(v.guildId, null);
  assert.deepEqual(v.memberPermissions, []);
  assert.deepEqual(v.user, { id: 'u1', name: 'Sam' });
});

test('replies are private by default and can never ping', async () => {
  const calls = [];
  const it = fakeInteraction({ reply: async (o) => { calls.push(['reply', o]); } });
  await createInteractionIo(it).reply({ content: 'hi @everyone' });
  assert.equal(calls[0][0], 'reply');
  assert.equal(calls[0][1].flags, MessageFlags.Ephemeral);
  assert.deepEqual(calls[0][1].allowedMentions, { parse: [] });
});

test('a public reply has no ephemeral flag', async () => {
  const calls = [];
  const it = fakeInteraction({ reply: async (o) => { calls.push(o); } });
  await createInteractionIo(it).reply({ content: 'x' }, { ephemeral: false });
  assert.equal(calls[0].flags, undefined);
});

test('a second reply becomes a follow-up', async () => {
  const calls = [];
  const it = fakeInteraction({ replied: true, followUp: async (o) => { calls.push(['followUp', o]); } });
  await createInteractionIo(it).reply({ content: 'x' });
  assert.equal(calls[0][0], 'followUp');
});

// --- Message store feed (WP-1) ---

const fakeMessage = (over = {}) => ({
  id: 'm1', guildId: 'g1', channelId: 'c1', content: 'hello', createdTimestamp: 5, system: false,
  author: { id: 'u1', bot: false, displayName: 'Sam' },
  member: { displayName: 'Sammy' },
  attachments: new Map([['a1', { name: 'cat.png' }]]),
  ...over,
});

test('a guild message becomes a store record', () => {
  assert.deepEqual(messageRecordOf(fakeMessage()), {
    id: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'Sammy',
    text: 'hello', attachments: ['cat.png'], at: 5,
  });
});

test('bots, direct messages and system messages are not stored', () => {
  assert.equal(messageRecordOf(fakeMessage({ author: { id: 'b', bot: true, displayName: 'B' } })), null);
  assert.equal(messageRecordOf(fakeMessage({ guildId: null })), null);
  assert.equal(messageRecordOf(fakeMessage({ system: true })), null);
});

// --- Command registration (WP-1) ---

test('commands are registered per guild, and one failure does not stop the rest', async () => {
  const set = [];
  const client = { guilds: { fetch: async (id) => {
    if (id === 'bad') throw new Error('Missing Access');
    return { commands: { set: async (defs) => { set.push([id, defs.length]); } } };
  } } };
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    await registerGuildCommands({ client, guildIds: ['bad', 'g1'], definitions: [{ name: 'x' }] });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(set, [['g1', 1]]);
  assert.match(warned.join('\n'), /bad.*Missing Access/);
});
```

- [ ] **Step 2: Run the tests and see them fail.**
  Run: `node --test test/discord.test.js`
  Expected: FAIL. The new names are not exported.

- [ ] **Step 3: Implement.** In `src/discord.js`, change the import line to:

```js
import { Client, GatewayIntentBits, Events, PermissionsBitField, MessageFlags, ApplicationCommandOptionType } from 'discord.js';
```

Add these after `viewOf`:

```js
// A slash command as plain data, so command handlers never touch discord.js.
// Resolved options carry an id and a display name; everything else is its
// raw value.
export function interactionView(interaction) {
  const options = {};
  for (const o of interaction.options?.data ?? []) {
    if (o.type === ApplicationCommandOptionType.User) {
      options[o.name] = { id: o.user.id, name: o.member?.displayName ?? o.user.displayName };
    } else if (o.channel) {
      options[o.name] = { id: o.channel.id, name: o.channel.name };
    } else if (o.role) {
      options[o.name] = { id: o.role.id, name: o.role.name };
    } else {
      options[o.name] = o.value;
    }
  }
  return {
    commandName: interaction.commandName,
    guildId: interaction.guildId ?? null,
    channelId: interaction.channelId,
    user: { id: interaction.user.id, name: interaction.member?.displayName ?? interaction.user.displayName },
    memberPermissions: interaction.memberPermissions?.toArray() ?? [],
    options,
  };
}

// Private unless told otherwise, and never able to ping -- a reason typed by
// a moderator can contain @everyone.
export function createInteractionIo(interaction) {
  return {
    async reply(body, { ephemeral = true } = {}) {
      const payload = {
        ...body,
        allowedMentions: { parse: [] },
        ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
      };
      if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
      return interaction.reply(payload);
    },
  };
}

// What the message store keeps. Bots and system messages ("X pinned a
// message") are not worth keeping; direct messages are not server business.
export function messageRecordOf(message) {
  if (!message.guildId || message.author?.bot || message.system) return null;
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.displayName,
    text: message.content ?? '',
    attachments: [...(message.attachments?.values() ?? [])].map((a) => a.name),
    at: message.createdTimestamp,
  };
}

// Guild commands appear immediately (global ones can take an hour). A failure
// in one guild -- most likely Lu was invited without the commands scope -- is
// logged and does not stop the others or the bot.
export async function registerGuildCommands({ client, guildIds, definitions }) {
  for (const id of guildIds) {
    try {
      const guild = await client.guilds.fetch(id);
      await guild.commands.set(definitions);
      console.log(`Registered ${definitions.length} slash command(s) in guild ${id}.`);
    } catch (err) {
      console.warn(`Could not register slash commands in guild ${id}: ${err.message}`);
    }
  }
}
```

In `startBot`, change the signature to
`export async function startBot({ config, onMessage, commands = null, guildEvents = null, messageStore = null })`.
Then replace the `MessageCreate` handler, and add the new handlers before
`await client.login(...)`:

```js
  client.on(Events.MessageCreate, async (message) => {
    // Recorded before the chat filter: logging needs every channel in the
    // server, not only the ones Lu chats in.
    if (messageStore && config.discord.allowedGuilds.includes(message.guildId)) {
      try {
        const record = messageRecordOf(message);
        if (record) messageStore.record(record);
      } catch (err) {
        console.error('Failed to record message:', err);
      }
    }
    const view = viewOf(message);
    if (!shouldObserve(view, {
      botId: client.user.id,
      allowedChannels: config.discord.allowedChannels,
      allowedGuilds: config.discord.allowedGuilds,
      deniedChannels: config.discord.deniedChannels,
    })) {
      return;
    }
    try {
      await onMessage(toEntry(view, { botId: client.user.id }), createChannelIo(message.channel));
    } catch (err) {
      console.error('Failed to handle message:', err);
    }
  });

  if (commands) {
    client.once(Events.ClientReady, () => registerGuildCommands({
      client, guildIds: config.discord.allowedGuilds, definitions: commands.definitions(),
    }));
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      try {
        await commands.handle(interactionView(interaction), createInteractionIo(interaction));
      } catch (err) {
        console.error('Failed to handle command:', err);
      }
    });
  }

  if (guildEvents) {
    // Each discord.js event is forwarded as-is to the features that listen.
    // Features that need plain data build it themselves (WP-2 onwards), so
    // this layer stays a pass-through and the guild scoping lives in one place.
    const forward = (event, name, guildOf) => {
      client.on(event, async (...args) => {
        if (!guildEvents.has(name)) return;
        try {
          await guildEvents.emit(name, guildOf(...args), args.length === 1 ? args[0] : args);
        } catch (err) {
          console.error(`Failed to forward ${name}:`, err);
        }
      });
    };
    forward(Events.GuildMemberAdd, 'memberAdd', (m) => m.guild.id);
    forward(Events.GuildMemberRemove, 'memberRemove', (m) => m.guild.id);
    forward(Events.GuildMemberUpdate, 'memberUpdate', (_before, after) => after.guild.id);
    forward(Events.GuildBanAdd, 'banAdd', (ban) => ban.guild.id);
    forward(Events.GuildBanRemove, 'banRemove', (ban) => ban.guild.id);
    forward(Events.MessageUpdate, 'messageUpdate', (_before, after) => after.guildId);
    forward(Events.MessageDelete, 'messageDelete', (m) => m.guildId);
    forward(Events.MessageBulkDelete, 'messageBulkDelete', (messages, channel) => channel.guildId);
    forward(Events.GuildAuditLogEntryCreate, 'auditLogEntry', (_entry, guild) => guild.id);
  }
```

The message store must learn about edits whether or not a feature listens,
so that the stored text stays current. Add this block immediately after the
`MessageCreate` handler, before `if (commands)`:

```js
  if (messageStore) {
    client.on(Events.MessageUpdate, (_before, after) => {
      try {
        if (after.content != null) messageStore.updateText(after.id, after.content);
      } catch (err) {
        console.error('Failed to update stored message:', err);
      }
    });
  }
```

Deletes are **not** removed from the store here. Logging (WP-3) reads the
deleted message with `get` and then calls `forget`. If the store removed the
message itself, the handlers would be racing it for the text.

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Mutation check.** In `createInteractionIo`, change the default
  to `ephemeral = false`. Confirm the change with `git diff`, and expect
  "replies are private by default" to fail. Restore and re-run to green.

- [ ] **Step 6: Commit.**
  `git add src/discord.js test/discord.test.js`
  `git commit -m "Adapt interactions, guild events and the message store to discord.js"`

---

### Task 8: Wire it up, document it, ship it switched off

**Files:**
- Modify: `src/index.js` (imports; construction before `startBot`; the
  `startBot` call; shutdown)
- Modify: `.env.example`, `README.md`, `CHANGELOG.md`, `package.json` (no
  change unless the version is read from it; see below)

**Interfaces:**
- Consumes everything above.

- [ ] **Step 1: Version source.** `/lu-status` reports the same version that
  the update announcement uses: `parseChangelog(text)` from `src/announce.js`,
  which returns `{ version, notes }` (or `null` when there is no `## vX.Y`
  heading). `src/index.js` already reads `CHANGELOG.md` for the
  announcement.

- [ ] **Step 2: Wire `src/index.js`.** Add these imports:

```js
import { openDatabase } from './db/index.js';
import { createSettings } from './settings.js';
import { createMessageStore } from './message-store.js';
import { createCommandRegistry } from './commands/registry.js';
import { createStatusCommand } from './commands/status.js';
import { createGuildEvents } from './guild-events.js';
```

Also change the existing `import { announceUpdate } from './announce.js';` to
`import { announceUpdate, parseChangelog } from './announce.js';`.

Add this before `const client = await startBot(`:

```js
// Server features (WP-1). A database that will not open is logged, not fatal:
// chat and credits do not need it, and /lu-status says it is missing.
let db = null;
try {
  db = openDatabase({ file: join(projectRoot, config.database.file) });
} catch (err) {
  console.error(`Database unavailable, server features disabled: ${err.message}`);
}
// Used by WP-2 onwards; built now so the database path is proven at startup.
const settings = db ? createSettings(db) : null;
const messageStore = config.features.moderation || config.features.logging ? createMessageStore() : null;
const guildEvents = createGuildEvents({ managedGuilds: config.discord.allowedGuilds });
const commands = createCommandRegistry();
const changelog = await readFile(join(projectRoot, 'CHANGELOG.md'), 'utf8');
commands.register(createStatusCommand({
  version: parseChangelog(changelog)?.version ?? 'unknown',
  features: config.features,
  databaseOk: Boolean(db),
}));
```

Change the `startBot` call to:

```js
const client = await startBot({
  config,
  onMessage: (entry, io) => conversation.handleMessage(entry, io),
  commands,
  guildEvents,
  messageStore,
});
```

In the shutdown handler, add `db?.close();` immediately after the
`try { await creditStore?.close(); } catch … ` block and before
`process.exit(0);`.

`settings` has no reader until WP-2. Leave it as it is, with the comment. Do
not export it or thread it anywhere yet.

- [ ] **Step 3: Document.** In `.env.example`, add this after the
  `UPDATE_CHANNEL_ID` block:

```
# --- Server features (moderation, logging, welcomes, role menus) ---
# Each acts across the servers in DISCORD_ALLOWED_GUILDS only, and each ships
# off. Set to exactly "true" to turn one on.
# BEFORE turning on moderation, logging or welcome: enable the Server Members
# intent for Lu in the Discord Developer Portal (Bot -> Privileged Gateway
# Intents). Without it Discord refuses Lu's login entirely.
MODERATION_ENABLED=false
LOGGING_ENABLED=false
WELCOME_ENABLED=false
ROLE_MENUS_ENABLED=false
# Settings, cases and role menus. Relative to the project root.
DATABASE_FILE=data/lu.db
```

In `README.md`, near line 152 (the paragraph about which channels he
watches), add:

```
The server features -- moderation, logging, welcome messages and role menus -- are each switched on in `.env` and act across every channel of the servers in `DISCORD_ALLOWED_GUILDS`. Their settings live in `data/lu.db`. `/lu-status` (Manage Server) shows which are on.
```

In `CHANGELOG.md`, add this at the top, under the intro paragraph:

```
## v1.2 — <date of deploy>

- lu has his first slash command: /lu-status shows his version and which of his new server features are switched on (you need the manage server permission)
- this is groundwork for lu taking over from sapphire; nothing else changes yet
```

- [ ] **Step 4: Run the full suite.**
  Run: `npm test`
  Expected: PASS, 0 fail. Record the pass count in the phase log.

- [ ] **Step 5: Local start check without Discord.**
  Run: `node -e "import('./src/db/index.js').then(({openDatabase})=>{const d=openDatabase({file:'/tmp/lu-wp1-check.db'});console.log(d.prepare('PRAGMA user_version').get());d.close()})" && rm /tmp/lu-wp1-check.db*`
  Expected: `{ user_version: 1 }`.

- [ ] **Step 6: Commit.**
  `git add src/index.js .env.example README.md CHANGELOG.md`
  `git commit -m "Wire the server-feature foundation in, switched off, with /lu-status"`

- [ ] **Step 7: Merge gate.** A fresh reviewer, not the author session,
  reviews the whole branch diff against **both** this plan and the spec's
  sub-project 1. The reviewer should name:
  - any spec requirement the diff misses;
  - any behaviour the spec never asked for, beyond the three deltas listed
    at the top of this plan.

- [ ] **Step 8: Deploy — owner approval required first.** Deploy the same way
  as the 2026-09-18 entry in `.agents/STATUS.md`:
  1. Take a backup tarball on the mini.
  2. rsync from `git ls-files`, with no `--delete`.
  3. Run `launchctl kickstart -k gui/$(id -u)/com.curphey.lu-bot`.

  All four switches stay off. Then prove it live:
  1. `ssh mini 'tail -8 ~/Library/Logs/lu-bot/bot.log'` shows
     `Registered 1 slash command(s) in guild 1321631568976150588.`, followed by
     `Lu Bot is online.` and the v1.2 announcement.
  2. `ssh mini 'ls -la ~/lu-bot/data/lu.db'` shows that the file exists.
  3. The owner runs `/lu-status` in Cry's Cantina and sees `Lu v1.2`, all four
     features `off`, and `database: ok`.
  4. The owner chats with Lu as usual, and he replies. This proves the chat
     path is unchanged.

## Completion criteria

- All 8 tasks' tests pass (`npm test`, 0 fail).
- Each task's mutation check was performed and recorded in
  `.agents/work-plans/wp-001-foundation/phase-log.md`.
- The merge-gate review is clean, or its findings are resolved.
- The four live checks in Task 8 Step 8 pass and are recorded.
- STATUS is updated: WP-1 closed, WP-2 next, with the re-audit noted.
