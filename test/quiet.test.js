import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuietCommand, QUIET_LINES } from '../src/quiet.js';

const keywords = ['lu', 'ai bot'];
const parse = (text, over = {}) => parseQuietCommand({ text, mentionsLu: false, repliesToLu: false, ...over }, { keywords });

test('a stop that starts with his name is a stop', () => {
  for (const text of ['lu stop', 'Lu, shut up!', 'lu be quiet please', 'LU STOP TALKING', 'lu hush', 'ai bot stop', 'lu shhh']) {
    assert.equal(parse(text), 'stop', text);
  }
});

test('please is allowed before his name as well as after it', () => {
  assert.equal(parse('please lu stop'), 'stop');
  assert.equal(parse('please, lu, stop'), 'stop');
  assert.equal(parse('please lu you can talk'), 'resume');
  assert.equal(parse('please stop'), null);
});

test('his name at the end counts too', () => {
  assert.equal(parse('stop talking lu'), 'stop');
  assert.equal(parse('shut up, lu.'), 'stop');
});

test('an @mention or a reply to him counts as aimed at him', () => {
  assert.equal(parse('@Lu stop', { mentionsLu: true }), 'stop');
  assert.equal(parse('be quiet', { repliesToLu: true }), 'stop');
});

// The failure mode must be "didn't stop", never "stopped by accident".
test('a stop that is not aimed at him, or is part of a sentence, is nothing', () => {
  assert.equal(parse('stop'), null);
  assert.equal(parse('shut up'), null);
  assert.equal(parse("don't stop believing"), null);
  assert.equal(parse('lu stop spamming the channel sam'), null);
  assert.equal(parse('lu'), null);
  assert.equal(parse('lucky stop'), null);
});

test('a resume aimed at him is a resume', () => {
  for (const text of ['lu you can talk', 'lu you can talk again', 'Lu, you can speak now', 'lu talk again', 'lu come back', 'lu unmute']) {
    assert.equal(parse(text), 'resume', text);
  }
  assert.equal(parse('you can talk', { repliesToLu: true }), 'resume');
  assert.equal(parse('you can talk'), null);
});

test('the lines, with the number of minutes', () => {
  assert.equal(QUIET_LINES.stopped(5), "fine. i'll be quiet for 5 minutes.");
  assert.equal(QUIET_LINES.stopped(1), "fine. i'll be quiet for 1 minute.");
  assert.equal(QUIET_LINES.resumed(), "i'm back.");
});
