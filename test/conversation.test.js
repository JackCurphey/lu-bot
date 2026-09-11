import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, HEADACHE } from '../src/conversation.js';
import { createHistory } from '../src/history.js';
import { createDecisionLog, NOT_FOUND } from '../src/decisions.js';

const config = {
  trigger: {
    keywords: ['lu', 'ai bot'], randomReplyChance: 0.02, cooldownSeconds: 60, windowMessages: 8,
    windowMinutes: 5, pauseSeconds: 3, enabled: true, maxQuoteChars: 400, addresseeTimeoutSeconds: 15,
  },
  reply: { timeoutSeconds: 90 },
  llm: { chatModel: 'chat' },
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
    at: T0, text: 'hello', ...over,
  };
}
const luSaid = (text = 'the state is a tool') => msg({ authorId: 'lu', name: 'Lu', isLu: true, isBot: true, text });

function setup(over = {}) {
  const timers = fakeTimers();
  const history = createHistory({ limit: 20, trimTo: 10 });
  const decisions = createDecisionLog();
  const calls = { respond: [], judge: [] };
  const sent = [];
  let typingStarts = 0; let typingStops = 0;
  const io = {
    async send(text) { sent.push(text); return `sent${sent.length}`; },
    startTyping() { typingStarts++; return { stop() { typingStops++; } }; },
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
  await s.conversation.handleMessage(msg({ text: 'hmm' }), s.io);
  await say(s, msg({ mentionsLu: true, text: '@Lu answer me' }));
  assert.equal(s.timers.count(PAUSE_MS), 0);
  assert.equal(s.calls.judge.length, 0);
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
