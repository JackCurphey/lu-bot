import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessageDeleted, formatMessageEdited, formatBulkDelete, formatMemberJoined, formatMemberLeft, formatNicknameChanged, formatRolesChanged, COLORS } from '../src/logging/format.js';

const now = () => Date.UTC(2026, 8, 27, 12, 0, 0);
const field = (embed, name) => embed.fields.find((f) => f.name === name)?.value;

const DAY = 86_400_000;

test('a deleted message shows its text, author, channel and attachments', () => {
  const { embeds: [e] } = formatMessageDeleted({
    messageId: 'm1', channelId: 'c1', authorId: 'u1', authorName: 'Sam', text: 'hello', attachments: ['cat.png'],
  }, { now });
  assert.equal(e.title, 'Message deleted');
  assert.equal(e.color, COLORS.deleted);
  assert.equal(e.description, 'hello');
  assert.equal(field(e, 'Author'), '<@u1> (Sam)');
  assert.equal(field(e, 'Channel'), '<#c1>');
  assert.equal(field(e, 'Attachments'), 'cat.png');
  assert.match(e.footer.text, /m1/);
  assert.equal(e.timestamp, '2026-09-27T12:00:00.000Z');
});

test('a deleted message Lu never saw says its text is not available', () => {
  const { embeds: [e] } = formatMessageDeleted({
    messageId: 'm1', channelId: 'c1', authorId: null, authorName: null, text: null, attachments: [],
  }, { now });
  assert.match(e.description, /not available/);
  assert.equal(field(e, 'Author'), 'unknown');
  assert.equal(field(e, 'Attachments'), undefined);
});

test('long text is cut to fit an embed', () => {
  const { embeds: [e] } = formatMessageDeleted({
    messageId: 'm1', channelId: 'c1', authorId: 'u1', authorName: 'Sam', text: 'x'.repeat(5000), attachments: [],
  }, { now });
  assert.ok(e.description.length <= 4000);
});

test('an edit shows before, after and a jump link', () => {
  const { embeds: [e] } = formatMessageEdited({
    messageId: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'Sam', before: 'old', after: 'new',
  }, { now });
  assert.equal(e.title, 'Message edited');
  assert.equal(e.color, COLORS.edited);
  assert.match(e.description, /https:\/\/discord\.com\/channels\/g1\/c1\/m1/);
  assert.equal(field(e, 'Before'), 'old');
  assert.equal(field(e, 'After'), 'new');
});

test('an edit to a message Lu never saw says the old text is not available', () => {
  const { embeds: [e] } = formatMessageEdited({
    messageId: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'Sam', before: null, after: 'new',
  }, { now });
  assert.match(field(e, 'Before'), /not available/);
});

test('a bulk delete is one entry with the messages attached as text', () => {
  const out = formatBulkDelete({
    channelId: 'c1',
    messages: [
      { id: 'm1', authorId: 'u1', authorName: 'Sam', text: 'one', at: Date.UTC(2026, 8, 27, 11, 0, 0) },
      { id: 'm2', authorId: null, authorName: null, text: null, at: null },
    ],
  }, { now });
  const [e] = out.embeds;
  assert.equal(e.title, '2 messages deleted');
  assert.equal(field(e, 'Channel'), '<#c1>');
  assert.match(e.description, /1 of 2/);
  assert.equal(out.files[0].name, 'deleted-messages.txt');
  const text = out.files[0].attachment.toString('utf8');
  assert.match(text, /2026-09-27T11:00:00\.000Z Sam \(u1\): one/);
  assert.match(text, /message m2: text not available/);
});

test('a bulk delete of one message says "message", not "messages"', () => {
  const out = formatBulkDelete({ channelId: 'c1', messages: [{ id: 'm1', authorId: 'u1', authorName: 'Sam', text: 'x', at: 0 }] }, { now });
  assert.equal(out.embeds[0].title, '1 message deleted');
});

test('a join shows when the account was made', () => {
  const createdAt = now() - 30 * DAY;
  const { embeds: [e] } = formatMemberJoined({ userId: 'u1', name: 'Sam', createdAt, isBot: false }, { now });
  assert.equal(e.title, 'Member joined');
  assert.equal(e.color, COLORS.joined);
  assert.equal(e.description, '<@u1> (Sam)');
  assert.equal(field(e, 'Account created'), `<t:${Math.floor(createdAt / 1000)}:R>`);
  assert.equal(field(e, 'New account'), undefined);
});

test('an account under 7 days old is flagged', () => {
  const { embeds: [e] } = formatMemberJoined({ userId: 'u1', name: 'Sam', createdAt: now() - 6 * DAY, isBot: false }, { now });
  assert.match(field(e, 'New account'), /less than 7 days/);
});

test('a bot joining is labelled as a bot', () => {
  const { embeds: [e] } = formatMemberJoined({ userId: 'b1', name: 'Bot', createdAt: 0, isBot: true }, { now });
  assert.equal(e.title, 'Bot added');
});

test('a leave lists the roles they held, or says they are not known', () => {
  const { embeds: [a] } = formatMemberLeft({ userId: 'u1', name: 'Sam', roleIds: ['r1', 'r2'] }, { now });
  assert.equal(a.title, 'Member left');
  assert.equal(a.color, COLORS.left);
  assert.equal(field(a, 'Roles'), '<@&r1> <@&r2>');
  const { embeds: [b] } = formatMemberLeft({ userId: 'u1', name: 'Sam', roleIds: [] }, { now });
  assert.equal(field(b, 'Roles'), 'none');
  const { embeds: [c] } = formatMemberLeft({ userId: 'u1', name: 'Sam', roleIds: null }, { now });
  assert.match(field(c, 'Roles'), /not known/);
});

test('a nickname change shows before and after, with none for no nickname', () => {
  const { embeds: [e] } = formatNicknameChanged({ userId: 'u1', name: 'Sam', before: null, after: 'Sammy' }, { now });
  assert.equal(e.title, 'Nickname changed');
  assert.equal(e.color, COLORS.changed);
  assert.equal(field(e, 'Before'), '(none)');
  assert.equal(field(e, 'After'), 'Sammy');
});

test('a role change lists what was added and removed, and leaves out an empty side', () => {
  const { embeds: [e] } = formatRolesChanged({ userId: 'u1', name: 'Sam', added: ['r1'], removed: [] }, { now });
  assert.equal(e.title, 'Roles changed');
  assert.equal(field(e, 'Added'), '<@&r1>');
  assert.equal(field(e, 'Removed'), undefined);
});
