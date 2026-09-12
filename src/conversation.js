import { decide } from './attention.js';
import { createPauser } from './pause.js';
import { toChatTurns } from './history.js';
import { EXPLAIN_RE, NOT_FOUND, formatDecision } from './decisions.js';
import { withTimeout, TimeoutError } from './timeout.js';
import { truncateForDiscord } from './discord.js';
import { NICKNAME_REQUEST_RE, NICKNAME_INSTRUCTION, extractNickname, validateNickname, NICKNAME_LINES } from './nickname.js';

// validateNickname's failure reasons that have a matching in-character line.
// 'empty' has no line of its own (it only arises from a hand-crafted marker
// like "NICKNAME: ***" — the model is instructed never to send that), so it
// falls through to no status line, same as any other unmapped reason.
const VALIDATION_LINES = { 'too-long': 'tooLong', mentions: 'mentions' };

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
      // A stranded pending job must not be replayed after some later
      // message's reply, out of order — drop it along with the failure.
      state.pending = null;
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
    const fail = async (reason) => {
      rec?.reasons.push(`reply failed: ${reason}`);
      // Nobody asked for a random chime-in, so a failed one stays silent.
      if (direct) await safeSend(state, HEADACHE);
    };

    let typing;
    try {
      typing = state.io.startTyping();
      const asksRename = config.nickname.enabled && NICKNAME_REQUEST_RE.test(entry.text);
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
            extraInstruction: asksRename ? NICKNAME_INSTRUCTION : undefined,
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

      // The marker never reaches Discord, whatever else happens to it — strip
      // it before any of the outcomes below, none of which post it back.
      const { text: strippedText, request } = extractNickname(result.reply);
      let statusLine = null;
      if (!request) {
        // No marker: nothing to do.
      } else if (!asksRename) {
        rec?.reasons.push('ignored a NICKNAME line nobody asked for');
      } else if (!entry.inGuild) {
        statusLine = NICKNAME_LINES.notInGuild;
        rec?.reasons.push('nickname change refused: not in a server');
      } else if (config.nickname.requirePermission && !entry.authorCanManageNicknames) {
        statusLine = NICKNAME_LINES.noPermission;
        rec?.reasons.push('nickname change refused: asker lacks Manage Nicknames');
      } else if (request.reset) {
        const outcome = await state.io.applyNickname(null);
        if (outcome.ok) {
          rec?.reasons.push('reset nickname to the default');
        } else {
          statusLine = NICKNAME_LINES[outcome.reason] ?? null;
          rec?.reasons.push(`nickname change failed: ${outcome.reason}`);
        }
      } else {
        const validation = validateNickname(request.name);
        if (!validation.ok) {
          statusLine = NICKNAME_LINES[VALIDATION_LINES[validation.reason]] ?? null;
          rec?.reasons.push(`nickname change refused: ${validation.reason}`);
        } else {
          const outcome = await state.io.applyNickname(validation.name);
          if (outcome.ok) {
            rec?.reasons.push(`changed nickname to "${validation.name}"`);
          } else {
            statusLine = NICKNAME_LINES[outcome.reason] ?? null;
            rec?.reasons.push(`nickname change failed: ${outcome.reason}`);
          }
        }
      }

      const combined = statusLine
        ? (strippedText ? `${strippedText}\n\n${statusLine}` : statusLine)
        : strippedText;
      if (combined === '') {
        await fail('empty reply after stripping reasoning');
        return;
      }

      const text = truncateForDiscord(combined);
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
      // finally: a dropped reply and a thrown error must both stop the
      // indicator — guarded, since startTyping itself may be what threw.
      typing?.stop();
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

    // Only a message that is itself going to be answered as direct address
    // (rules 2-4: mention, reply-to-Lu, keyword) cancels a pending pause. A
    // random chime-in or anything ignored — including another bot's message,
    // or a reply/mention aimed at someone else — leaves the pause running, so
    // it still reaches the judge when it settles.
    const directAddress = decision.outcome === 'reply'
      && ['mention', 'reply-to-lu', 'keyword'].includes(decision.trigger);
    if (directAddress) {
      const cancelled = pauser.cancel(entry.channelId);
      if (cancelled) note(entry.channelId, cancelled, 'judge skipped: a message aimed at me came first');
    }

    if (decision.outcome === 'ignore') return;
    if (decision.trigger === 'chime') state.lastChimeAt = now();
    enqueue(entry.channelId, { entry, kind: decision.trigger === 'chime' ? 'chime' : 'direct' });
  }

  return {
    handleMessage,
    idle: (channelId) => channel(channelId).idle,
  };
}
