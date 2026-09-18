import { decide } from './attention.js';
import { createPauser } from './pause.js';
import { toChatTurns } from './history.js';
import { EXPLAIN_RE, NOT_FOUND, formatDecision } from './decisions.js';
import { withTimeout, TimeoutError } from './timeout.js';
import { truncateForDiscord } from './discord.js';
import { NICKNAME_REQUEST_RE, NICKNAME_RESET_RE, NICKNAME_INSTRUCTION, extractNickname, validateNickname, NICKNAME_LINES } from './nickname.js';
import { awardForMessage } from './credits/earn.js';
import { pickMode, moodInstruction } from './mood.js';
import {
  parseMemberRename, matchesMemberName, RENAME_LINES, memberRenamedInstruction, pickNameInstruction,
} from './rename.js';
import { parseSuggestion, SUGGESTION_LINES } from './suggestions.js';
import {
  LEADERBOARD_RE, resolveTarget, isCreditsCommand,
  formatCredits, formatLeaderboard, formatLevelUp, creditsInstruction,
  CREDITS_DISABLED, CREDITS_STANDING_RULE, mentionsLedger,
} from './credits/commands.js';

// validateNickname's failure reasons that have a matching in-character line.
// 'empty' has no line of its own (it only arises from a hand-crafted marker
// like "NICKNAME: ***" — the model is instructed never to send that), so it
// falls through to no status line, same as any other unmapped reason.
const VALIDATION_LINES = { 'too-long': 'tooLong', mentions: 'mentions' };

// Shared by both the deterministic reset path and the marker-driven rename
// path in reply() below — guard order (guild first, then permission) and the
// status lines/reasons must stay byte-identical between the two. Returns
// null when neither guard fires, meaning the caller may proceed.
function nicknameRefusal(entry, config) {
  if (!entry.inGuild) {
    return { statusLine: NICKNAME_LINES.notInGuild, reason: 'nickname change refused: not in a server' };
  }
  if (config.nickname.requirePermission && !entry.authorCanManageNicknames) {
    return { statusLine: NICKNAME_LINES.noPermission, reason: 'nickname change refused: asker lacks Manage Nicknames' };
  }
  return null;
}

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
  credits = null,
  // Writes a suggestion down, wired in src/index.js. Kept out of this module
  // so the conversation never touches the filesystem, and so a test can watch
  // what was recorded without a temporary directory.
  recordSuggestion = null,
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

  // Who a member rename is aimed at. A typed name is looked up among recent
  // speakers and through Discord's member search; exactly one person must
  // match, or nobody is renamed. Returns { id, name } or { line, reason }.
  async function findRenameTarget(channelId, entry, target, io) {
    if (target.id) return target;
    const typed = target.typed;
    const found = new Map();
    for (const e of history.entries(channelId)) {
      if (!e.isLu && matchesMemberName({ displayName: e.name }, typed)) found.set(e.authorId, e.name);
    }
    let searchNote = null;
    try {
      for (const m of await io.findMembers(typed)) found.set(m.id, m.name);
    } catch (err) {
      searchNote = `member search failed (${err.message}); used recent speakers only`;
    }
    if (found.size === 1) {
      const [[id, name]] = found;
      return { id, name, searchNote };
    }
    return found.size === 0
      ? { line: RENAME_LINES.targetUnknown(typed), reason: `rename refused: nobody called ${typed}`, searchNote }
      : { line: RENAME_LINES.targetAmbiguous(typed), reason: `rename refused: ${found.size} people called ${typed}`, searchNote };
  }

  // Lu is renamed through his own nickname; anyone else through the member API.
  // The status line for a failure is worded for whichever it was.
  async function renameTo(io, entry, who, name) {
    const outcome = who.id === entry.luId
      ? await io.applyNickname(name)
      : await io.renameMember(who.id, name);
    if (outcome.ok) return { ok: true };
    const line = who.id === entry.luId
      ? NICKNAME_LINES[outcome.reason] ?? null
      : RENAME_LINES[outcome.reason]?.(who.name) ?? NICKNAME_LINES[outcome.reason] ?? null;
    return { ok: false, line, reason: `rename of ${who.name} failed: ${outcome.reason}` };
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
      // A reset carries no name, so nothing has to come back from the model
      // — it is handled directly below, and (per the comment on
      // NICKNAME_RESET_RE) never needs the instruction injected.
      const asksReset = config.nickname.enabled && NICKNAME_RESET_RE.test(entry.text);
      const memberRename = config.nickname.enabled && !asksRename
        ? parseMemberRename(entry.text, {
          mentions: entry.mentions ?? [], authorId: entry.authorId, authorName: entry.name, luId: entry.luId,
        })
        : null;
      // Set before the reply when a member rename was refused or failed.
      let renameStatus = null;
      // The member waiting for Lu to choose their name with a NICKNAME line.
      let renamePick = null;
      let result;
      try {
        const { prior } = split(channelId, entry);
        // Composed rather than a single expression: this used to be nickname-only,
        // and the next feature that wants a fragment should not have to add a
        // third parameter. Stays undefined when there is nothing to add --
        // buildMessages branches on it and an ordinary reply's system message
        // must stay byte-identical to what it was before credits existed.
        const instructions = [];
        // Which Lu answers, chosen per reply so the register varies instead of
        // averaging into one flat voice (see the header of src/mood.js). Null
        // when modes are off or nothing is weighted, and then nothing is added
        // and the reply is byte-identical to what it was before modes existed.
        const mode = config.mood?.enabled
          ? pickMode({ weights: config.mood.weights ?? {}, random })
          : null;
        if (mode) {
          instructions.push(moodInstruction(mode));
          rec?.reasons.push(`mode: ${mode}`);
        }
        if (asksRename && !asksReset) instructions.push(NICKNAME_INSTRUCTION);
        // Someone else's name (see src/rename.js). A given name, or a reset,
        // is applied before the reply so Lu reacts to what really happened;
        // with no name he chooses one, and it is applied after.
        if (memberRename) {
          const refusal = nicknameRefusal(entry, config);
          const who = refusal ? null : await findRenameTarget(channelId, entry, memberRename.target, state.io);
          if (who?.searchNote) rec?.reasons.push(who.searchNote);
          if (refusal) {
            renameStatus = refusal.statusLine;
            rec?.reasons.push(refusal.reason);
          } else if (who.line) {
            renameStatus = who.line;
            rec?.reasons.push(who.reason);
          } else if (!memberRename.reset && memberRename.name === null) {
            renamePick = who;
            instructions.push(pickNameInstruction({ asker: entry.name, who: who.name }));
          } else {
            let name = null;
            if (!memberRename.reset) {
              const validation = validateNickname(memberRename.name);
              if (validation.ok) {
                name = validation.name;
              } else {
                renameStatus = RENAME_LINES[VALIDATION_LINES[validation.reason]]?.(who.name) ?? null;
                rec?.reasons.push(`rename refused: ${validation.reason}`);
              }
            }
            if (memberRename.reset || name !== null) {
              const outcome = await renameTo(state.io, entry, who, name);
              if (outcome.ok) {
                rec?.reasons.push(name === null ? `reset the name of ${who.name}` : `renamed ${who.name} to "${name}"`);
                instructions.push(memberRenamedInstruction({ asker: entry.name, who: who.name, name }));
              } else {
                renameStatus = outcome.line;
                rec?.reasons.push(outcome.reason);
              }
            }
          }
        }
        // The standing rule is always here while credits are on; the balance
        // itself only when someone has raised the subject, or on an occasional
        // unprompted roll. Injecting the balance every time is what made Lu
        // mention credits in almost every reply -- the fragment asked him not
        // to force it, which was never going to beat the number being in front
        // of him on every turn. The standing rule is what keeps a reply that
        // raises the ledger without a balance from inventing one.
        if (credits && config.credits?.enabled) {
          instructions.push(CREDITS_STANDING_RULE);
          const raised = mentionsLedger(entry.text);
          if (raised || random() < (config.credits.mentionChance ?? 0)) {
            instructions.push(creditsInstruction({
              name: entry.name,
              credits: credits.get(entry.authorId).credits,
            }));
            rec?.reasons.push(raised ? 'ledger: they raised it' : 'ledger: unprompted');
          }
        }
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
            extraInstruction: instructions.length > 0 ? instructions.join('\n\n') : undefined,
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
      let statusLine = renameStatus;
      let renameSucceeded = false;
      if (asksReset) {
        // Deterministic path: no marker was ever expected here (the
        // instruction was not even injected), so there is no "no NICKNAME
        // line came back" diagnostic to raise — that reason is reserved for
        // a genuine rename the model failed to act on. Run the same guards,
        // in the same order, as the marker-driven path below.
        const refusal = nicknameRefusal(entry, config);
        if (refusal) {
          statusLine = refusal.statusLine;
          rec?.reasons.push(refusal.reason);
        } else {
          const outcome = await state.io.applyNickname(null);
          if (outcome.ok) {
            renameSucceeded = true;
            rec?.reasons.push('reset nickname to the default (asked directly)');
          } else {
            statusLine = NICKNAME_LINES[outcome.reason] ?? null;
            rec?.reasons.push(`nickname change failed: ${outcome.reason}`);
          }
        }
        // A marker in the same reply was already stripped above; the reset
        // was already handled directly, so that marker's own request (rename
        // or reset) is ignored rather than acted on a second time.
        if (request) rec?.reasons.push('ignored a NICKNAME line: the reset was handled directly');
      } else if (!request) {
        // No marker. If a rename was actually asked for, the decision log
        // should say the model never sent one back — "lu explain" otherwise
        // has nothing to point to for a rename that silently never happened.
        if (asksRename) rec?.reasons.push('asked for a rename but no NICKNAME line came back');
        if (renamePick) rec?.reasons.push(`asked to rename ${renamePick.name} but no NICKNAME line came back`);
      } else if (renamePick) {
        const validation = request.reset ? { ok: false, reason: 'reset' } : validateNickname(request.name);
        if (!validation.ok) {
          statusLine = RENAME_LINES[VALIDATION_LINES[validation.reason]]?.(renamePick.name) ?? null;
          rec?.reasons.push(`rename refused: ${validation.reason}`);
        } else {
          const outcome = await renameTo(state.io, entry, renamePick, validation.name);
          if (outcome.ok) {
            renameSucceeded = true;
            rec?.reasons.push(`renamed ${renamePick.name} to "${validation.name}"`);
          } else {
            statusLine = outcome.line;
            rec?.reasons.push(outcome.reason);
          }
        }
      } else if (!asksRename) {
        rec?.reasons.push('ignored a NICKNAME line nobody asked for');
      } else {
        const refusal = nicknameRefusal(entry, config);
        if (refusal) {
          statusLine = refusal.statusLine;
          rec?.reasons.push(refusal.reason);
        } else if (request.reset) {
          const outcome = await state.io.applyNickname(null);
          if (outcome.ok) {
            renameSucceeded = true;
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
              renameSucceeded = true;
              rec?.reasons.push(`changed nickname to "${validation.name}"`);
            } else {
              statusLine = NICKNAME_LINES[outcome.reason] ?? null;
              rec?.reasons.push(`nickname change failed: ${outcome.reason}`);
            }
          }
        }
      }

      const combined = statusLine
        ? (strippedText ? `${strippedText}\n\n${statusLine}` : statusLine)
        : strippedText;
      if (combined === '') {
        if (renameSucceeded) {
          // A marker-only reply whose rename worked has nothing left to post
          // — no status line, no leftover text. Renaming himself is not a
          // failure, so this must not fall into the empty-reply/headache
          // path (which would post the headache in the same breath as the
          // rename). Stay silent; the decision log still says what happened.
          rec?.reasons.push('replied with a nickname change only');
          return;
        }
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
        inGuild: false, authorCanManageNicknames: false,
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

    // A command like the ones below: answered and stopped, so the wording
    // reaches the file exactly as it was typed rather than through the model,
    // which would be free to paraphrase it. Ahead of the credit award for the
    // same reason the ledger commands are -- a command does not pay its asker.
    if (recordSuggestion && config.suggestions?.enabled && !entry.isBot) {
      const suggestion = parseSuggestion(entry.text);
      if (suggestion) {
        if (suggestion.text === '') {
          await safeSend(state, SUGGESTION_LINES.empty());
          return;
        }
        try {
          await recordSuggestion({ entry, text: suggestion.text });
        } catch (err) {
          // Never confirm a capture that did not happen: the person would
          // walk away believing their idea was written down.
          console.error('Failed to record a suggestion:', err);
          await safeSend(state, SUGGESTION_LINES.failed());
          return;
        }
        await safeSend(state, SUGGESTION_LINES.noted());
        return;
      }
    }

    // With the ledger switched off, a credits/leaderboard command is no
    // longer recognised below and would otherwise reach the model with no
    // creditsInstruction to anchor it, free to invent a balance -- forbidden
    // by the spec. Answered deterministically instead (F7).
    if (config.credits && !config.credits.enabled && !entry.isBot
      && (LEADERBOARD_RE.test(entry.text) || isCreditsCommand(entry))) {
      await safeSend(state, CREDITS_DISABLED);
      return;
    }

    // Commands answer and stop, exactly as "lu explain" does: a command is not
    // conversation and must not enter the prompt. This ordering is also what
    // stops a command paying its own asker -- awarding is below it.
    let award = null;
    if (credits && config.credits?.enabled && !entry.isBot) {
      if (LEADERBOARD_RE.test(entry.text)) {
        await safeSend(state, formatLeaderboard(credits.top(10)));
        return;
      }
      if (isCreditsCommand(entry)) {
        const target = resolveTarget(entry, entry.luId);
        const who = target ?? { id: entry.authorId, name: entry.name };
        await safeSend(state, formatCredits({ name: who.name, credits: credits.get(who.id).credits }));
        return;
      }

      // Outside the reply pipeline on purpose (LU2, bot.py:347-348): credit
      // accrues from taking part, not from getting Lu's attention. Entirely
      // synchronous, so nothing here can delay the record below.
      award = awardForMessage(credits, entry, { now, random, config });
    }

    // Recorded before anything below gets a chance to await: handleMessage
    // runs once per gateway event and events are not serialised
    // (src/discord.js:167-173), so an await placed ahead of this record would
    // let a second author's message be recorded first while this one's
    // Discord round trip for the level-up line is still in flight, putting
    // history in reverse arrival order (F1).
    history.record(entry);

    if (award?.leveledTo !== null && award !== null && config.credits.announceLevelUp) {
      const text = formatLevelUp({ name: entry.name, level: award.leveledTo });
      const id = await safeSend(state, text);
      // Recorded after the triggering entry, using the id safeSend returns --
      // the same shape as Lu's ordinary replies (see history.record at
      // line ~298) -- so the next prompt has an antecedent for it (F2). Not
      // added to the decision log: `lu explain` is about why he replied, and
      // this is not a reply.
      if (id !== null) {
        history.record({
          messageId: id, channelId: entry.channelId, authorId: 'lu', name: 'Lu', isBot: true, isLu: true,
          mentionsLu: false, mentionsOthers: false, repliesToLu: false, repliesToOther: false,
          inGuild: false, authorCanManageNicknames: false,
          at: now(), text,
        });
      }
    }
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
