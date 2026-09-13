# Imperial Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Lu an activity ledger — members earn Imperial Credits by taking part in chat, credits become a level, and the balance survives a restart.

**Architecture:** Five new modules under `src/credits/`, each with one job: a pure curve (`levels.js`), a durable JSON store with atomic writes (`store.js`), an eligibility-and-award rule (`earn.js`), anchored command regexes with their text formatters (`commands.js`), and a phase-2 placeholder (`voice.js`, not built here). They are wired into `conversation.handleMessage`, which is already the orchestrator; `src/discord.js` gains one small field on the message entry and nothing else. Level is derived from credits, never stored.

**Tech Stack:** Node.js ≥26, ESM, discord.js v14, `node:test` + `node:assert/strict`. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-12-imperial-credits-design.md`

## Global Constraints

- **Node ≥26, ESM only.** `"type": "module"`. Use `import`, never `require`.
- **No new npm dependencies.** `discord.js` stays the only entry in `package.json` dependencies. Standard-library modules (`node:fs/promises`, `node:path`, `node:os`) are fine.
- **Test-first, and every new test must be watched to fail for the right reason.** Write the test, run it, see it fail, then implement. After a test passes, break the code it covers on purpose, confirm it goes red, and restore — and confirm the mutation actually landed, because a no-op edit makes a test look sound while proving nothing.
- **Never claim something passes without having run it and seen the output.**
- **Branch, never main.** All work on `spec/imperial-credits` or a branch from it.
- **`node:test` + `node:assert/strict`, flat `test()` calls, no `describe` nesting.** Run with `npm test` (`node --test`).
- **discord.js objects are never faked.** Each test file defines a small local factory returning a plain object with an override spread, matching `test/history.test.js:6-13`.
- **Time and randomness are injected**, never reached for. `now` and `random` are parameters with defaults.
- **Plain text via `channel.send`, never embeds, never Discord replies.** Matches every other message Lu sends.
- **Single guild.** Credits are keyed on user ID alone, with no guild dimension — consistent with history, decisions and conversation state, which all key on channel ID alone.
- **The existing suite is 350 tests, all passing** (measured 2026-09-12 on the MacBook at this branch point). It must still be 350-plus-new and all passing at every commit.
- **Existing config fixtures predate this feature.** Roughly 350 tests build `config` objects with no `credits` section. Every read of `config.credits` in shared code paths must use optional chaining (`config.credits?.enabled`) so those tests keep passing.
- **Exact award values:** 15–25 credits per eligible message, 30-second per-user cooldown, 3-character minimum message length, curve `5n² + 50n + 100`.
- **Scope:** phase 1 (text credits) only. Voice credits are phase 2 and get their own plan.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/credits/levels.js` | the curve; pure arithmetic, no I/O | 1 |
| `test/credits-levels.test.js` | curve tests | 1 |
| `src/credits/store.js` | durable JSON state, atomic writes, debounce | 2 |
| `test/credits-store.test.js` | store tests | 2 |
| `.gitignore` | ignore `data/credits.json` | 2 |
| `src/config.js` | new `credits` section | 3 |
| `.env.example` | documented defaults | 3 |
| `test/config.test.js` | config tests | 3 |
| `src/credits/earn.js` | eligibility and award for one message | 4 |
| `test/credits-earn.test.js` | earning tests | 4 |
| `src/discord.js` | expose mentioned user IDs on the entry | 5 |
| `test/discord.test.js` | mention exposure tests | 5 |
| `src/credits/commands.js` | anchored regexes, formatters, persona fragment | 6 |
| `test/credits-commands.test.js` | command and formatting tests | 6 |
| `src/conversation.js` | wire commands, awarding, level-up, persona fragment | 7, 8 |
| `test/conversation.test.js` | integration tests | 7, 8 |
| `src/index.js` | build the store, inject it, flush on shutdown | 9 |

**Not created in this plan:** `src/credits/voice.js`. The spec sequences voice behind text credits shipping; it gets its own plan.

---

### Task 1: The curve

Pure arithmetic with no I/O, so the riskiest thing in the feature is testable in complete isolation. MEE6's formula, unchanged, so the numbers mean what people expect from other servers.

**Files:**
- Create: `src/credits/levels.js`
- Test: `test/credits-levels.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `costOfLevel(n: number) -> number` — credits to go from level `n` to `n+1`
  - `totalToReach(n: number) -> number` — cumulative credits to be at level `n`
  - `levelFor(credits: number) -> number` — highest level whose total is met
  - `progress(credits: number) -> { level: number, into: number, needed: number }` — `into` is credits earned within the current level, `needed` is the full cost of clearing it

- [ ] **Step 1: Write the failing test**

Create `test/credits-levels.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOfLevel, totalToReach, levelFor, progress } from '../src/credits/levels.js';

// --- The curve ---
// MEE6's published formula, kept byte-for-byte so a level here means what it
// means in every other server people have been in. The cumulative figures are
// checked term by term rather than taken from a summary: reaching level 5
// costs 100 + 155 + 220 + 295 + 380 = 1150.

test('cost of a single level follows 5n^2 + 50n + 100', () => {
  assert.equal(costOfLevel(0), 100);
  assert.equal(costOfLevel(1), 155);
  assert.equal(costOfLevel(2), 220);
  assert.equal(costOfLevel(3), 295);
  assert.equal(costOfLevel(4), 380);
  assert.equal(costOfLevel(5), 475);
});

test('cumulative cost matches the published totals', () => {
  assert.equal(totalToReach(0), 0);
  assert.equal(totalToReach(1), 100);
  assert.equal(totalToReach(5), 1150);
  assert.equal(totalToReach(10), 4675);
  assert.equal(totalToReach(25), 42000);
  assert.equal(totalToReach(50), 268375);
});

test('levelFor is correct on both sides of every boundary', () => {
  assert.equal(levelFor(0), 0);
  assert.equal(levelFor(99), 0);
  assert.equal(levelFor(100), 1);
  assert.equal(levelFor(254), 1);
  assert.equal(levelFor(255), 2);
  assert.equal(levelFor(1149), 4);
  assert.equal(levelFor(1150), 5);
});

// Nobody can go negative — credits only ever rise — but a corrupt file or a
// future admin command could produce one, and a curve that loops forever on
// bad input would hang the bot rather than misreport a number.
test('a negative balance reads as level 0, not a hang', () => {
  assert.equal(levelFor(-1), 0);
  assert.equal(levelFor(-100000), 0);
});

test('progress reports position within the current level', () => {
  assert.deepEqual(progress(1200), { level: 5, into: 50, needed: 475 });
  assert.deepEqual(progress(0), { level: 0, into: 0, needed: 100 });
  assert.deepEqual(progress(1150), { level: 5, into: 0, needed: 475 });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/credits-levels.test.js`
Expected: FAIL — `Cannot find module '../src/credits/levels.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/credits/levels.js`:

```js
// The curve is MEE6's, unchanged: the cost of going from level n to n+1 is
// 5n^2 + 50n + 100. Kept identical rather than invented so a level here means
// what it means in every other server people have been in. Quadratic, so the
// first levels come quickly and the top of the leaderboard stays scarce.
export function costOfLevel(n) {
  return 5 * n * n + 50 * n + 100;
}

export function totalToReach(n) {
  let total = 0;
  for (let k = 0; k < n; k += 1) total += costOfLevel(k);
  return total;
}

// Counted up rather than solved in closed form: the loop is obviously correct
// against the formula above, and at these magnitudes (level 50 is 50 additions)
// the cost is irrelevant. A closed form would be one algebra slip away from
// silently misreporting everyone's level.
export function levelFor(credits) {
  if (!(credits > 0)) return 0;
  let level = 0;
  let total = 0;
  for (;;) {
    const next = total + costOfLevel(level);
    if (next > credits) return level;
    total = next;
    level += 1;
  }
}

export function progress(credits) {
  const level = levelFor(credits);
  const floor = totalToReach(level);
  return {
    level,
    into: Math.max(0, credits - floor),
    needed: costOfLevel(level),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/credits-levels.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Break it on purpose and watch it go red**

Change `5 * n * n` to `6 * n * n` in `costOfLevel`. Run `node --test test/credits-levels.test.js`. Confirm the file on disk actually changed (`grep -n '6 \* n \* n' src/credits/levels.js` must print a line) and that the run FAILS on the cost and cumulative assertions. Restore `5 * n * n` and re-run to green.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: 355 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/credits/levels.js test/credits-levels.test.js
git commit -m "feat(credits): the level curve

MEE6's 5n^2+50n+100, unchanged, so a level here means what it means in
other servers. Level is derived from credits and never stored, so the
curve can be retuned without a data migration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The durable store

The first state Lu has ever kept across a restart. Three behaviours in LU2's equivalent (`~/Claude/Lu/LU2/social_credit.py:52-84`) are defects and are fixed here rather than ported: it rewrote the live file in place on every event with no rename, it wrote synchronously per event, and its loader swallowed every exception and returned `{}` — so one corrupt byte silently zeroed every score.

**Files:**
- Create: `src/credits/store.js`
- Modify: `.gitignore`
- Test: `test/credits-store.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `createCreditStore({ dir, now?, flushMs?, setTimeoutImpl?, clearTimeoutImpl? }) -> Promise<store>` — async because it reads the file at construction
  - `store.get(userId: string) -> { credits, name, lastAwardAt, messages, voiceSeconds }` — a copy; an unknown user reads as all-zero with `name: ''`
  - `store.award(userId: string, { credits: number, name: string, at: number }) -> number` — the new total
  - `store.top(n: number) -> [{ userId, name, credits }]` — descending, ties broken by `userId`
  - `store.all() -> [{ userId, credits, name, lastAwardAt, messages, voiceSeconds }]`
  - `store.flush() -> Promise<void>`
  - `store.close() -> Promise<void>`
  - `CREDITS_FILE = 'credits.json'`

- [ ] **Step 1: Write the failing test**

Create `test/credits-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createCreditStore, CREDITS_FILE } from '../src/credits/store.js';

async function scratch() {
  return await mkdtemp(join(tmpdir(), 'lu-credits-'));
}

// --- Durability ---
// Credits are the first thing Lu remembers across a restart, and the mini it
// runs on has FileVault on: a power cut leaves it locked until someone types
// a password at the machine. So the write path is the part of this feature
// most likely to fail quietly, and it is tested harder than the arithmetic.

test('an unknown user reads as zero without creating a record', async () => {
  const dir = await scratch();
  const store = await createCreditStore({ dir, now: () => 1000 });
  assert.deepEqual(store.get('nobody'), {
    credits: 0, name: '', lastAwardAt: 0, messages: 0, voiceSeconds: 0,
  });
  assert.deepEqual(store.all(), []);
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

test('awards accumulate and survive a reload', async () => {
  const dir = await scratch();
  const store = await createCreditStore({ dir, now: () => 1000, flushMs: 0 });
  assert.equal(store.award('u1', { credits: 20, name: 'Bob', at: 5000 }), 20);
  assert.equal(store.award('u1', { credits: 15, name: 'Bob', at: 9000 }), 35);
  await store.close();

  const reloaded = await createCreditStore({ dir, now: () => 1000 });
  assert.deepEqual(reloaded.get('u1'), {
    credits: 35, name: 'Bob', lastAwardAt: 9000, messages: 2, voiceSeconds: 0,
  });
  await reloaded.close();
  await rm(dir, { recursive: true, force: true });
});

test('a missing file starts clean rather than failing', async () => {
  const dir = await scratch();
  const store = await createCreditStore({ dir });
  assert.deepEqual(store.all(), []);
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

// LU2's loader had a bare `except Exception: return {}`, so one corrupt byte
// silently wiped every score and the bot carried on as though nothing had
// happened. Losing everyone's balance must be a decision, not a side effect.
test('a corrupt file refuses to start and names the file', async () => {
  const dir = await scratch();
  await writeFile(join(dir, CREDITS_FILE), '{ not json');
  await assert.rejects(
    () => createCreditStore({ dir }),
    (err) => err.message.includes(CREDITS_FILE),
  );
  await rm(dir, { recursive: true, force: true });
});

test('a file with the wrong shape is corruption, not an empty ledger', async () => {
  const dir = await scratch();
  await writeFile(join(dir, CREDITS_FILE), JSON.stringify({ version: 99, users: {} }));
  await assert.rejects(() => createCreditStore({ dir }));
  await rm(dir, { recursive: true, force: true });
});

// Written to a temp file and renamed, which is atomic on macOS: a reader sees
// either the whole old file or the whole new one, never a half-written one.
// The temp file must not be left behind.
test('writing leaves no temp file behind', async () => {
  const dir = await scratch();
  const store = await createCreditStore({ dir, flushMs: 0 });
  store.award('u1', { credits: 20, name: 'Bob', at: 1 });
  await store.flush();
  assert.deepEqual((await readdir(dir)).sort(), [CREDITS_FILE]);
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

test('a burst of awards is written once, not once per award', async () => {
  const dir = await scratch();
  let writes = 0;
  const store = await createCreditStore({
    dir,
    flushMs: 10,
    // Count flushes by counting timer scheduling: a debounced store schedules
    // one timer for a burst, not one per award.
    setTimeoutImpl: (fn, ms) => { writes += 1; return setTimeout(fn, ms); },
  });
  store.award('u1', { credits: 20, name: 'Bob', at: 1 });
  store.award('u2', { credits: 20, name: 'Ann', at: 2 });
  store.award('u3', { credits: 20, name: 'Cid', at: 3 });
  assert.equal(writes, 1);
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

test('close flushes pending state', async () => {
  const dir = await scratch();
  const store = await createCreditStore({ dir, flushMs: 100000 });
  store.award('u1', { credits: 20, name: 'Bob', at: 1 });
  await store.close();
  const raw = JSON.parse(await readFile(join(dir, CREDITS_FILE), 'utf8'));
  assert.equal(raw.users.u1.credits, 20);
  assert.equal(raw.version, 1);
});

test('top is descending, capped, and breaks ties predictably', async () => {
  const dir = await scratch();
  const store = await createCreditStore({ dir, flushMs: 0 });
  store.award('b', { credits: 50, name: 'Bee', at: 1 });
  store.award('a', { credits: 50, name: 'Ay', at: 1 });
  store.award('c', { credits: 90, name: 'Cee', at: 1 });
  assert.deepEqual(store.top(2), [
    { userId: 'c', name: 'Cee', credits: 90 },
    { userId: 'a', name: 'Ay', credits: 50 },
  ]);
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

// The display name is real data observed at the moment credit was awarded, so
// the leaderboard can name someone without a live member lookup. It is
// refreshed on every award and never synthesised.
test('the stored name is refreshed by each award', async () => {
  const dir = await scratch();
  const store = await createCreditStore({ dir, flushMs: 0 });
  store.award('u1', { credits: 20, name: 'LUPHER', at: 1 });
  store.award('u1', { credits: 20, name: 'COMRADE STONE', at: 2 });
  assert.equal(store.get('u1').name, 'COMRADE STONE');
  await store.close();
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/credits-store.test.js`
Expected: FAIL — `Cannot find module '../src/credits/store.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/credits/store.js`:

```js
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const CREDITS_FILE = 'credits.json';
const VERSION = 1;

const empty = () => ({ credits: 0, name: '', lastAwardAt: 0, messages: 0, voiceSeconds: 0 });

// A missing file is a first run, not a fault. Anything else — unreadable,
// unparseable, or the wrong shape — is corruption and must stop the bot.
// LU2's equivalent swallowed every error and returned an empty ledger, so one
// bad byte silently zeroed every score with nothing said. Losing everyone's
// balance has to be a decision.
async function load(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw new Error(`Could not read ${path}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${err.message}). Refusing to start rather than reset every balance to zero.`);
  }

  if (parsed?.version !== VERSION || typeof parsed.users !== 'object' || parsed.users === null) {
    throw new Error(`${path} is not a version ${VERSION} credits file. Refusing to start rather than reset every balance to zero.`);
  }

  return new Map(Object.entries(parsed.users).map(([id, rec]) => [id, { ...empty(), ...rec }]));
}

export async function createCreditStore({
  dir,
  now = Date.now,
  flushMs = 2000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const path = join(dir, CREDITS_FILE);
  const tmp = `${path}.tmp`;
  const users = await load(path);

  let dirty = false;
  let timer = null;
  let writing = Promise.resolve();

  async function write() {
    if (!dirty) return;
    // Cleared before the write, not after: an award arriving mid-write must
    // leave the store dirty so the next flush picks it up.
    dirty = false;
    const snapshot = JSON.stringify(
      { version: VERSION, users: Object.fromEntries(users) },
      null,
      2,
    );
    try {
      // Temp file then rename — atomic on macOS. Writing the live file in
      // place, as LU2 did, truncates everything if the process dies mid-write.
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, path);
    } catch (err) {
      // Never take the bot down for a failed write. Stay dirty and retry on
      // the next flush; the in-memory ledger is still correct.
      dirty = true;
      console.error(`Failed to write ${path}:`, err);
    }
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      writing = writing.then(write);
    }, flushMs);
  }

  function record(userId) {
    let rec = users.get(userId);
    if (!rec) {
      rec = empty();
      users.set(userId, rec);
    }
    return rec;
  }

  return {
    get(userId) {
      return { ...(users.get(userId) ?? empty()) };
    },

    award(userId, { credits, name, at }) {
      const rec = record(userId);
      rec.credits += credits;
      rec.messages += 1;
      rec.lastAwardAt = at ?? now();
      if (name) rec.name = name;
      schedule();
      return rec.credits;
    },

    top(n) {
      return [...users.entries()]
        .map(([userId, rec]) => ({ userId, name: rec.name, credits: rec.credits }))
        .sort((a, b) => b.credits - a.credits || a.userId.localeCompare(b.userId))
        .slice(0, n);
    },

    all() {
      return [...users.entries()].map(([userId, rec]) => ({ userId, ...rec }));
    },

    async flush() {
      if (timer) {
        clearTimeoutImpl(timer);
        timer = null;
      }
      writing = writing.then(write);
      await writing;
    },

    async close() {
      await this.flush();
    },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/credits-store.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Break it on purpose and watch it go red**

Two mutations, because two different guarantees matter here:

1. In `load`, replace the `JSON.parse` catch body with `return new Map();` — the LU2 behaviour. Confirm the edit landed (`grep -n 'return new Map();' src/credits/store.js` shows two hits, not one) and that "a corrupt file refuses to start" FAILS. Restore.
2. In `write`, replace the `writeFile(tmp, …)` / `rename(…)` pair with `await writeFile(path, snapshot, 'utf8');`. Confirm the edit landed and that "writing leaves no temp file behind" still passes (it would — there is no temp file) but note this: **that test cannot catch this mutation.** Restore it, and accept that atomicity is verified by reading the code, not by a unit test. Record that limitation in the commit message rather than pretending the test proves it.

- [ ] **Step 6: Ignore the data file**

Credits are user data, not source. Add to `.gitignore` under the existing corpus block:

```
# Runtime state (per-user credit balances)
data/credits.json
data/credits.json.tmp
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: 365 pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add src/credits/store.js test/credits-store.test.js .gitignore
git commit -m "feat(credits): durable store for credit balances

The first state Lu keeps across a restart. Three of LU2's store
behaviours are defects and are fixed rather than ported: writes go to a
temp file and are renamed into place, a burst of awards is debounced
into one write, and a corrupt file stops the bot instead of silently
zeroing every balance.

Atomicity of the rename is verified by reading the code, not by a test
-- a unit test cannot kill the process mid-write.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Configuration

Follows the four-edit pattern the codebase already uses for a new setting, exactly as the `nickname` section did (`src/config.js:102-107`, `.env.example`, `test/config.test.js:161-175`).

**Files:**
- Modify: `src/config.js` (add a `credits` section to the object returned by `loadConfig`)
- Modify: `.env.example`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.credits` — `{ enabled: boolean, min: number, max: number, cooldownSeconds: number, minChars: number, announceLevelUp: boolean, flushMs: number }`

- [ ] **Step 1: Write the failing test**

Append to `test/config.test.js`:

```js
// --- Imperial Credits config ---
// Booleans follow the codebase's default-on idiom: only the literal string
// 'false' turns one off. Ranges throw at startup with the offending value,
// because a min above a max is a configuration error and should not wait to
// become a runtime surprise.

test('credits config defaults', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg.credits, {
    enabled: true,
    min: 15,
    max: 25,
    cooldownSeconds: 30,
    minChars: 3,
    announceLevelUp: true,
    flushMs: 2000,
  });
});

test('credits can be turned off', () => {
  assert.equal(loadConfig({ ...valid, CREDITS_ENABLED: 'false' }).credits.enabled, false);
});

test('level-up announcements can be turned off', () => {
  assert.equal(
    loadConfig({ ...valid, CREDITS_ANNOUNCE_LEVEL_UP: 'false' }).credits.announceLevelUp,
    false,
  );
});

test('credits award range is configurable', () => {
  const cfg = loadConfig({ ...valid, CREDITS_MIN: '5', CREDITS_MAX: '9' });
  assert.equal(cfg.credits.min, 5);
  assert.equal(cfg.credits.max, 9);
});

test('cooldown, minimum length and flush interval are configurable', () => {
  const cfg = loadConfig({
    ...valid,
    CREDITS_COOLDOWN_SECONDS: '60',
    CREDITS_MIN_CHARS: '1',
    CREDITS_FLUSH_MS: '500',
  });
  assert.equal(cfg.credits.cooldownSeconds, 60);
  assert.equal(cfg.credits.minChars, 1);
  assert.equal(cfg.credits.flushMs, 500);
});

test('a minimum above the maximum is rejected with both values', () => {
  assert.throws(
    () => loadConfig({ ...valid, CREDITS_MIN: '30', CREDITS_MAX: '20' }),
    /CREDITS_MIN.*30.*20|CREDITS_MIN.*20.*30/s,
  );
});

test('a negative cooldown is rejected', () => {
  assert.throws(() => loadConfig({ ...valid, CREDITS_COOLDOWN_SECONDS: '-1' }), /CREDITS_COOLDOWN_SECONDS/);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/config.test.js`
Expected: FAIL — `cfg.credits` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/config.js`, before the `return {` in `loadConfig`, add the validation block:

```js
  const credits = {
    enabled: (env.CREDITS_ENABLED ?? 'true') !== 'false',
    min: num(env, 'CREDITS_MIN', 15),
    max: num(env, 'CREDITS_MAX', 25),
    cooldownSeconds: num(env, 'CREDITS_COOLDOWN_SECONDS', 30),
    minChars: num(env, 'CREDITS_MIN_CHARS', 3),
    announceLevelUp: (env.CREDITS_ANNOUNCE_LEVEL_UP ?? 'true') !== 'false',
    flushMs: num(env, 'CREDITS_FLUSH_MS', 2000),
  };
  if (credits.min > credits.max) {
    throw new Error(`CREDITS_MIN must not exceed CREDITS_MAX (${credits.max}), got ${credits.min}`);
  }
  if (credits.min < 0) {
    throw new Error(`CREDITS_MIN must not be negative, got ${credits.min}`);
  }
  if (credits.cooldownSeconds < 0) {
    throw new Error(`CREDITS_COOLDOWN_SECONDS must not be negative, got ${credits.cooldownSeconds}`);
  }
  if (credits.minChars < 0) {
    throw new Error(`CREDITS_MIN_CHARS must not be negative, got ${credits.minChars}`);
  }
  if (credits.flushMs < 0) {
    throw new Error(`CREDITS_FLUSH_MS must not be negative, got ${credits.flushMs}`);
  }
```

Then add `credits,` as a key in the returned object, after the `nickname` section.

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/config.test.js`
Expected: PASS.

- [ ] **Step 5: Break it on purpose and watch it go red**

Change the default `15` to `10` in `min`. Confirm the edit landed and that "credits config defaults" FAILS. Restore. Then delete the `credits.min > credits.max` throw, confirm "a minimum above the maximum is rejected" FAILS, and restore.

- [ ] **Step 6: Document the settings**

Append to `.env.example`, matching the commented style of the existing `NICKNAME_*` block:

```
# --- Imperial Credits ---
# Members earn credits for taking part in chat; credits become a level.
# Master switch. Set to false to turn the ledger off entirely.
CREDITS_ENABLED=true
# Credits awarded per eligible message, picked uniformly from this range.
# MEE6's values, kept so a level here means what it means in other servers.
CREDITS_MIN=15
CREDITS_MAX=25
# Shortest gap between two paying messages from the same person. MEE6 uses 60;
# 30 suits a small server where conversation arrives in bursts.
CREDITS_COOLDOWN_SECONDS=30
# Messages shorter than this earn nothing.
CREDITS_MIN_CHARS=3
# Post a line in the channel when someone reaches a new level.
# Turn off if it gets noisy -- this is the only time Lu speaks unprompted.
CREDITS_ANNOUNCE_LEVEL_UP=true
# How long to wait after the last award before writing balances to disk.
CREDITS_FLUSH_MS=2000
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: 372 pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add src/config.js test/config.test.js .env.example
git commit -m "feat(credits): configuration

Follows the existing four-edit pattern for a new setting. Ranges throw at
startup with the offending value; a minimum above the maximum is a config
error, not a runtime surprise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The earning rule

Decides whether a message pays, how much, and whether it crossed a level. Deliberately has no knowledge of Discord — it takes the plain `entry` object the conversation layer already passes around.

**Files:**
- Create: `src/credits/earn.js`
- Test: `test/credits-earn.test.js`

**Interfaces:**
- Consumes: `levelFor` from `src/credits/levels.js`; a store with `get`/`award` from `src/credits/store.js`.
- Produces: `awardForMessage(store, entry, { now, random, config }) -> { awarded: number, total: number, leveledTo: number | null } | null` — `null` means the message earned nothing.

- [ ] **Step 1: Write the failing test**

Create `test/credits-earn.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awardForMessage } from '../src/credits/earn.js';

// A stand-in for the real store: the same four verbs, held in a Map. The real
// store is tested against the filesystem in credits-store.test.js; here the
// subject is the rule, not the persistence.
function fakeStore(seed = {}) {
  const users = new Map(Object.entries(seed));
  const empty = () => ({ credits: 0, name: '', lastAwardAt: 0, messages: 0, voiceSeconds: 0 });
  return {
    get: (id) => ({ ...(users.get(id) ?? empty()) }),
    award(id, { credits, name, at }) {
      const rec = users.get(id) ?? empty();
      rec.credits += credits;
      rec.lastAwardAt = at;
      rec.messages += 1;
      if (name) rec.name = name;
      users.set(id, rec);
      return rec.credits;
    },
  };
}

const entry = (over = {}) => ({
  authorId: 'u1', name: 'Bob', isBot: false, text: 'hello comrades', ...over,
});

const config = (over = {}) => ({
  credits: {
    enabled: true, min: 15, max: 25, cooldownSeconds: 30,
    minChars: 3, announceLevelUp: true, flushMs: 2000, ...over,
  },
});

// random() = 0 picks the bottom of the range, 0.999 the top. Injected rather
// than stubbed globally, so a test never depends on Math.random.
const lowest = () => 0;
const highest = () => 0.999;

// --- What earns ---

test('an ordinary message earns within the configured range', () => {
  const store = fakeStore();
  const got = awardForMessage(store, entry(), { now: () => 100000, random: lowest, config: config() });
  assert.equal(got.awarded, 15);
  assert.equal(got.total, 15);
  assert.equal(got.leveledTo, null);
});

test('the top of the range is reachable', () => {
  const store = fakeStore();
  const got = awardForMessage(store, entry(), { now: () => 100000, random: highest, config: config() });
  assert.equal(got.awarded, 25);
});

test('a bot message earns nothing', () => {
  const store = fakeStore();
  assert.equal(
    awardForMessage(store, entry({ isBot: true }), { now: () => 100000, random: lowest, config: config() }),
    null,
  );
});

test('a message below the minimum length earns nothing', () => {
  const store = fakeStore();
  assert.equal(
    awardForMessage(store, entry({ text: 'k' }), { now: () => 100000, random: lowest, config: config() }),
    null,
  );
});

test('whitespace is not length', () => {
  const store = fakeStore();
  assert.equal(
    awardForMessage(store, entry({ text: '   \n  ' }), { now: () => 100000, random: lowest, config: config() }),
    null,
  );
});

test('nothing is awarded when the ledger is switched off', () => {
  const store = fakeStore();
  assert.equal(
    awardForMessage(store, entry(), { now: () => 100000, random: lowest, config: config({ enabled: false }) }),
    null,
  );
});

// --- Cooldown ---

test('a second message inside the cooldown earns nothing', () => {
  const store = fakeStore({ u1: { credits: 15, name: 'Bob', lastAwardAt: 100000, messages: 1, voiceSeconds: 0 } });
  assert.equal(
    awardForMessage(store, entry(), { now: () => 129999, random: lowest, config: config() }),
    null,
  );
});

test('a message exactly on the cooldown boundary earns', () => {
  const store = fakeStore({ u1: { credits: 15, name: 'Bob', lastAwardAt: 100000, messages: 1, voiceSeconds: 0 } });
  const got = awardForMessage(store, entry(), { now: () => 130000, random: lowest, config: config() });
  assert.equal(got.awarded, 15);
  assert.equal(got.total, 30);
});

// The bug found in Polaris's changelog: a message that awarded nothing still
// consumed the cooldown window, so the next message that should have paid did
// not. Only a message that actually pays may move the clock.
test('an ineligible message does not move the cooldown clock', () => {
  const store = fakeStore({ u1: { credits: 15, name: 'Bob', lastAwardAt: 100000, messages: 1, voiceSeconds: 0 } });
  awardForMessage(store, entry({ text: 'k' }), { now: () => 200000, random: lowest, config: config() });
  assert.equal(store.get('u1').lastAwardAt, 100000);
});

// --- Levelling ---

test('crossing a level is reported once, with the new level', () => {
  const store = fakeStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 5, voiceSeconds: 0 } });
  const got = awardForMessage(store, entry(), { now: () => 100000, random: lowest, config: config() });
  assert.equal(got.total, 105);
  assert.equal(got.leveledTo, 1);
});

test('staying inside a level reports no level-up', () => {
  const store = fakeStore({ u1: { credits: 50, name: 'Bob', lastAwardAt: 0, messages: 5, voiceSeconds: 0 } });
  const got = awardForMessage(store, entry(), { now: () => 100000, random: lowest, config: config() });
  assert.equal(got.leveledTo, null);
});

test('the display name is passed through to the store', () => {
  const store = fakeStore();
  awardForMessage(store, entry({ name: 'COMRADE STONE' }), { now: () => 100000, random: lowest, config: config() });
  assert.equal(store.get('u1').name, 'COMRADE STONE');
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/credits-earn.test.js`
Expected: FAIL — `Cannot find module '../src/credits/earn.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/credits/earn.js`:

```js
import { levelFor } from './levels.js';

// Returns null when the message earns nothing, so the caller can treat "no
// award" as one condition rather than inspecting a zero.
//
// Commands need no rule here: `lu explain`, `lu credits` and `lu leaderboard`
// all early-return in conversation.handleMessage before awarding is reached,
// so asking for your balance structurally cannot pay you.
export function awardForMessage(store, entry, { now, random, config }) {
  const rules = config.credits;
  if (!rules?.enabled) return null;
  if (entry.isBot) return null;
  if (entry.text.trim().length < rules.minChars) return null;

  const at = now();
  const before = store.get(entry.authorId);
  // Only a paying message moves the clock, checked before any award: an
  // ineligible message that consumed the cooldown would silently swallow the
  // next message that should have paid.
  if (at - before.lastAwardAt < rules.cooldownSeconds * 1000) return null;

  const span = rules.max - rules.min + 1;
  const awarded = rules.min + Math.floor(random() * span);
  const total = store.award(entry.authorId, { credits: awarded, name: entry.name, at });

  const after = levelFor(total);
  return { awarded, total, leveledTo: after > levelFor(before.credits) ? after : null };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/credits-earn.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Break it on purpose and watch it go red**

Move the cooldown check to *after* the `store.award` call. Confirm the edit landed and that "a second message inside the cooldown earns nothing" FAILS. Restore. Then change `<` to `<=` in the cooldown comparison, confirm "a message exactly on the cooldown boundary earns" FAILS, and restore.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: 385 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/credits/earn.js test/credits-earn.test.js
git commit -m "feat(credits): the earning rule

15-25 credits per eligible message on a 30s per-user cooldown. Only a
paying message moves the cooldown clock -- the bug found in Polaris's
changelog, where an ineligible message consumed the window and swallowed
the next message that should have paid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Expose mentioned users on the entry

**This task exists because of a defect found while planning, not from the spec.** `toEntry` (`src/discord.js:12-38`) renders mention tags into `@DisplayName` text and computes `mentionedIds` locally but never exposes them — the entry carries only the booleans `mentionsLu` and `mentionsOthers`. Without this, `lu credits @someone` has no way to identify who was meant, and would silently report the asker's own balance instead.

**Files:**
- Modify: `src/discord.js` (`toEntry`)
- Test: `test/discord.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `entry.mentions` — `[{ id: string, name: string }]`, in the order Discord listed them, Lu included. Existing fixtures without `mentionedUsers` produce `[]`.
  - `entry.luId` — Lu's own user ID, so downstream code can tell which mention is Lu without `botId` being threaded through `createConversation`.

- [ ] **Step 1: Write the failing test**

Append to `test/discord.test.js`:

```js
// --- Mentioned users on the entry ---
// toEntry renders mention tags to "@DisplayName" so a bare "@Lu" message is
// never empty (the model server rejects empty content with a 400). That
// rendering destroys the IDs, which "lu credits @someone" needs to know who
// was meant. Both are carried: the rendered text for the model, the ids for
// code.

test('mentioned users are carried on the entry with their ids', () => {
  const entry = toEntry(view({
    content: 'lu credits <@42>',
    mentionedUsers: [{ id: '42', displayName: 'Bob' }],
  }), { botId: 'bot' });
  assert.deepEqual(entry.mentions, [{ id: '42', name: 'Bob' }]);
  assert.equal(entry.text, 'lu credits @Bob');
});

test('a message mentioning nobody carries an empty list', () => {
  assert.deepEqual(toEntry(view({ content: 'hello' }), { botId: 'bot' }).mentions, []);
});

test('Lu is listed among the mentions like anyone else', () => {
  const entry = toEntry(view({
    content: '<@bot> hello',
    mentionedUsers: [{ id: 'bot', displayName: 'Lu' }],
  }), { botId: 'bot' });
  assert.deepEqual(entry.mentions, [{ id: 'bot', name: 'Lu' }]);
});

// Carried so downstream code can tell which mention is Lu. The alternative
// was threading botId through createConversation, which every other consumer
// would have had to accept and ignore.
test('the entry knows Lu\'s own id', () => {
  assert.equal(toEntry(view({ content: 'hello' }), { botId: 'bot' }).luId, 'bot');
});
```

Note: `view` is the existing local factory at `test/discord.test.js:13-16`. If its default has no `mentionedUsers` key, add `mentionedUsers: []` to the factory's defaults in the same edit.

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/discord.test.js`
Expected: FAIL — `entry.mentions` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/discord.js`, inside `toEntry`, add to the returned object (after `mentionsOthers`):

```js
    // The rendered text above loses the ids, which "lu credits @someone" needs
    // to know who was meant. Carried separately rather than parsed back out of
    // the text: a display name is not a key and two members can share one.
    mentions: view.mentionedUsers.map((u) => ({ id: u.id, name: u.displayName })),
    // Which of those mentions is Lu. Carried on the entry rather than threaded
    // through createConversation, which every other consumer would have had to
    // accept and ignore.
    luId: botId,
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/discord.test.js`
Expected: PASS.

- [ ] **Step 5: Break it on purpose and watch it go red**

Change the mapping to `mentions: []`. Confirm the edit landed and that the first and third new tests FAIL. Restore. Then change `luId: botId` to `luId: null`, confirm "the entry knows Lu's own id" FAILS, and restore.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: 389 pass, 0 fail. Any pre-existing test that asserts on the whole entry object with `deepEqual` will now fail on the extra key — update those fixtures rather than dropping the field, and say in the commit message which ones changed.

- [ ] **Step 7: Commit**

```bash
git add src/discord.js test/discord.test.js
git commit -m "feat(discord): carry mentioned user ids on the message entry

toEntry renders mention tags to @DisplayName so a bare @Lu message is
never empty, which destroys the ids. 'lu credits @someone' needs them to
know who was meant, and a display name is not a key -- two members can
share one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Commands and wording

Whole-message anchored regexes, mirroring `EXPLAIN_RE`'s deliberate strictness (`src/decisions.js:6`), which is written so "lu explain why you hate cats" stays conversation.

**The strings below are a proposal, not a settled decision.** They are user-facing copy in Lu's voice, and copy is the user's call. Show them the rendered output before moving to Task 7 and change whatever he wants.

**Files:**
- Create: `src/credits/commands.js`
- Test: `test/credits-commands.test.js`

**Interfaces:**
- Consumes: `progress` from `src/credits/levels.js`.
- Produces:
  - `CREDITS_RE: RegExp`, `LEADERBOARD_RE: RegExp`
  - `resolveTarget(entry, botId) -> { id, name } | null` — the first mentioned non-Lu user, or `null` meaning "the asker"
  - `formatCredits({ name, credits }) -> string`
  - `formatLeaderboard(rows: [{ userId, name, credits }]) -> string`
  - `formatLevelUp({ name, level }) -> string`
  - `creditsInstruction({ name, credits }) -> string` — the persona fragment, used in Task 8
  - `EMPTY_LEADERBOARD: string`

- [ ] **Step 1: Write the failing test**

Create `test/credits-commands.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDITS_RE, LEADERBOARD_RE, resolveTarget,
  formatCredits, formatLeaderboard, formatLevelUp, creditsInstruction,
  EMPTY_LEADERBOARD,
} from '../src/credits/commands.js';

// --- Anchoring ---
// Matched as "lu explain" is: only the command itself, so a message that
// merely talks about credits stays conversation and reaches the model.

test('the credits command matches its forms', () => {
  assert.ok(CREDITS_RE.test('lu credits'));
  assert.ok(CREDITS_RE.test('Lu, credits'));
  assert.ok(CREDITS_RE.test('  lu credits  '));
  assert.ok(CREDITS_RE.test('lu credits?'));
  assert.ok(CREDITS_RE.test('lu credits @Bob'));
  assert.ok(CREDITS_RE.test('lu credits @COMRADE STONE'));
});

test('talking about credits is conversation, not a command', () => {
  assert.ok(!CREDITS_RE.test('lu credits are a stupid idea'));
  assert.ok(!CREDITS_RE.test('how many credits do i have'));
  assert.ok(!CREDITS_RE.test('lu, what are imperial credits'));
});

test('the leaderboard command matches only itself', () => {
  assert.ok(LEADERBOARD_RE.test('lu leaderboard'));
  assert.ok(LEADERBOARD_RE.test('Lu: leaderboard!'));
  assert.ok(!LEADERBOARD_RE.test('lu leaderboard is wrong'));
});

// --- Target resolution ---

test('no mention means the asker', () => {
  assert.equal(resolveTarget({ mentions: [] }, 'bot'), null);
});

test('a mentioned member is the target', () => {
  assert.deepEqual(
    resolveTarget({ mentions: [{ id: '42', name: 'Bob' }] }, 'bot'),
    { id: '42', name: 'Bob' },
  );
});

// Saying "lu credits @Lu" is asking Lu about himself, not about you. Skipping
// Lu and falling through to the asker would answer a different question than
// the one asked.
test('mentioning Lu alone still resolves to Lu, not the asker', () => {
  assert.deepEqual(
    resolveTarget({ mentions: [{ id: 'bot', name: 'Lu' }] }, 'bot'),
    { id: 'bot', name: 'Lu' },
  );
});

test('with Lu and a member mentioned, the member wins', () => {
  assert.deepEqual(
    resolveTarget({ mentions: [{ id: 'bot', name: 'Lu' }, { id: '42', name: 'Bob' }] }, 'bot'),
    { id: '42', name: 'Bob' },
  );
});

// --- Formatting ---
// Every number shown is one we hold. Nothing is estimated, rounded up, or
// invented; somebody with no record reads as zero, which is true.

test('a balance shows credits, level and what is left to the next', () => {
  const out = formatCredits({ name: 'Bob', credits: 1200 });
  assert.match(out, /Bob/);
  assert.match(out, /1,200/);
  assert.match(out, /level 5/);
  assert.match(out, /425/); // 475 needed for level 5, 50 into it
});

test('someone with no record reads as zero, not as missing', () => {
  const out = formatCredits({ name: 'Ann', credits: 0 });
  assert.match(out, /Ann/);
  assert.match(out, /0 imperial credits/);
  assert.match(out, /level 0/);
});

test('the leaderboard is numbered, ordered and shows levels', () => {
  const out = formatLeaderboard([
    { userId: 'a', name: 'Ann', credits: 4675 },
    { userId: 'b', name: 'Bob', credits: 1150 },
  ]);
  assert.match(out, /1\. Ann/);
  assert.match(out, /2\. Bob/);
  assert.match(out, /4,675/);
  assert.match(out, /level 10/);
  assert.ok(out.indexOf('Ann') < out.indexOf('Bob'));
});

test('an empty leaderboard says so rather than showing nothing', () => {
  assert.equal(formatLeaderboard([]), EMPTY_LEADERBOARD);
});

// A member who has earned credits but whose display name was never captured
// is shown by id. Inventing a name would be fabricating data.
test('a missing name falls back to the id', () => {
  const out = formatLeaderboard([{ userId: '9911', name: '', credits: 100 }]);
  assert.match(out, /9911/);
});

test('a level-up names the person and the level', () => {
  const out = formatLevelUp({ name: 'Bob', level: 3 });
  assert.match(out, /Bob/);
  assert.match(out, /level 3/);
});

// --- Persona fragment ---
// Lu is told the number so he can needle the asker about it, and told plainly
// that he cannot change it. LU2 chose this over a marker the model emits, and
// that is right for a number: a model that can emit a credit marker can
// fabricate a balance.

test('the persona fragment carries the number and forbids changing it', () => {
  const out = creditsInstruction({ name: 'Bob', credits: 1200 });
  assert.match(out, /Bob/);
  assert.match(out, /1,200/);
  assert.match(out, /level 5/);
  assert.match(out, /never|not|cannot|don't/i);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/credits-commands.test.js`
Expected: FAIL — `Cannot find module '../src/credits/commands.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/credits/commands.js`:

```js
import { progress } from './levels.js';

// Anchored as EXPLAIN_RE is (src/decisions.js:6): only the command itself,
// optionally naming someone, so "lu credits are a stupid idea" stays
// conversation and reaches the model. The trailing "@..." is loose because a
// rendered display name can contain spaces -- "@COMRADE STONE" is one member.
export const CREDITS_RE = /^\s*lu[\s,:]+credits\b\s*(?:@.*?)?\s*[!.?]*\s*$/i;
export const LEADERBOARD_RE = /^\s*lu[\s,:]+leaderboard\b\s*[!.?]*\s*$/i;

export const EMPTY_LEADERBOARD = 'the ledger is empty. nobody has earned anything yet.';

const n = (x) => x.toLocaleString('en-GB');

// Lu included: "lu credits @Lu" asks about Lu, and answering about the asker
// instead would answer a question nobody asked.
export function resolveTarget(entry, botId) {
  const others = entry.mentions.filter((m) => m.id !== botId);
  return others[0] ?? entry.mentions[0] ?? null;
}

export function formatCredits({ name, credits }) {
  const { level, into, needed } = progress(credits);
  return `the ledger says ${name} holds ${n(credits)} imperial credits. level ${level}. ${n(needed - into)} more before level ${level + 1}.`;
}

export function formatLeaderboard(rows) {
  if (rows.length === 0) return EMPTY_LEADERBOARD;
  const lines = rows.map((r, i) => {
    // A member who earned credits before his display name was ever captured
    // is shown by id. Inventing a name would be fabricating data.
    const who = r.name || r.userId;
    return `${i + 1}. ${who} — ${n(r.credits)} (level ${progress(r.credits).level})`;
  });
  return ['the imperial ledger, highest first:', ...lines].join('\n');
}

export function formatLevelUp({ name, level }) {
  return `${name} reaches level ${level}. the ledger notes it.`;
}

// Read-only context. Deterministic scoring in code, generative commentary from
// the model -- LU2's SOCIAL_CREDIT_AWARENESS_TEMPLATE (bot.py:182-192), which
// is what made the original bit work. Note the codebase contains both patterns
// and this one is chosen on purpose: nicknames let the model emit a marker
// code acts on, but a model that can emit a credit marker can fabricate a
// balance.
export function creditsInstruction({ name, credits }) {
  const { level } = progress(credits);
  return [
    `You keep a ledger of imperial credits. ${name}, who is speaking to you now, holds ${n(credits)} imperial credits and is level ${level}.`,
    'You may reference it, mock them over it, or praise them for it wherever that fits naturally. Do not force it into every reply.',
    'You cannot change anyone\'s credits and you never announce a change. The ledger is kept elsewhere; you only read it. Never state a number other than the one given above.',
  ].join(' ');
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/credits-commands.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Break it on purpose and watch it go red**

Change `CREDITS_RE` to drop the trailing `$` anchor. Confirm the edit landed and that "talking about credits is conversation" FAILS. Restore.

- [ ] **Step 6: Show the wording to the user before going further**

Print one of each message and put them in front of the user:

```bash
node --input-type=module -e "
import { formatCredits, formatLeaderboard, formatLevelUp } from './src/credits/commands.js';
console.log(formatCredits({ name: 'COMRADE STONE', credits: 1200 }));
console.log(formatCredits({ name: 'Ann', credits: 0 }));
console.log(formatLevelUp({ name: 'Bob', level: 3 }));
console.log(formatLeaderboard([
  { userId: 'a', name: 'Ann', credits: 4675 },
  { userId: 'b', name: 'Bob', credits: 1150 },
  { userId: 'c', name: '', credits: 90 },
]));
"
```

This is user-facing copy in Lu's voice. Do not proceed to Task 7 until the user has seen it and either approved it or given replacement wording.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: 403 pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add src/credits/commands.js test/credits-commands.test.js
git commit -m "feat(credits): commands, wording and the persona fragment

Regexes anchored as 'lu explain' is, so talking about credits stays
conversation. Mentions resolve by id, not by display name -- two members
can share a name. A member with no captured name shows as an id rather
than an invented one.

The persona fragment gives the model the number as read-only context and
forbids it announcing a change: a model that can emit a credit marker can
fabricate a balance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire into the conversation

`conversation.handleMessage` (`src/conversation.js:296`) is already the orchestrator and is where this belongs. `src/discord.js` needs nothing further — its single `MessageCreate` listener already delivers everything.

**Files:**
- Modify: `src/conversation.js`
- Test: `test/conversation.test.js`

**Interfaces:**
- Consumes: `awardForMessage` (Task 4); `CREDITS_RE`, `LEADERBOARD_RE`, `resolveTarget`, `formatCredits`, `formatLeaderboard`, `formatLevelUp` (Task 6); a store (Task 2).
- Produces: `createConversation({ …, credits })` — `credits` is the store, or `null`/absent when the ledger is off. When absent, behaviour is byte-identical to today.

- [ ] **Step 1: Write the failing test**

Append to `test/conversation.test.js`, reusing whatever local factories the file already defines for `entry`, `io` and `config`:

```js
// --- Imperial Credits ---
// Awarding sits outside the reply pipeline, which is the structural lesson
// from LU2 (bot.py:347-348): credit accrues from taking part, not from getting
// Lu's attention. Commands early-return before awarding, so asking for your
// balance cannot pay you.

function creditsStore(seed = {}) {
  const users = new Map(Object.entries(seed));
  const empty = () => ({ credits: 0, name: '', lastAwardAt: 0, messages: 0, voiceSeconds: 0 });
  return {
    get: (id) => ({ ...(users.get(id) ?? empty()) }),
    award(id, { credits, name, at }) {
      const rec = users.get(id) ?? empty();
      rec.credits += credits;
      rec.lastAwardAt = at;
      rec.messages += 1;
      if (name) rec.name = name;
      users.set(id, rec);
      return rec.credits;
    },
    top: (k) => [...users.entries()]
      .map(([userId, r]) => ({ userId, name: r.name, credits: r.credits }))
      .sort((a, b) => b.credits - a.credits || a.userId.localeCompare(b.userId))
      .slice(0, k),
  };
}

test('an ordinary message earns credits', async () => {
  const store = creditsStore();
  const { conversation, io } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({ text: 'hello comrades', authorId: 'u1' }), io);
  assert.ok(store.get('u1').credits >= 15);
});

test('asking for your balance earns nothing', async () => {
  const store = creditsStore();
  const { conversation, io } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({ text: 'lu credits', authorId: 'u1' }), io);
  assert.equal(store.get('u1').credits, 0);
});

test('asking for your balance replies with it and stops', async () => {
  const store = creditsStore({ u1: { credits: 1200, name: 'Bob', lastAwardAt: 0, messages: 9, voiceSeconds: 0 } });
  const { conversation, io, sent } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({ text: 'lu credits', authorId: 'u1', name: 'Bob' }), io);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /1,200/);
  assert.match(sent[0], /level 5/);
});

test('a mentioned member reads as that member, not the asker', async () => {
  const store = creditsStore({ u2: { credits: 300, name: 'Ann', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const { conversation, io, sent } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({
    text: 'lu credits @Ann', authorId: 'u1', name: 'Bob',
    mentions: [{ id: 'u2', name: 'Ann' }],
  }), io);
  assert.match(sent[0], /Ann/);
  assert.match(sent[0], /300/);
});

test('the leaderboard replies and stops', async () => {
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const { conversation, io, sent } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({ text: 'lu leaderboard', authorId: 'u1' }), io);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /1\. Bob/);
});

test('a bot message earns nothing', async () => {
  const store = creditsStore();
  const { conversation, io } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({ text: 'hello comrades', authorId: 'u1', isBot: true }), io);
  assert.equal(store.get('u1').credits, 0);
});

test('crossing a level posts a line in the channel', async () => {
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const { conversation, io, sent } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({ text: 'hello comrades', authorId: 'u1', name: 'Bob' }), io);
  assert.ok(sent.some((s) => /level 1/.test(s)));
});

test('level-up announcements can be turned off', async () => {
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const { conversation, io, sent } = buildConversation({
    credits: store,
    configOver: { credits: { enabled: true, min: 15, max: 25, cooldownSeconds: 30, minChars: 3, announceLevelUp: false, flushMs: 2000 } },
  });
  await conversation.handleMessage(entry({ text: 'hello comrades', authorId: 'u1', name: 'Bob' }), io);
  assert.ok(!sent.some((s) => /reaches level/.test(s)));
  assert.ok(store.get('u1').credits >= 105);
});

// Roughly 350 tests predate this feature and build config objects with no
// credits section. None of them may break.
test('with no store and no credits config, nothing changes', async () => {
  const { conversation, io } = buildConversation({});
  await conversation.handleMessage(entry({ text: 'hello comrades', authorId: 'u1' }), io);
  // No throw is the assertion.
});
```

If `test/conversation.test.js` has no `buildConversation` helper, add one in the same edit: it constructs `createConversation` with the file's existing stubs, accepts `{ credits, configOver }`, and returns `{ conversation, io, sent }` where `sent` collects every `io.send` argument.

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/conversation.test.js`
Expected: FAIL — no credits are awarded and no command is answered.

- [ ] **Step 3: Write the implementation**

In `src/conversation.js`:

Add the imports:

```js
import { awardForMessage } from './credits/earn.js';
import {
  CREDITS_RE, LEADERBOARD_RE, resolveTarget,
  formatCredits, formatLeaderboard, formatLevelUp,
} from './credits/commands.js';
```

Add `credits = null` to the `createConversation` destructured parameters, after `isAddressed`.

In `handleMessage`, immediately after the existing `lu explain` block (`src/conversation.js:301-306`) and before `history.record(entry)`:

```js
    // Commands answer and stop, exactly as "lu explain" does: a command is not
    // conversation and must not enter the prompt. This ordering is also what
    // stops a command paying its own asker -- awarding is below it.
    if (credits && config.credits?.enabled && !entry.isBot) {
      if (LEADERBOARD_RE.test(entry.text)) {
        await safeSend(state, formatLeaderboard(credits.top(10)));
        return;
      }
      if (CREDITS_RE.test(entry.text)) {
        const target = resolveTarget(entry, entry.luId);
        const who = target ?? { id: entry.authorId, name: entry.name };
        await safeSend(state, formatCredits({ name: who.name, credits: credits.get(who.id).credits }));
        return;
      }

      // Outside the reply pipeline on purpose (LU2, bot.py:347-348): credit
      // accrues from taking part, not from getting Lu's attention.
      const award = awardForMessage(credits, entry, { now, random, config });
      if (award?.leveledTo !== null && award !== null && config.credits.announceLevelUp) {
        await safeSend(state, formatLevelUp({ name: entry.name, level: award.leveledTo }));
      }
    }
```

Note the `botId` argument: `createConversation` has no knowledge of Lu's user ID, which is why Task 5 put `luId` on the entry. Use `resolveTarget(entry, entry.luId)` in the block above — not a `botId` variable, which does not exist in this scope.

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/conversation.test.js`
Expected: PASS.

- [ ] **Step 5: Break it on purpose and watch it go red**

Move the awarding block *above* the command checks. Confirm the edit landed and that "asking for your balance earns nothing" FAILS. Restore. Then delete the `config.credits.announceLevelUp` condition, confirm "level-up announcements can be turned off" FAILS, and restore.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: 412 pass, 0 fail. If any pre-existing conversation test fails, the cause is almost certainly a config fixture without a `credits` section reaching a non-optional read — fix the read, not the fixture.

- [ ] **Step 7: Commit**

```bash
git add src/conversation.js src/credits/commands.js src/discord.js test/conversation.test.js test/discord.test.js
git commit -m "feat(credits): wire commands and awarding into the conversation

Awarding sits outside the reply pipeline -- credit accrues from taking
part, not from getting Lu's attention. Commands early-return above it, so
asking for your balance structurally cannot pay you, and a test asserts
that so a future reordering cannot quietly reintroduce paid commands.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Persona awareness

The one part of this that is not a mechanical port. `respondWithReason` takes a single `extraInstruction` string (`src/conversation.js:173`), currently used only by the nickname feature. It must now compose from more than one source — and when there is nothing to add it must still pass `undefined`, because `buildMessages` (`src/responder.js:31-33`) branches on it and an ordinary reply's system message has to stay byte-identical.

**Files:**
- Modify: `src/conversation.js`
- Test: `test/conversation.test.js`

**Interfaces:**
- Consumes: `creditsInstruction` from `src/credits/commands.js` (Task 6).
- Produces: no new exports; `extraInstruction` becomes a joined list.

- [ ] **Step 1: Write the failing test**

Append to `test/conversation.test.js`:

```js
// --- Composing extra instructions ---
// buildMessages branches on extraInstruction being undefined, and an ordinary
// reply's system message must stay byte-identical to what it was before this
// feature. An empty string is not undefined.

test('an ordinary reply still passes no extra instruction', async () => {
  const { conversation, io, calls } = buildConversation({});
  await conversation.handleMessage(entry({ text: 'lu what do you think', mentionsLu: true }), io);
  assert.equal(calls.respond[0].extraInstruction, undefined);
});

test('with a store, the reply carries the speaker\'s balance', async () => {
  const store = creditsStore({ u1: { credits: 1200, name: 'Bob', lastAwardAt: 0, messages: 9, voiceSeconds: 0 } });
  const { conversation, io, calls } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({ text: 'lu what do you think', authorId: 'u1', name: 'Bob', mentionsLu: true }), io);
  assert.match(calls.respond[0].extraInstruction, /1,2\d\d imperial credits/);
});

test('a rename request and the balance are both carried', async () => {
  const store = creditsStore({ u1: { credits: 1200, name: 'Bob', lastAwardAt: 0, messages: 9, voiceSeconds: 0 } });
  const { conversation, io, calls } = buildConversation({ credits: store });
  await conversation.handleMessage(entry({
    text: 'lu change your name to Stone', authorId: 'u1', name: 'Bob',
    mentionsLu: true, inGuild: true, authorCanManageNicknames: true,
  }), io);
  const instruction = calls.respond[0].extraInstruction;
  assert.match(instruction, /imperial credits/);
  assert.match(instruction, /NICKNAME/);
});
```

`buildConversation` must expose `calls.respond` — the array of argument objects `respondWithReason` was called with. Extend the helper in the same edit if it does not already.

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/conversation.test.js`
Expected: FAIL — the balance is not in the instruction.

- [ ] **Step 3: Write the implementation**

Add the import in `src/conversation.js`:

```js
import { creditsInstruction } from './credits/commands.js';
```

In `reply`, replace the single-expression `extraInstruction` (`src/conversation.js:173`) with a composed list. Above the `respondWithReason` call:

```js
      // Composed rather than a single expression: this used to be nickname-only,
      // and the next feature that wants a fragment should not have to add a
      // third parameter. Stays undefined when there is nothing to add --
      // buildMessages branches on it and an ordinary reply's system message
      // must stay byte-identical to what it was before credits existed.
      const instructions = [];
      if (asksRename && !asksReset) instructions.push(NICKNAME_INSTRUCTION);
      if (credits && config.credits?.enabled) {
        instructions.push(creditsInstruction({
          name: entry.name,
          credits: credits.get(entry.authorId).credits,
        }));
      }
```

and pass:

```js
            extraInstruction: instructions.length > 0 ? instructions.join('\n\n') : undefined,
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/conversation.test.js`
Expected: PASS.

- [ ] **Step 5: Break it on purpose and watch it go red**

Change the final expression to `instructions.join('\n\n')` with no length guard, so an empty list yields `''`. Confirm the edit landed and that "an ordinary reply still passes no extra instruction" FAILS. Restore.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: 415 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/conversation.js test/conversation.test.js
git commit -m "feat(credits): tell Lu the speaker's balance, read-only

extraInstruction was nickname-only and is now composed from a list, so
the next feature needing a fragment does not add a third parameter. It
stays undefined when empty: buildMessages branches on it and an ordinary
reply's system message must not change.

Scoring stays deterministic in code; only the commentary is generative.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Build the store at startup, and flush on shutdown

Without the shutdown flush, up to `CREDITS_FLUSH_MS` of awards are lost every time the service restarts — and on the mini it is restarted by `launchctl`, which sends `SIGTERM`.

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `createCreditStore` (Task 2); `createConversation({ credits })` (Task 7).
- Produces: nothing importable. `src/index.js` is the composition root and has no tests — it is verified by the live check in Task 10.

- [ ] **Step 1: Add the store to the composition root**

In `src/index.js`, add the import beside the other `./credits/` -free imports:

```js
import { createCreditStore } from './credits/store.js';
```

After the corpus is loaded (`src/index.js:34`), build the store against the same `projectRoot`-resolved `data` directory — resolved against the module, not the process working directory, because under `launchd` the cwd is not the repo root:

```js
// Resolved against the module for the same reason the corpus is: under
// launchd the working directory is not the repo root.
const creditStore = config.credits.enabled
  ? await createCreditStore({ dir: join(projectRoot, 'data'), flushMs: config.credits.flushMs })
  : null;

if (creditStore) {
  console.log(`Credit ledger loaded: ${creditStore.all().length} members.`);
}
```

Pass it into `createConversation` (`src/index.js:66-80`) by adding `credits: creditStore,` to the object.

- [ ] **Step 2: Flush on shutdown**

After the `startBot` call, add:

```js
// launchd stops the service with SIGTERM. Without this, every restart loses up
// to CREDITS_FLUSH_MS of awards -- small, but silent, and it would look like
// the ledger was randomly forgetting things.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    try {
      await creditStore?.close();
    } catch (err) {
      console.error('Failed to flush the credit ledger on shutdown:', err);
    }
    process.exit(0);
  });
}
```

- [ ] **Step 3: Verify it starts and the file appears**

The composition root has no unit tests, so this is checked by running it. With a `.env` that has a valid token, start the bot, confirm the startup line prints, stop it with Ctrl-C, and confirm the file exists and parses:

```bash
npm start
```

Then, after stopping:

```bash
cat data/credits.json
```

Expected: valid JSON with `"version": 1`. If the bot cannot reach Discord in this environment, note that and defer this step to the live check in Task 10 rather than marking it done.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: 415 pass, 0 fail — no new tests, nothing broken.

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat(credits): build the ledger at startup, flush it on shutdown

launchd stops the service with SIGTERM; without the flush every restart
silently drops up to CREDITS_FLUSH_MS of awards, which would look like
the ledger randomly forgetting things.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Verification

Nothing here is reported as working that has not been run and observed. A passing unit test for the store is not evidence that the deployed bot reloads its file.

**Files:**
- Create: `docs/superpowers/specs/2026-09-13-imperial-credits-verification.md`
- Modify: `.agents/STATUS.md`, `.agents/DECISIONS.md`

- [ ] **Step 1: Full suite on the development machine**

Run: `npm test`
Record the exact totals from the output. Expected: 415 pass, 0 fail. If the number differs from 414, work out why before continuing — an unexplained count means a test file is not being discovered.

- [ ] **Step 2: Full suite on the mini**

Deploy by rsync as `D9` in `.agents/DECISIONS.md` records (the mini has no working git), then run `npm test` there and record the totals. The mini is the machine that matters; a suite that passes only on the MacBook proves nothing about the deployment.

- [ ] **Step 3: Live check in `#lu-bot-chat`**

Work through every item and record the actual observed output beside it, not a prediction:

- [ ] An ordinary message earns credits — check with `lu credits` before and after.
- [ ] A second message within 30 seconds earns nothing.
- [ ] A message after 30 seconds earns again.
- [ ] A one-character message earns nothing.
- [ ] `lu credits` reports a balance, a level, and the gap to the next level.
- [ ] `lu credits` itself earned nothing — the number is unchanged from the line before.
- [ ] `lu credits @someone` reports that member, not the asker.
- [ ] `lu leaderboard` is ordered highest first.
- [ ] A level-up line appears in the channel when a level is crossed.
- [ ] "lu credits are a stupid idea" gets a conversational reply, not a balance.
- [ ] Lu references someone's credits unprompted at least once in ordinary conversation, and the number he says matches the ledger.

- [ ] **Step 4: The restart check**

This is the step that matters. Persistence is the only genuinely new capability in this work.

```bash
# on the mini
launchctl kickstart -k gui/$(id -u)/<the lu-bot service label>
```

Then in Discord, `lu credits`. The balance must be exactly what it was before the restart. Record both numbers.

- [ ] **Step 5: Fault injection**

Prove the failure paths rather than assuming them:

- [ ] Corrupt `data/credits.json` (truncate it mid-object), restart, and confirm the bot **refuses to start** and names the file in the log — rather than starting with everyone on zero. Restore the file from a copy taken first.
- [ ] Move `data/credits.json` away entirely, restart, and confirm the bot starts clean with an empty ledger and no error.

- [ ] **Step 6: Write the verification document**

Create `docs/superpowers/specs/2026-09-13-imperial-credits-verification.md` walking the design spec section by section, saying for each requirement whether it is met, dropped, or changed meaning during implementation — and naming the reason. Include the two discoveries this plan already knows about: the entry carried no mention IDs (Task 5), and the atomicity of the store's rename is verified by reading the code rather than by a test.

- [ ] **Step 7: Update project memory**

In `.agents/STATUS.md`, replace the stage-2-to-4 note with the real state of this work, and correct the stale 167-test figure. In `.agents/DECISIONS.md`, append a dated block recording the decisions the user actually took: two separate scores rather than one; Imperial Credits built first with Social Credit deferred to its own spec; MEE6's curve with a 30-second cooldown rather than 60; regex commands rather than slash commands; plain text rather than embeds; flat JSON rather than `node:sqlite`; no role rewards in this stage; voice credits as phase 2.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-09-13-imperial-credits-verification.md .agents/STATUS.md .agents/DECISIONS.md
git commit -m "docs: verification walk and project state for Imperial Credits

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Report, do not conclude**

Report the observed results — suite totals from both machines, each live-check item with what was actually seen, and anything that failed or could not be checked. State plainly what was not verified and why. The user decides whether this is finished.

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: module layout → 1, 2, 4, 6; `levels.js` → 1; `store.js` and the on-disk shape → 2; the three departures from LU2 → 2; earning rules → 4; where it hooks in → 7; commands and output → 6, 7; persona awareness → 8; configuration → 3; testing and the done-condition → every task's step 5 plus Task 10; risks → carried into Task 10's fault injection and Task 3's kill switch. **Phase 2 (voice) is deliberately not covered** — the spec sequences it behind text credits shipping, and it gets its own plan.

**One gap the spec did not anticipate, now covered:** the message entry carried no mention IDs, so `lu credits @someone` could not resolve a target. Task 5 adds `mentions` and `luId`. This should be recorded in the verification document as a design-time miss found in planning.

**Placeholder scan.** No "TBD", no "handle edge cases", no "similar to Task N". Every code step carries the actual code. The one deliberate deferral is the wording in Task 6, which is gated on the user approving copy rather than left vague — the strings are written out in full and shown to him before Task 7 begins.

**Type consistency.** `createCreditStore` is async everywhere it appears (Tasks 2, 9). `store.award(userId, { credits, name, at })` returns a number in Tasks 2, 4 and 7's fakes alike. `awardForMessage(store, entry, { now, random, config })` returns `{ awarded, total, leveledTo }` or `null` in Tasks 4 and 7. `progress(credits)` returns `{ level, into, needed }` in Tasks 1 and 6. `resolveTarget(entry, botId)` takes an explicit id in Tasks 6 and 7, which is why Task 7 adds `luId` to the entry rather than threading `botId` through `createConversation`.

**Test-count arithmetic.** 350 existing + 5 (T1) + 10 (T2) + 7 (T3) + 13 (T4) + 4 (T5) + 14 (T6) + 9 (T7) + 3 (T8) = 415. Each task states the expected running total so a drift is caught at the task that caused it rather than at the end.
