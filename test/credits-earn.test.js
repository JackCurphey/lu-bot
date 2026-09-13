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

// The return value alone cannot see this bug: a cooldown-blocked message
// returns null either way, whether or not it quietly awarded first. Only
// inspecting the store afterward catches a cooldown check that runs too late.
test('a message blocked by the cooldown leaves the store untouched', () => {
  const store = fakeStore({ u1: { credits: 15, name: 'Bob', lastAwardAt: 100000, messages: 1, voiceSeconds: 0 } });
  awardForMessage(store, entry(), { now: () => 129999, random: lowest, config: config() });
  const after = store.get('u1');
  assert.equal(after.credits, 15);
  assert.equal(after.lastAwardAt, 100000);
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
