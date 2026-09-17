import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODE_IDS, SHARED_MODE_RULES, pickMode, moodInstruction } from '../src/mood.js';

// --- The roster ----------------------------------------------------------------

test('the four modes are declared in a fixed order', () => {
  assert.deepEqual(MODE_IDS, ['gossip', 'needler', 'narrator', 'windup']);
});

test('every mode has an instruction that names the mode and tells him to commit', () => {
  for (const id of MODE_IDS) {
    const text = moodInstruction(id);
    assert.ok(text.length > 0, `${id} has no instruction`);
    assert.match(text, /this reply only/i, `${id} does not scope itself to one reply`);
  }
});

test('every mode instruction carries the shared rules', () => {
  for (const id of MODE_IDS) {
    assert.ok(
      moodInstruction(id).includes(SHARED_MODE_RULES),
      `${id} is missing the shared rules — an off-limits line added there would not reach it`,
    );
  }
});

test('the modes are actually different from one another', () => {
  const bodies = MODE_IDS.map((id) => moodInstruction(id).replace(SHARED_MODE_RULES, ''));
  assert.equal(new Set(bodies).size, MODE_IDS.length);
});

test('an unknown mode is a programming error, not a silent empty fragment', () => {
  assert.throws(() => moodInstruction('sarcastic'), /sarcastic/);
});

// --- Selection -----------------------------------------------------------------
//
// Weights are walked in MODE_IDS order, so a given random value always lands
// on the same mode. Tests pin the boundaries rather than sampling, because a
// distribution test that passes 95% of the time is a flaky test.

const WEIGHTS = { gossip: 35, needler: 30, narrator: 20, windup: 15 };

test('a random value at the bottom of a band picks that band', () => {
  const at = (r) => pickMode({ weights: WEIGHTS, random: () => r });
  assert.equal(at(0), 'gossip');
  assert.equal(at(0.35), 'needler');
  assert.equal(at(0.65), 'narrator');
  assert.equal(at(0.85), 'windup');
});

test('a random value just below a boundary stays in the lower band', () => {
  const at = (r) => pickMode({ weights: WEIGHTS, random: () => r });
  assert.equal(at(0.3499), 'gossip');
  assert.equal(at(0.6499), 'needler');
  assert.equal(at(0.8499), 'narrator');
  assert.equal(at(0.9999), 'windup');
});

test('weights need not sum to 100', () => {
  const weights = { gossip: 1, needler: 1, narrator: 1, windup: 1 };
  assert.equal(pickMode({ weights, random: () => 0 }), 'gossip');
  assert.equal(pickMode({ weights, random: () => 0.75 }), 'windup');
});

test('a mode weighted zero is never picked', () => {
  const weights = { gossip: 0, needler: 1, narrator: 0, windup: 0 };
  for (const r of [0, 0.25, 0.5, 0.75, 0.9999]) {
    assert.equal(pickMode({ weights, random: () => r }), 'needler');
  }
});

test('all-zero weights select no mode at all', () => {
  const weights = { gossip: 0, needler: 0, narrator: 0, windup: 0 };
  assert.equal(pickMode({ weights, random: () => 0.5 }), null);
});

test('an unknown key in the weights does not shift the bands', () => {
  const weights = { ...WEIGHTS, sarcastic: 1000 };
  assert.equal(pickMode({ weights, random: () => 0.9999 }), 'windup');
});

// 2026-09-17: the shared rules used to say "the frame is class, contradiction
// and struggle", and every mode came out as a lecture that ignored the message.
test('the shared rules aim every mode at what was actually said', () => {
  assert.match(SHARED_MODE_RULES, /what was just said/i);
  assert.doesNotMatch(SHARED_MODE_RULES, /the frame is/i);
});
