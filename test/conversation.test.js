import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, HEADACHE } from '../src/conversation.js';
import { createHistory } from '../src/history.js';
import { createDecisionLog, NOT_FOUND } from '../src/decisions.js';
import { NICKNAME_INSTRUCTION, NICKNAME_LINES } from '../src/nickname.js';
import { respondWithReason } from '../src/responder.js';
import { CREDITS_DISABLED } from '../src/credits/commands.js';

const config = {
  trigger: {
    keywords: ['lu', 'ai bot'], randomReplyChance: 0.02, cooldownSeconds: 60, windowMessages: 8,
    windowMinutes: 5, pauseSeconds: 3, enabled: true, maxQuoteChars: 400, addresseeTimeoutSeconds: 15,
  },
  reply: { timeoutSeconds: 90 },
  llm: { chatModel: 'chat' },
  nickname: { enabled: true, requirePermission: true },
};
const T0 = 1_000_000;
const PAUSE_MS = 3000;
const REPLY_MS = 90_000;

// Timers are fired by duration, so the pause and the reply timeout can be
// driven separately.
function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutImpl: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeoutImpl: (id) => { timers.delete(id); },
    fire(ms) {
      for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); }
    },
    count: (ms) => [...timers.values()].filter((t) => t.ms === ms).length,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

let seq = 0;
function msg(over = {}) {
  seq++;
  return {
    messageId: `m${seq}`, channelId: 'chan', authorId: 'sam', name: 'sam', isBot: false, isLu: false,
    mentionsLu: false, mentionsOthers: false, repliesToLu: false, repliesToOther: false,
    at: T0, text: 'hello', authorCanManageNicknames: true, inGuild: true,
    mentions: [], luId: 'lu', ...over,
  };
}
const luSaid = (text = 'the state is a tool') => msg({ authorId: 'lu', name: 'Lu', isLu: true, isBot: true, text });

function setup({ applyNickname, send, ...over } = {}) {
  const timers = fakeTimers();
  const history = createHistory({ limit: 20, trimTo: 10 });
  const decisions = createDecisionLog();
  const calls = { respond: [], judge: [], applyNickname: [] };
  const sent = [];
  let typingStarts = 0; let typingStops = 0;
  const io = {
    // `send`, when given, lets a test control when a particular send resolves
    // (e.g. a deferred promise) so it can drive interleaving between two
    // concurrent handleMessage calls -- gateway events are not serialised.
    async send(text) {
      if (send) return send(text, sent);
      sent.push(text);
      return `sent${sent.length}`;
    },
    startTyping() { typingStarts++; return { stop() { typingStops++; } }; },
    async applyNickname(name) {
      calls.applyNickname.push(name);
      return applyNickname ? applyNickname(name) : { ok: true };
    },
  };
  const conversation = createConversation({
    config, history, decisions, persona: 'P', llm: {},
    chooseChunks: async () => [],
    respondWithReason: async (args) => { calls.respond.push(args); return { ok: true, reply: 'wot' }; },
    isAddressed: async ({ entries }) => { calls.judge.push(entries); return { yes: true, reason: '' }; },
    now: () => T0,
    random: () => 0.99,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    ...over,
  });
  // Lu's earlier lines are seeded straight into history, as if he had sent them.
  const seedLu = (text) => history.record(luSaid(text));
  const typing = () => ({ typingStarts, typingStops });
  return { conversation, history, decisions, calls, sent, io, timers, seedLu, typing };
}

async function say(s, entry) {
  await s.conversation.handleMessage(entry, s.io);
  await s.conversation.idle(entry.channelId);
}

// --- Direct address ------------------------------------------------------------

test('a mention is answered with a plain message, and his reply joins history', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true, text: '@Lu hi' }));
  assert.deepEqual(s.sent, ['wot']);
  const last = s.history.entries('chan').at(-1);
  assert.equal(last.isLu, true);
  assert.equal(last.text, 'wot');
  assert.equal(last.messageId, 'sent1');
});

test('the prompt carries the named conversation before the message being answered', async () => {
  const s = setup();
  await say(s, msg({ name: 'ana', text: 'taiwan is interesting' }));
  await say(s, msg({ mentionsLu: true, text: '@Lu what do you think' }));
  const args = s.calls.respond[0];
  assert.equal(args.message, 'sam: @Lu what do you think');
  assert.deepEqual(args.history, [{ role: 'user', content: 'ana: taiwan is interesting' }]);
  assert.equal(args.persona, 'P');
});

test('people talking without him get silence, and no model call at all', async () => {
  const s = setup();
  await say(s, msg({ text: 'training tonight?' }));
  await say(s, msg({ name: 'ana', text: 'yeah 7pm' }));
  assert.deepEqual(s.sent, []);
  assert.equal(s.calls.respond.length, 0);
  assert.equal(s.calls.judge.length, 0);
});

test('other bots are heard but never answered', async () => {
  const s = setup();
  await say(s, msg({ isBot: true, name: 'otherbot', mentionsLu: true, text: '@Lu beep' }));
  assert.deepEqual(s.sent, []);
  assert.equal(s.history.entries('chan').length, 1);
});

test('his own Discord events are not recorded a second time', async () => {
  const s = setup();
  await say(s, luSaid('i said this'));
  assert.equal(s.history.entries('chan').length, 0);
});

test('a message with no text is not recorded', async () => {
  const s = setup();
  await say(s, msg({ text: '' }));
  assert.equal(s.history.entries('chan').length, 0);
});

test('typing stops after a reply', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true }));
  assert.deepEqual(s.typing(), { typingStarts: 1, typingStops: 1 });
});

// --- Following the conversation ------------------------------------------------

test('a follow-up while he is in the conversation is judged after the pause', async () => {
  const s = setup();
  s.seedLu();
  await s.conversation.handleMessage(msg({ text: 'a tool for what exactly' }), s.io);
  assert.equal(s.calls.judge.length, 0, 'judged before the pause ended');
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.equal(s.calls.judge.length, 1);
  assert.equal(s.calls.judge[0].at(-1).text, 'a tool for what exactly');
  assert.deepEqual(s.sent, ['wot']);
});

test('a judge NO means silence, and the log says so', async () => {
  const s = setup({ isAddressed: async () => ({ yes: false, reason: '' }) });
  s.seedLu();
  const m = msg({ text: 'ana did you see the match' });
  await s.conversation.handleMessage(m, s.io);
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.deepEqual(s.sent, []);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('judge said NO'));
});

test('a burst of messages costs one judge call, for the latest', async () => {
  const s = setup();
  s.seedLu();
  for (const text of ['wait', 'so what you are saying', 'is that the state serves one class']) {
    await s.conversation.handleMessage(msg({ text }), s.io);
  }
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.equal(s.calls.judge.length, 1);
  assert.equal(s.calls.judge[0].at(-1).text, 'is that the state serves one class');
});

test('direct address during a pause is answered at once and the judge is skipped', async () => {
  const s = setup();
  s.seedLu();
  const first = msg({ text: 'hmm' });
  await s.conversation.handleMessage(first, s.io);
  await say(s, msg({ mentionsLu: true, text: '@Lu answer me' }));
  assert.equal(s.timers.count(PAUSE_MS), 0);
  assert.equal(s.calls.judge.length, 0);
  assert.deepEqual(s.sent, ['wot']);
  assert.ok(
    s.decisions.find('chan', first.messageId).reasons.includes('judge skipped: a message aimed at me came first'),
  );
});

test('a bot chiming in during a pause does not cancel it: the judge still runs', async () => {
  const s = setup();
  s.seedLu();
  await s.conversation.handleMessage(msg({ text: 'hmm' }), s.io);
  await say(s, msg({ isBot: true, name: 'otherbot', text: 'beep boop' }));
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.equal(s.calls.judge.length, 1);
  assert.deepEqual(s.sent, ['wot']);
});

test('a reply-to-someone-else during a pause does not cancel it: the judge still runs', async () => {
  const s = setup();
  s.seedLu();
  await s.conversation.handleMessage(msg({ text: 'hmm' }), s.io);
  await say(s, msg({ repliesToOther: true, text: 'yeah exactly' }));
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.equal(s.calls.judge.length, 1);
  assert.deepEqual(s.sent, ['wot']);
});

// --- Failures and the headache signal ------------------------------------------

test('a failed reply to a mention posts the headache, not the error', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: false, reason: 'empty reply after stripping reasoning' }) });
  const m = msg({ mentionsLu: true });
  await say(s, m);
  assert.deepEqual(s.sent, [HEADACHE]);
  assert.equal(HEADACHE, 'uh oh... i have a headache');
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('reply failed: empty reply after stripping reasoning'));
  assert.equal(s.history.entries('chan').some((e) => e.isLu), false, 'the headache must not enter history');
});

test('a model server error on a mention posts the headache and logs the cause', async () => {
  const s = setup({ respondWithReason: async () => { throw new Error('Model server request to /chat/completions failed with status 500'); } });
  const m = msg({ mentionsLu: true });
  await say(s, m);
  assert.deepEqual(s.sent, [HEADACHE]);
  assert.match(s.decisions.find('chan', m.messageId).reasons.at(-1), /^reply failed: model server error: .*500/);
  assert.deepEqual(s.typing(), { typingStarts: 1, typingStops: 1 });
});

test('a reply that takes too long posts the headache', async () => {
  const s = setup({ respondWithReason: () => new Promise(() => {}) });
  const m = msg({ mentionsLu: true });
  await s.conversation.handleMessage(m, s.io);
  await tick();
  s.timers.fire(REPLY_MS);
  await s.conversation.idle('chan');
  assert.deepEqual(s.sent, [HEADACHE]);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('reply failed: reply timed out after 90s'));
});

test('a failed random chime-in stays silent', async () => {
  const s = setup({ random: () => 0, respondWithReason: async () => ({ ok: false, reason: 'empty reply after stripping reasoning' }) });
  await say(s, msg({ text: 'anyone up' }));
  assert.deepEqual(s.sent, []);
});

test('a chime-in starts the cooldown for the next one', async () => {
  const s = setup({ random: () => 0, respondWithReason: async (args) => { s.calls.respond.push(args); return { ok: false, reason: 'x' }; } });
  await say(s, msg({ text: 'anyone up' }));
  await say(s, msg({ text: 'hello?' }));
  assert.equal(s.calls.respond.length, 1);
});

// --- lu explain ----------------------------------------------------------------

test('lu explain reports the latest decision and is not itself answered or recorded', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true, text: '@Lu hi' }));
  await say(s, msg({ text: 'lu explain' }));
  assert.equal(s.calls.respond.length, 1);
  assert.match(s.sent[1], /^I replied to sam's message/);
  assert.match(s.sent[1], /i was @mentioned/);
  assert.equal(s.history.entries('chan').some((e) => e.text === 'lu explain'), false);
});

test('lu explain with nothing recorded says it has no record', async () => {
  const s = setup();
  await say(s, msg({ text: 'lu explain' }));
  assert.deepEqual(s.sent, [NOT_FOUND]);
});

// --- Task 15: Lu can change his own nickname -----------------------------------

test('a rename request injects the instruction into respondWithReason\'s args; an ordinary message does not', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true, text: '@Lu change your name to Bob' }));
  assert.equal(s.calls.respond[0].extraInstruction, NICKNAME_INSTRUCTION);
  await say(s, msg({ mentionsLu: true, text: '@Lu hello there' }));
  assert.equal(s.calls.respond[1].extraInstruction, undefined);
});

test('a reply containing the marker is stripped before posting, applies the nickname, and the decision records it', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'sure comrade\nNICKNAME: Bob\nglad to help' }) });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to Bob' });
  await say(s, m);
  assert.deepEqual(s.sent, ['sure comrade\nglad to help']);
  assert.deepEqual(s.calls.applyNickname, ['Bob']);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.some((r) => r.includes('changed nickname to "Bob"')));
});

// "go back to your default name" now matches NICKNAME_RESET_RE (Task 16),
// so this reset is handled directly rather than through the model's marker
// — the marker in the mocked reply is ignored, not acted on.
test('NICKNAME: RESET calls applyNickname(null)', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'ok\nNICKNAME: RESET' }) });
  const m = msg({ mentionsLu: true, text: '@Lu go back to your default name' });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, [null]);
  assert.deepEqual(s.sent, ['ok']);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('reset nickname to the default (asked directly)'));
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('ignored a NICKNAME line: the reset was handled directly'));
});

// --- Fix round 1, Important 1: the model-driven RESET marker still has a
// live branch when a message matches NICKNAME_REQUEST_RE but not
// NICKNAME_RESET_RE — "call yourself your normal name" is one such phrase
// (verified directly against both exported regexes: it matches
// NICKNAME_REQUEST_RE and not NICKNAME_RESET_RE), so the model's own
// "NICKNAME: RESET" marker is what has to carry the reset here, not the
// deterministic asksReset path.
test('a NICKNAME: RESET marker on a non-deterministic reset phrase resets via the marker path', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'ok\nNICKNAME: RESET' }) });
  const m = msg({ mentionsLu: true, text: '@Lu call yourself your normal name' });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, [null]);
  assert.deepEqual(s.sent, ['ok']);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('reset nickname to the default'));
});

// --- Task 16, Part 1: deterministic nickname reset --------------------------

test('a reset request resets the nickname with no marker at all, and the decision records it', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'sure comrade, all done' }) });
  const m = msg({ mentionsLu: true, text: '@Lu go back to your normal name' });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, [null]);
  assert.deepEqual(s.sent, ['sure comrade, all done']);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('reset nickname to the default (asked directly)'));
});

test('a reset request does not inject the instruction into respondWithReason\'s args', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true, text: '@Lu go back to your normal name' }));
  assert.equal(s.calls.respond[0].extraInstruction, undefined);
});

test('a reset request from someone without Manage Nicknames does not reset, and appends noPermission', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'sure comrade' }) });
  const m = msg({ mentionsLu: true, text: '@Lu go back to your normal name', authorCanManageNicknames: false });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, []);
  assert.deepEqual(s.sent, [`sure comrade\n\n${NICKNAME_LINES.noPermission}`]);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('nickname change refused: asker lacks Manage Nicknames'));
});

test('a reset request whose reply also carries a NICKNAME: Bob marker: the marker is stripped and ignored, reset applies null', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'sure\nNICKNAME: Bob' }) });
  const m = msg({ mentionsLu: true, text: '@Lu go back to your normal name' });
  await say(s, m);
  assert.deepEqual(s.sent, ['sure']);
  assert.deepEqual(s.calls.applyNickname, [null]);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('ignored a NICKNAME line: the reset was handled directly'));
});

test('asker without Manage Nicknames: no applyNickname call, noPermission line appended', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'sure\nNICKNAME: Bob' }) });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to Bob', authorCanManageNicknames: false });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, []);
  assert.deepEqual(s.sent, [`sure\n\n${NICKNAME_LINES.noPermission}`]);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('nickname change refused: asker lacks Manage Nicknames'));
});

test('applyNickname returning { ok: false, reason: "refused" } appends the refused line', async () => {
  const s = setup({
    respondWithReason: async () => ({ ok: true, reply: 'sure\nNICKNAME: Bob' }),
    applyNickname: async () => ({ ok: false, reason: 'refused' }),
  });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to Bob' });
  await say(s, m);
  assert.deepEqual(s.sent, [`sure\n\n${NICKNAME_LINES.refused}`]);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('nickname change failed: refused'));
});

test('a marker in a reply to a message that never asked is stripped, no applyNickname call, reason recorded', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'random\nNICKNAME: Bob' }) });
  const m = msg({ mentionsLu: true, text: '@Lu hows it going' });
  await say(s, m);
  assert.deepEqual(s.sent, ['random']);
  assert.deepEqual(s.calls.applyNickname, []);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('ignored a NICKNAME line nobody asked for'));
});

test('a reply that is only a marker and the rename succeeds posts nothing, and records the reason', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'NICKNAME: Bob' }) });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to Bob' });
  await say(s, m);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.calls.applyNickname, ['Bob']);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('replied with a nickname change only'));
  assert.equal(s.history.entries('chan').some((e) => e.isLu), false, 'nothing was posted, so nothing enters history');
});

test('a reply that is only a marker and fails posts the status line alone, never empty', async () => {
  const s = setup({
    respondWithReason: async () => ({ ok: true, reply: 'NICKNAME: Bob' }),
    applyNickname: async () => ({ ok: false, reason: 'refused' }),
  });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to Bob' });
  await say(s, m);
  assert.deepEqual(s.sent, [NICKNAME_LINES.refused]);
});

test('not in a guild refuses the rename before checking permission', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'sure\nNICKNAME: Bob' }) });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to Bob', inGuild: false });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, []);
  assert.deepEqual(s.sent, [`sure\n\n${NICKNAME_LINES.notInGuild}`]);
});

// --- Fix round 1, Important 2: guard order in the extracted nicknameRefusal
// helper — a DM-style entry with no Manage Nicknames permission either
// distinguishes which guard runs first (guild always wins).
test('not in a guild and lacking permission still gets the notInGuild line, not noPermission', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'sure\nNICKNAME: Bob' }) });
  const m = msg({
    mentionsLu: true, text: '@Lu change your name to Bob', inGuild: false, authorCanManageNicknames: false,
  });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, []);
  assert.deepEqual(s.sent, [`sure\n\n${NICKNAME_LINES.notInGuild}`]);
});

test('a name over 32 characters is refused with the tooLong line', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: `sure\nNICKNAME: ${'a'.repeat(33)}` }) });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to something long' });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, []);
  assert.deepEqual(s.sent, [`sure\n\n${NICKNAME_LINES.tooLong}`]);
});

// --- Fix round 1, Important 3(b): a rename request with no marker back --------

test('a rename request whose reply carries no NICKNAME line records the reason', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'sure comrade, no marker here' }) });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to Bob' });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, []);
  assert.deepEqual(s.sent, ['sure comrade, no marker here']);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('asked for a rename but no NICKNAME line came back'));
});

test('an ordinary message with no marker back does not record the no-marker reason', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: true, reply: 'just chatting' }) });
  const m = msg({ mentionsLu: true, text: '@Lu how are you' });
  await say(s, m);
  assert.equal(
    s.decisions.find('chan', m.messageId).reasons.includes('asked for a rename but no NICKNAME line came back'),
    false,
  );
});

// --- Fix round 1, Important 3(a): a truncated rename applied end-to-end -------

test('a length-cut reply keeps a trimmed-away marker and the nickname is applied end-to-end', async () => {
  const filler = 'This is a fairly long sentence about comradeship and the state';
  const content = `${filler}.\nNICKNAME: Bob`;
  const llm = { async chatWithFinish() { return { content, finishReason: 'length' }; } };
  const s = setup({ respondWithReason, llm, chooseChunks: async () => [] });
  const m = msg({ mentionsLu: true, text: '@Lu change your name to Bob' });
  await say(s, m);
  assert.deepEqual(s.calls.applyNickname, ['Bob']);
  assert.equal(s.sent.some((t) => t.includes('NICKNAME')), false, 'the marker must never reach Discord');
});

// --- Fix round 1, Minor 7: Lu's own history entry has the two new fields ------

test('the history entry recorded for Lu\'s own message carries the two new Entry fields, both false', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true, text: '@Lu hi' }));
  const last = s.history.entries('chan').at(-1);
  assert.equal(last.isLu, true);
  assert.equal(last.inGuild, false);
  assert.equal(last.authorCanManageNicknames, false);
});

// --- One reply at a time -------------------------------------------------------

test('while busy, only the latest waiting message is handled afterwards', async () => {
  const gates = [];
  const s = setup({
    respondWithReason: (args) => {
      s.calls.respond.push(args);
      return new Promise((resolve) => gates.push(() => resolve({ ok: true, reply: 'wot' })));
    },
  });
  const a = msg({ mentionsLu: true, text: '@Lu one' });
  const b = msg({ mentionsLu: true, text: '@Lu two' });
  const c = msg({ mentionsLu: true, text: '@Lu three' });
  await s.conversation.handleMessage(a, s.io);
  await s.conversation.handleMessage(b, s.io);
  await s.conversation.handleMessage(c, s.io);
  await tick();
  assert.equal(gates.length, 1);
  gates[0]();
  await tick(); await tick();
  assert.equal(gates.length, 2);
  gates[1]();
  await s.conversation.idle('chan');
  assert.deepEqual(s.calls.respond.map((r) => r.message), ['sam: @Lu one', 'sam: @Lu three']);
  assert.ok(s.decisions.find('chan', b.messageId).reasons.some((r) => r.startsWith('skipped')));
});

test('a waiting @mention is never bumped by an unjudged message', async () => {
  const gates = [];
  const s = setup({
    respondWithReason: (args) => {
      s.calls.respond.push(args);
      return new Promise((resolve) => gates.push(() => resolve({ ok: true, reply: 'wot' })));
    },
    isAddressed: async ({ entries }) => { s.calls.judge.push(entries); return { yes: false, reason: '' }; },
  });
  s.seedLu();
  const a = msg({ mentionsLu: true, text: '@Lu one' });
  const b = msg({ mentionsLu: true, text: '@Lu two' });
  const c = msg({ text: 'yeah same' });
  await s.conversation.handleMessage(a, s.io);
  await tick();
  assert.equal(gates.length, 1, 'a should be in flight');
  await s.conversation.handleMessage(b, s.io);
  await s.conversation.handleMessage(c, s.io);
  s.timers.fire(PAUSE_MS);
  await tick();
  gates[0]();
  await tick(); await tick();
  assert.equal(gates.length, 2, 'b should now be in flight');
  gates[1]();
  await s.conversation.idle('chan');
  assert.deepEqual(s.calls.respond.map((r) => r.message), ['sam: @Lu one', 'sam: @Lu two']);
  assert.ok(s.decisions.find('chan', c.messageId).reasons.includes('skipped: a message aimed at me was already waiting'));
});

test('a throw in the worker does not strand a pending job for out-of-order replay', async () => {
  let calls = 0;
  const s = setup({
    respondWithReason: async (args) => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return { ok: true, reply: 'wot' };
    },
  });
  const a = msg({ mentionsLu: true, text: '@Lu one' });
  const b = msg({ mentionsLu: true, text: '@Lu two' });
  await s.conversation.handleMessage(a, s.io);
  await s.conversation.handleMessage(b, s.io);
  await s.conversation.idle('chan');
  // b must be answered once, in its own turn — not replayed after some later message.
  assert.deepEqual(s.sent, [HEADACHE, 'wot']);
  await s.conversation.handleMessage(msg({ mentionsLu: true, text: '@Lu three' }), s.io);
  await s.conversation.idle('chan');
  assert.deepEqual(s.sent, [HEADACHE, 'wot', 'wot']);
});

test('a judge YES that fails to reply still posts the headache', async () => {
  const s = setup({
    respondWithReason: async () => ({ ok: false, reason: 'empty reply after stripping reasoning' }),
  });
  s.seedLu();
  const m = msg({ text: 'ana did you see the match' });
  await s.conversation.handleMessage(m, s.io);
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.deepEqual(s.sent, [HEADACHE]);
});

// --- Imperial Credits ---
// Awarding sits outside the reply pipeline, which is the structural lesson
// from LU2 (bot.py:347-348): credit accrues from taking part, not from
// getting Lu's attention. Commands early-return before awarding, so asking
// for your balance cannot pay you.

const creditsConfig = {
  enabled: true, min: 15, max: 25, cooldownSeconds: 30, minChars: 3,
  announceLevelUp: true, flushMs: 2000,
};

function creditsStore(seed = {}) {
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
    top: (k) => [...users.entries()]
      .map(([userId, r]) => ({ userId, name: r.name, credits: r.credits }))
      .sort((a, b) => b.credits - a.credits || a.userId.localeCompare(b.userId))
      .slice(0, k),
  };
}

test('an ordinary message earns credits', async () => {
  const store = creditsStore();
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({ text: 'hello comrades', authorId: 'u1' }), s.io);
  assert.equal(store.get('u1').credits, 25);
});

test('asking for your balance earns nothing', async () => {
  const store = creditsStore();
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({ text: 'lu credits', authorId: 'u1' }), s.io);
  assert.equal(store.get('u1').credits, 0);
});

test('asking for your balance replies with it and stops', async () => {
  const store = creditsStore({ u1: { credits: 1200, name: 'Bob', lastAwardAt: 0, messages: 9, voiceSeconds: 0 } });
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({ text: 'lu credits', authorId: 'u1', name: 'Bob' }), s.io);
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0], /1,200/);
  assert.match(s.sent[0], /level 5/);
});

test('a mentioned member reads as that member, not the asker', async () => {
  const store = creditsStore({ u2: { credits: 300, name: 'Ann', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({
    text: 'lu credits @Ann', authorId: 'u1', name: 'Bob',
    mentions: [{ id: 'u2', name: 'Ann' }],
  }), s.io);
  assert.match(s.sent[0], /Ann/);
  assert.match(s.sent[0], /300/);
});

test('the leaderboard replies and stops', async () => {
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({ text: 'lu leaderboard', authorId: 'u1' }), s.io);
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0], /1\. Bob/);
});

test('a bot message earns nothing', async () => {
  const store = creditsStore();
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({ text: 'hello comrades', authorId: 'u1', isBot: true }), s.io);
  assert.equal(store.get('u1').credits, 0);
});

test('crossing a level posts a line in the channel', async () => {
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({ text: 'hello comrades', authorId: 'u1', name: 'Bob' }), s.io);
  assert.ok(s.sent.some((t) => /level 1/.test(t)));
});

test('level-up announcements can be turned off', async () => {
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const s = setup({
    credits: store,
    config: { ...config, credits: { ...creditsConfig, announceLevelUp: false } },
  });
  await s.conversation.handleMessage(msg({ text: 'hello comrades', authorId: 'u1', name: 'Bob' }), s.io);
  assert.ok(!s.sent.some((t) => /reaches level/.test(t)));
  assert.equal(store.get('u1').credits, 115);
});

// --- F7: a disabled ledger must not let the model invent a balance ---
// With credits configured but switched off, "lu credits" is no longer
// recognised as a command and would otherwise reach the model with no
// creditsInstruction to anchor it -- free to fabricate a number. The spec
// forbids fabricated user-facing values.

test('F7: asking for your balance with the ledger disabled gets the fixed line, not the model', async () => {
  const s = setup({ credits: null, config: { ...config, credits: { ...creditsConfig, enabled: false } } });
  await s.conversation.handleMessage(msg({ text: 'lu credits', authorId: 'u1' }), s.io);
  assert.deepEqual(s.sent, [CREDITS_DISABLED]);
  assert.equal(s.calls.respond.length, 0);
});

test('F7: the leaderboard command with the ledger disabled gets the fixed line, not the model', async () => {
  const s = setup({ credits: null, config: { ...config, credits: { ...creditsConfig, enabled: false } } });
  await s.conversation.handleMessage(msg({ text: 'lu leaderboard', authorId: 'u1' }), s.io);
  assert.deepEqual(s.sent, [CREDITS_DISABLED]);
  assert.equal(s.calls.respond.length, 0);
});

test('F7: with no credits config at all, the commands are unaffected', async () => {
  const s = setup({});
  await say(s, msg({ text: 'lu credits', mentionsLu: true, authorId: 'u1' }));
  assert.ok(!s.sent.includes(CREDITS_DISABLED));
});

// Roughly 390 tests predate this feature and build config objects with no
// credits section. None of them may break.
test('with no store and no credits config, nothing changes', async () => {
  const s = setup({});
  await s.conversation.handleMessage(msg({ text: 'hello comrades', authorId: 'u1' }), s.io);
  // No throw is the assertion.
});

// --- Composing extra instructions ---
// buildMessages branches on extraInstruction being undefined, and an ordinary
// reply's system message must stay byte-identical to what it was before this
// feature. An empty string is not undefined.

test('an ordinary reply still passes no extra instruction', async () => {
  const s = setup({});
  await say(s, msg({ text: 'lu what do you think', mentionsLu: true }));
  assert.equal(s.calls.respond[0].extraInstruction, undefined);
});

test('with a store, the reply carries the speaker\'s balance', async () => {
  const store = creditsStore({ u1: { credits: 1200, name: 'Bob', lastAwardAt: 0, messages: 9, voiceSeconds: 0 } });
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await say(s, msg({ text: 'lu what do you think', authorId: 'u1', name: 'Bob', mentionsLu: true }));
  assert.match(s.calls.respond[0].extraInstruction, /1,2\d\d imperial credits/);
});

test('a rename request and the balance are both carried', async () => {
  const store = creditsStore({ u1: { credits: 1200, name: 'Bob', lastAwardAt: 0, messages: 9, voiceSeconds: 0 } });
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await say(s, msg({
    text: 'lu change your name to Stone', authorId: 'u1', name: 'Bob',
    mentionsLu: true, inGuild: true, authorCanManageNicknames: true,
  }));
  const instruction = s.calls.respond[0].extraInstruction;
  assert.match(instruction, /imperial credits/);
  assert.match(instruction, /NICKNAME/);
});

// --- F1: recording must not wait on the level-up announcement ---
// handleMessage runs once per gateway event and events are not serialised
// (src/discord.js:167-173). If the announcement's `await safeSend` sits
// before `history.record(entry)`, a second author's message can be recorded
// first while the first author's Discord round trip is still in flight,
// putting history in reverse arrival order.

test('F1: a message crossing a level is recorded before a concurrent message that arrives while the announcement is in flight', async () => {
  let resolveAnnouncement;
  const announcementSent = new Promise((resolve) => { resolveAnnouncement = resolve; });
  let sendCount = 0;
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const s = setup({
    credits: store,
    config: { ...config, credits: creditsConfig },
    send: async (text, sent) => {
      sendCount += 1;
      if (sendCount === 1) await announcementSent;
      sent.push(text);
      return `sent${sent.length}`;
    },
  });

  // Bob's message crosses level 0 -> 1, so handleMessage suspends inside the
  // level-up announcement's `await safeSend` before it ever gets to record.
  const bobDone = s.conversation.handleMessage(
    msg({ text: 'hello comrades', authorId: 'u1', name: 'Bob' }), s.io,
  );
  await tick();
  await tick();

  // While Bob's announcement is still pending, Ann's message arrives on a
  // separate gateway event and runs to completion.
  await s.conversation.handleMessage(
    msg({ text: 'hi there', authorId: 'u2', name: 'Ann' }), s.io,
  );

  resolveAnnouncement();
  await bobDone;

  const names = s.history.entries('chan').map((e) => e.name);
  const bobIndex = names.indexOf('Bob');
  const annIndex = names.indexOf('Ann');
  assert.ok(bobIndex !== -1 && annIndex !== -1, `expected both entries recorded, got ${JSON.stringify(names)}`);
  assert.ok(bobIndex < annIndex, `expected Bob recorded before Ann, got ${JSON.stringify(names)}`);
});

// --- F2: the level-up line itself must join history ---
// It is the only thing Lu says in a channel that was never recorded, so the
// next reply's prompt has no antecedent for it.

test('F2: the level-up announcement is recorded in history using the id safeSend returns', async () => {
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({ text: 'hello comrades', authorId: 'u1', name: 'Bob' }), s.io);
  const entries = s.history.entries('chan');
  const last = entries.at(-1);
  assert.equal(last.isLu, true);
  assert.match(last.text, /reaches level 1/);
  assert.equal(last.messageId, 'sent1');
  // And it comes after the triggering message, not before it.
  assert.equal(entries.at(-2).name, 'Bob');
});

test('F2: a reply following a level-up sees the announcement as prior context', async () => {
  const store = creditsStore({ u1: { credits: 90, name: 'Bob', lastAwardAt: 0, messages: 4, voiceSeconds: 0 } });
  const s = setup({ credits: store, config: { ...config, credits: creditsConfig } });
  await s.conversation.handleMessage(msg({ text: 'hello comrades', authorId: 'u1', name: 'Bob' }), s.io);
  await say(s, msg({ text: 'lu since when', mentionsLu: true, authorId: 'u2', name: 'Ann' }));
  const history = s.calls.respond.at(-1).history;
  assert.ok(history.some((h) => /reaches level 1/.test(h.content)));
});
