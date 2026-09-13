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
