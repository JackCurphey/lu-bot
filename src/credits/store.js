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
  // Set on a failed write, cleared on the next successful one. A mid-session
  // write failure must never take the bot down (see the catch below), but the
  // failure still has to be visible to something -- close() surfaces it so a
  // lost final flush is distinguishable from a clean shutdown.
  let lastWriteError = null;

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
      lastWriteError = null;
    } catch (err) {
      // Never take the bot down for a failed write. Stay dirty and retry on
      // the next flush; the in-memory ledger is still correct.
      dirty = true;
      lastWriteError = err;
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
      // flush()/write() swallow the error to stay non-fatal while running;
      // close() is the explicit "stop now" boundary, so it is the one place
      // an unwritten final flush must be signalled rather than absorbed.
      if (lastWriteError) {
        throw new Error(
          `Could not flush the credit ledger to ${path} before closing: ${lastWriteError.message}`,
        );
      }
    },
  };
}
