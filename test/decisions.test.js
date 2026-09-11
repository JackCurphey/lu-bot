import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionLog, formatDecision, EXPLAIN_RE, NOT_FOUND } from '../src/decisions.js';

const rec = (id, over = {}) => ({ messageId: id, authorName: 'sam', outcome: 'ignore', reasons: ['r'], sent: null, ...over });

test('EXPLAIN_RE matches "lu explain" with an optional message id and trailing punctuation', () => {
  assert.equal(EXPLAIN_RE.exec('lu explain')[1], undefined);
  assert.equal(EXPLAIN_RE.exec('  Lu, explain 12345 ?')[1], '12345');
  assert.ok(EXPLAIN_RE.test('LU: EXPLAIN!'));
});

test('EXPLAIN_RE does not match sentences that merely contain the words', () => {
  assert.equal(EXPLAIN_RE.test('lu explain why you hate cats'), false);
  assert.equal(EXPLAIN_RE.test('can lu explain'), false);
});

test('find with no id returns the latest record in that channel', () => {
  const log = createDecisionLog();
  log.record('chan', rec('a'));
  log.record('chan', rec('b'));
  log.record('other', rec('c'));
  assert.equal(log.find('chan').messageId, 'b');
});

test('find by id returns that record, or null when absent', () => {
  const log = createDecisionLog();
  log.record('chan', rec('a'));
  assert.equal(log.find('chan', 'a').messageId, 'a');
  assert.equal(log.find('chan', 'zzz'), null);
  assert.equal(log.find('empty'), null);
});

test('record returns the stored object, so later reasons land in the log', () => {
  const log = createDecisionLog();
  const r = log.record('chan', rec('a'));
  r.reasons.push('judge said NO');
  assert.deepEqual(log.find('chan', 'a').reasons, ['r', 'judge said NO']);
});

test('keeps only the latest 50 per channel', () => {
  const log = createDecisionLog();
  for (let i = 0; i < 51; i++) log.record('chan', rec(`m${i}`));
  assert.equal(log.find('chan', 'm0'), null);
  assert.equal(log.find('chan', 'm1').messageId, 'm1');
});

test('formatDecision for a reply lists reasons and what was sent', () => {
  const text = formatDecision(rec('42', { reasons: ['i was @mentioned', 'replied'], sent: 'wot' }));
  assert.equal(text, [
    "I replied to sam's message (id `42`):",
    '- i was @mentioned',
    '- replied',
    "- what i sent: 'wot'",
  ].join('\n'));
});

test('formatDecision for a silence says so, and cuts a long sent text at 200 characters', () => {
  assert.match(formatDecision(rec('1')), /^I did not reply to sam's message/);
  const long = formatDecision(rec('2', { sent: 'x'.repeat(300) }));
  assert.ok(long.endsWith(`'${'x'.repeat(200)}...'`));
});

test('the not-found text is exact', () => {
  assert.equal(NOT_FOUND, 'i dont have a record of that one, either nothing happened here since i restarted or it aged out');
});
