import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChangelog, formatAnnouncement, announceUpdate } from '../src/announce.js';

const CHANGELOG = `# Lu changelog

Intro text that is not a note.

## v1.2 — 2026-10-01

- he does a new thing
- and another

## v1.1 — 2026-09-20

- an older thing
`;

test('the version and notes come from the top entry of the changelog', () => {
  assert.deepEqual(parseChangelog(CHANGELOG), { version: '1.2', notes: ['he does a new thing', 'and another'] });
});

test('a changelog with no version heading gives nothing', () => {
  assert.equal(parseChangelog('# Lu changelog\n\n- a stray note\n'), null);
});

test('the real changelog has a version with at least one note', async () => {
  const text = await readFile(join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8');
  const parsed = parseChangelog(text);
  assert.match(parsed?.version ?? '', /^\d+\.\d+$/);
  assert.ok(parsed.notes.length > 0);
});

test('the announcement names the version and lists what changed', () => {
  assert.equal(
    formatAnnouncement({ version: '1.2', notes: ['he does a new thing', 'and another'] }),
    'lu v1.2 is live\n\nwhat changed:\n- he does a new thing\n- and another',
  );
});

function fakeState(initial = null) {
  const state = { value: initial, writes: [] };
  return {
    state,
    read: async () => state.value,
    write: async (v) => { state.writes.push(v); state.value = v; },
  };
}

test('a new version is announced once and remembered', async () => {
  const sent = [];
  const s = fakeState('1.1');
  const out = await announceUpdate({ changelog: CHANGELOG, readLast: s.read, writeLast: s.write, send: async (t) => { sent.push(t); } });
  assert.deepEqual(out, { announced: true, version: '1.2' });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^lu v1\.2 is live/);
  assert.deepEqual(s.state.writes, ['1.2']);
});

test('the first ever start announces the current version', async () => {
  const sent = [];
  const s = fakeState(null);
  const out = await announceUpdate({ changelog: CHANGELOG, readLast: s.read, writeLast: s.write, send: async (t) => { sent.push(t); } });
  assert.equal(out.announced, true);
  assert.equal(sent.length, 1);
});

test('a restart on the same version posts nothing', async () => {
  const sent = [];
  const s = fakeState('1.2');
  const out = await announceUpdate({ changelog: CHANGELOG, readLast: s.read, writeLast: s.write, send: async (t) => { sent.push(t); } });
  assert.deepEqual(out, { announced: false, reason: 'v1.2 was already announced' });
  assert.deepEqual(sent, []);
  assert.deepEqual(s.state.writes, []);
});

test('a failed post is not remembered, so the next start tries again', async () => {
  const s = fakeState('1.1');
  const out = await announceUpdate({
    changelog: CHANGELOG, readLast: s.read, writeLast: s.write,
    send: async () => { throw new Error('Missing Access'); },
  });
  assert.deepEqual(out, { announced: false, reason: 'could not post v1.2: Missing Access' });
  assert.deepEqual(s.state.writes, []);
});

test('an unreadable changelog posts nothing', async () => {
  const sent = [];
  const s = fakeState('1.1');
  const out = await announceUpdate({ changelog: 'nothing here', readLast: s.read, writeLast: s.write, send: async (t) => { sent.push(t); } });
  assert.deepEqual(out, { announced: false, reason: 'no version found in CHANGELOG.md' });
  assert.deepEqual(sent, []);
});
