import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, matchKeyword } from '../src/attention.js';

const trigger = {
  keywords: ['lu', 'ai bot'], randomReplyChance: 0.02, cooldownSeconds: 60,
  windowMessages: 8, windowMinutes: 5, enabled: true,
};
const config = { trigger };
const NOW = 10_000_000;
const MIN = 60_000;

const e = (over = {}) => ({
  messageId: 'm', channelId: 'c', authorId: 'sam', name: 'sam', isBot: false, isLu: false,
  mentionsLu: false, mentionsOthers: false, repliesToLu: false, repliesToOther: false,
  at: NOW, text: 'hello there', ...over,
});
const lu = (over = {}) => e({ authorId: 'lu', name: 'Lu', isLu: true, isBot: true, text: 'wot', ...over });
const noRoll = () => 0.99;
const roll = () => 0;

function run(entry, { history = [entry], state = { lastChimeAt: null }, random = noRoll, cfg = config } = {}) {
  return decide({ entry, history, state, now: NOW, config: cfg, random });
}

// --- Rules 1-4: bots, and direct address ---------------------------------------

test('a bot author is ignored, even one that mentions Lu', () => {
  const d = run(e({ isBot: true, mentionsLu: true }));
  assert.equal(d.outcome, 'ignore');
});

test('an @mention of Lu is answered', () => {
  assert.deepEqual([run(e({ mentionsLu: true })).outcome, run(e({ mentionsLu: true })).trigger], ['reply', 'mention']);
});

test('a Discord reply to Lu is answered', () => {
  const d = run(e({ repliesToLu: true }));
  assert.equal(d.outcome, 'reply');
  assert.equal(d.trigger, 'reply-to-lu');
});

test('his name as a whole word is answered', () => {
  for (const text of ['lu what do you think', 'Lu, explain yourself', 'is that lu\'s view', 'ask LU']) {
    const d = run(e({ text }));
    assert.equal(d.outcome, 'reply', text);
    assert.equal(d.trigger, 'keyword', text);
  }
});

test('his name inside another word is not a trigger', () => {
  for (const text of ['lunch time', 'feeling blue', 'good value', 'flu season']) {
    assert.equal(run(e({ text })).outcome, 'ignore', text);
  }
});

test('multi-word keywords match across any whitespace, but not joined up', () => {
  assert.equal(matchKeyword(['ai bot'], 'hey AI   bot'), 'ai bot');
  assert.equal(matchKeyword(['ai bot'], 'the aibot'), null);
});

// --- Rule 5: talking to someone else -------------------------------------------

test('a reply to someone else is ignored, even while Lu is in the conversation', () => {
  const entry = e({ repliesToOther: true });
  const d = run(entry, { history: [lu({ at: NOW - MIN }), entry] });
  assert.equal(d.outcome, 'ignore');
});

test('a message that @mentions someone else is ignored', () => {
  assert.equal(run(e({ mentionsOthers: true })).outcome, 'ignore');
});

test('naming Lu still wins over replying to someone else', () => {
  assert.equal(run(e({ repliesToOther: true, text: 'lu would hate this' })).outcome, 'reply');
});

// --- Rule 6: the conversation window -------------------------------------------

test('while Lu spoke recently, an unclear message goes to the judge', () => {
  const entry = e({ text: 'and what about taiwan' });
  const d = run(entry, { history: [lu({ at: NOW - MIN }), entry] });
  assert.equal(d.outcome, 'ask-judge');
  assert.equal(d.trigger, 'window');
});

test('Lu more than 8 messages back is not in the conversation', () => {
  const filler = Array.from({ length: 8 }, (_, i) => e({ messageId: `f${i}` }));
  const entry = e({ text: 'and what about taiwan' });
  const d = run(entry, { history: [lu({ at: NOW - MIN }), ...filler.slice(1), entry] });
  assert.notEqual(d.outcome, 'ask-judge');
});

test('Lu more than 5 minutes ago is not in the conversation', () => {
  const entry = e({ text: 'and what about taiwan' });
  const d = run(entry, { history: [lu({ at: NOW - 6 * MIN }), entry] });
  assert.notEqual(d.outcome, 'ask-judge');
});

// --- Rule 7: random chime-in and its cooldown ----------------------------------

test('outside the conversation, a lucky roll chimes in', () => {
  const d = run(e(), { random: roll });
  assert.equal(d.outcome, 'reply');
  assert.equal(d.trigger, 'chime');
});

test('outside the conversation, an unlucky roll stays quiet', () => {
  assert.equal(run(e(), { random: noRoll }).outcome, 'ignore');
});

test('a chime-in inside the cooldown does not fire', () => {
  const d = run(e(), { random: roll, state: { lastChimeAt: NOW - 30_000 } });
  assert.equal(d.outcome, 'ignore');
});

test('a chime-in after the cooldown can fire again', () => {
  const d = run(e(), { random: roll, state: { lastChimeAt: NOW - 61_000 } });
  assert.equal(d.outcome, 'reply');
});

test('the cooldown never blocks direct address', () => {
  const d = run(e({ mentionsLu: true }), { state: { lastChimeAt: NOW } });
  assert.equal(d.outcome, 'reply');
});

// --- The switch ----------------------------------------------------------------

test('TRIGGER_ENABLED=false turns off the window and chime-ins but not direct address', () => {
  const off = { trigger: { ...trigger, enabled: false } };
  const followUp = e({ text: 'and what about taiwan' });
  assert.equal(run(followUp, { history: [lu({ at: NOW - MIN }), followUp], cfg: off }).outcome, 'ignore');
  assert.equal(run(e(), { random: roll, cfg: off }).outcome, 'ignore');
  assert.equal(run(e({ mentionsLu: true }), { cfg: off }).outcome, 'reply');
});

test('every decision carries at least one reason', () => {
  for (const d of [run(e()), run(e({ mentionsLu: true })), run(e({ isBot: true })), run(e(), { random: roll })]) {
    assert.ok(d.reasons.length > 0);
  }
});
