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
