import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDITS_RE, LEADERBOARD_RE, resolveTarget, isCreditsCommand,
  formatCredits, formatLeaderboard, formatLevelUp, creditsInstruction,
  EMPTY_LEADERBOARD,
} from '../src/credits/commands.js';

// --- Anchoring ---
// Matched as "lu explain" is: only the command itself, so a message that
// merely talks about credits stays conversation and reaches the model.
// CREDITS_RE only isolates the "lu credits" prefix and captures the rest --
// isCreditsCommand is the real gate, since a display name can contain spaces
// and no regex can tell a two-word name from a two-word sentence.

test('the credits command matches its forms', () => {
  assert.ok(CREDITS_RE.test('lu credits'));
  assert.ok(CREDITS_RE.test('Lu, credits'));
  assert.ok(CREDITS_RE.test('  lu credits  '));
  assert.ok(CREDITS_RE.test('lu credits?'));
  assert.ok(CREDITS_RE.test('lu credits @Bob'));
  assert.ok(CREDITS_RE.test('lu credits @COMRADE STONE'));
});

test('isCreditsCommand: bare forms are commands', () => {
  assert.ok(isCreditsCommand({ text: 'lu credits', mentions: [] }));
  assert.ok(isCreditsCommand({ text: 'Lu, credits', mentions: [] }));
  assert.ok(isCreditsCommand({ text: 'lu credits?', mentions: [] }));
});

test('isCreditsCommand: naming a mentioned member is a command', () => {
  const mentions = [{ id: '1', name: 'Bob' }];
  assert.ok(isCreditsCommand({ text: 'lu credits @Bob', mentions }));
  assert.ok(isCreditsCommand({ text: 'lu credits @Bob.', mentions }));
});

test('isCreditsCommand: a multi-word display name is still a command', () => {
  const mentions = [{ id: '1', name: 'COMRADE STONE' }];
  assert.ok(isCreditsCommand({ text: 'lu credits @COMRADE STONE', mentions }));
});

test('isCreditsCommand: trailing prose after a real mention is conversation', () => {
  const mentions = [{ id: '1', name: 'Bob' }];
  assert.ok(!isCreditsCommand({ text: 'lu credits @Bob thanks', mentions }));
  assert.ok(!isCreditsCommand({ text: 'lu credits @Bob what a stupid idea', mentions }));
});

test('isCreditsCommand: talking about credits is conversation, not a command', () => {
  assert.ok(!isCreditsCommand({ text: 'lu credits are a stupid idea', mentions: [] }));
  assert.ok(!isCreditsCommand({ text: 'how many credits do i have', mentions: [] }));
  assert.ok(!isCreditsCommand({ text: 'lu, what are imperial credits', mentions: [] }));
});

test('isCreditsCommand: near-miss prefixes are not commands', () => {
  assert.ok(!isCreditsCommand({ text: 'lu credit', mentions: [] }));
  assert.ok(!isCreditsCommand({ text: 'lucredits', mentions: [] }));
  assert.ok(!isCreditsCommand({ text: 'lu', mentions: [] }));
});

// F6: every other field added to toEntry in this branch is defensively
// defaulted with a comment saying why; `mentions` was not. A future entry
// producer that omits it must not turn this into a caught-and-dropped
// TypeError.
test('isCreditsCommand: an entry with no mentions field is still a valid bare command', () => {
  assert.ok(isCreditsCommand({ text: 'lu credits' }));
});

test('isCreditsCommand: an entry with no mentions field naming someone is not a command', () => {
  assert.ok(!isCreditsCommand({ text: 'lu credits @Bob' }));
});

// An "@Bob" tail with nobody actually mentioned is not distinguishable from
// prose that happens to start with @ -- without a real mention to check
// against, it must not be treated as a command.
test('isCreditsCommand: an @-tail with no matching mention is not a command', () => {
  assert.ok(!isCreditsCommand({ text: 'lu credits @Bob', mentions: [] }));
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
  assert.match(out, /<9911>/);
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
