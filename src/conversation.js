import { decide } from './attention.js';
import { createPauser } from './pause.js';
import { toChatTurns } from './history.js';
import { EXPLAIN_RE, NOT_FOUND, formatDecision } from './decisions.js';
import { withTimeout, TimeoutError } from './timeout.js';
import { truncateForDiscord } from './discord.js';

// In character, and fixed, so the group reads it as "something broke" while
// anyone else just sees Lu having a bad moment. The real cause is in the
// decision log, for "lu explain".
export const HEADACHE = 'uh oh... i have a headache';

export function createConversation({
  config,
  history,
  decisions,
  persona,
  llm,
  chooseChunks,
  respondWithReason,
  isAddressed,
  now = Date.now,
  random = Math.random,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  const channels = new Map();

  function channel(id) {
    let c = channels.get(id);
    if (!c) {
      c = { io: null, lastChimeAt: null, busy: false, pending: null, idle: Promise.resolve() };
      channels.set(id, c);
    }
    return c;
  }

  function note(channelId, entry, reason) {
    decisions.find(channelId, entry.messageId)?.reasons.push(reason);
  }

  const pauser = createPauser({
    ms: config.trigger.pauseSeconds * 1000,
    onSettled: (channelId, entry) => { enqueue(channelId, { entry, kind: 'judge' }); },
    setTimeoutImpl,
    clearTimeoutImpl,
  });

  async function safeSend(state, text) {
    try {
      return await state.io.send(truncateForDiscord(text));
    } catch (err) {
      console.error('Failed to post to Discord:', err);
      return null;
    }
  }

  function split(channelId, entry) {
    const entries = history.entries(channelId);
    const i = entries.findIndex((e) => e.messageId === entry.messageId);
    return i === -1
      ? { prior: [], upTo: [entry] }
      : { prior: entries.slice(0, i), upTo: entries.slice(0, i + 1) };
  }

  // A direct mention outranks an unjudged message: only "judge" and "chime"
  // jobs can be bumped by a later arrival, never a pending "direct" one.
  function priority(kind) {
    return kind === 'direct' ? 1 : 0;
  }

  // One reply per channel at a time. While busy, only the newest waiting job
  // of at-least-equal priority is kept; a job that arrives while a
  // higher-priority one is pending is dropped instead of replacing it. Either
  // way, the loser's log says why.
  function enqueue(channelId, job) {
    const state = channel(channelId);
    if (state.busy) {
      if (!state.pending) {
        state.pending = job;
        return;
      }
      if (priority(job.kind) >= priority(state.pending.kind)) {
        note(channelId, state.pending.entry, 'skipped: a newer message came in while i was busy');
        state.pending = job;
      } else {
        note(channelId, job.entry, 'skipped: a message aimed at me was already waiting');
      }
      return;
    }
    state.busy = true;
    state.idle = (async () => {
      let next = job;
      while (next) {
        await run(channelId, next);
        next = state.pending;
        state.pending = null;
      }
      state.busy = false;
    })().catch((err) => {
      state.busy = false;
      console.error('Conversation worker failed:', err);
    });
  }

  async function run(channelId, { entry, kind }) {
    const rec = decisions.find(channelId, entry.messageId);
    if (kind === 'judge') {
      const verdict = await isAddressed({ entries: split(channelId, entry).upTo.slice(-6) });
      rec?.reasons.push(`judge said ${verdict.yes ? 'YES' : 'NO'}${verdict.reason ? ` (${verdict.reason})` : ''}`);
      if (!verdict.yes) {
        if (rec) rec.outcome = 'ignore';
        return;
      }
      if (rec) rec.outcome = 'reply';
    }
    await reply(channelId, entry, { direct: kind !== 'chime' }, rec);
  }

  async function reply(channelId, entry, { direct }, rec) {
    const state = channel(channelId);
    const typing = state.io.startTyping();
    const fail = async (reason) => {
      rec?.reasons.push(`reply failed: ${reason}`);
      // Nobody asked for a random chime-in, so a failed one stays silent.
      if (direct) await safeSend(state, HEADACHE);
    };

    try {
      let result;
      try {
        const { prior } = split(channelId, entry);
        result = await withTimeout(async (signal) => {
          const chunks = await chooseChunks(entry.text);
          return respondWithReason({
            message: `${entry.name}: ${entry.text}`,
            chunks,
            history: toChatTurns(prior),
            persona,
            llm,
            config,
            signal,
          });
        }, config.reply.timeoutSeconds * 1000, { setTimeoutImpl, clearTimeoutImpl });
      } catch (err) {
        await fail(err instanceof TimeoutError
          ? `reply timed out after ${config.reply.timeoutSeconds}s`
          : `model server error: ${err.message}`);
        return;
      }

      if (!result.ok) {
        await fail(result.reason);
        return;
      }

      const text = truncateForDiscord(result.reply);
      const id = await safeSend(state, text);
      if (id === null) {
        rec?.reasons.push('reply failed: discord would not take the message');
        return;
      }
      history.record({
        messageId: id, channelId, authorId: 'lu', name: 'Lu', isBot: true, isLu: true,
        mentionsLu: false, mentionsOthers: false, repliesToLu: false, repliesToOther: false,
        at: now(), text,
      });
      if (rec) {
        rec.sent = text;
        rec.reasons.push('replied');
      }
    } finally {
      // finally: a dropped reply and a thrown error must both stop the indicator.
      typing.stop();
    }
  }

  async function handleMessage(entry, io) {
    if (entry.isLu || !entry.text) return;
    const state = channel(entry.channelId);
    state.io = io;

    const explain = entry.isBot ? null : EXPLAIN_RE.exec(entry.text);
    if (explain) {
      const rec = decisions.find(entry.channelId, explain[1]);
      await safeSend(state, rec ? formatDecision(rec) : NOT_FOUND);
      return;
    }

    history.record(entry);
    const decision = decide({
      entry,
      history: history.entries(entry.channelId),
      state: { lastChimeAt: state.lastChimeAt },
      now: now(),
      config,
      random,
    });
    decisions.record(entry.channelId, {
      messageId: entry.messageId,
      authorName: entry.name,
      outcome: decision.outcome,
      reasons: [...decision.reasons],
      sent: null,
    });

    if (decision.outcome === 'ask-judge') {
      note(entry.channelId, entry, `waiting ${config.trigger.pauseSeconds}s for a pause before asking the judge`);
      const replaced = pauser.wait(entry.channelId, entry);
      if (replaced) note(entry.channelId, replaced, 'judge skipped: a newer message came in during the pause');
      return;
    }

    // Anything else ends a pending pause: the latest message is either aimed
    // at Lu directly (answered below) or not for him at all.
    const cancelled = pauser.cancel(entry.channelId);
    if (cancelled) note(entry.channelId, cancelled, 'judge skipped: the conversation moved on during the pause');

    if (decision.outcome === 'ignore') return;
    if (decision.trigger === 'chime') state.lastChimeAt = now();
    enqueue(entry.channelId, { entry, kind: decision.trigger === 'chime' ? 'chime' : 'direct' });
  }

  return {
    handleMessage,
    idle: (channelId) => channel(channelId).idle,
  };
}
