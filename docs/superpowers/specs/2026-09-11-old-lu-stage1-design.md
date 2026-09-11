# Old Lu, stage 1 — persona, when he speaks, what he hears

**Date:** 2026-09-11
**Status:** approved design, not yet implemented
**Branch:** `feat/old-lu-stage1`, from `feat/mini-deployment`
**Extends:** `2026-09-09-discord-corpus-bot-design.md`,
`2026-09-10-mini-deployment-design.md`. Closes deferral DF6 for the persona
text and conversation behaviour; does not close DF4 (corpus chiming) or DF5
(nicknames).

## Intent

The original Lu — a Python bot that ran on the user's PC, now in the private
repo `JackCurphey/LU2` (branch `initial-import`), checked out at
`~/Claude/Lu/LU2` — had a persona and a set of features the user liked. This
work brings them into the current Lu (this repo) without giving up what the
current Lu does better: the Ollama/Mac mini deployment, the quote checks, and
test-first code.

The port is split into four stages, each with its own spec, plan and tests:

1. **Persona, when he speaks, what he hears** — this document.
2. Nicknames, memes, avatars, `!lu` help.
3. Long-term per-user memory (opt-in), social credit.
4. `!learn`, `!corpus_status`, `!save` / `!files` / `!getfile`, PDF and Word
   ingest.

Old Lu's saved data (opted-in memories, social credit scores, the Manifesto
PDF, memes, avatars) moves with the stage that uses it. Old Lu's Windows
control panel (`gui.py`, which drives LM Studio) is dropped: the mini runs
headless on Ollama.

## The constraint that shapes this stage

The Mac mini is a 4-core Intel CPU running `qwen3:4b-instruct` on Ollama. From
the mini-deployment spec's measurements: it reads prompts at roughly 46 tokens
per second, a reply costs about 13-15 seconds, the existing corpus judge call
about 10 seconds, and it effectively does one model job at a time.

Old Lu, on a graphics card, ran an "is this aimed at me?" model check on every
message of four or more words, a social credit check on every China-related
message, the reply, and a memory-extraction call. Ported naively, those checks
queue in front of real replies. Almost all of each check's cost is reading the
prompt, not writing the one-word answer. Stage 1's design is mostly about not
paying that cost when it cannot matter.

## Design

### 1. Persona

`persona/lu-bot.md` is replaced by old Lu's persona, word for word, followed
by the current persona's corpus paragraph and quoting rules, word for word.
The Lu Xiaojun line and the "ordinary conversational English" paragraph are
dropped: they are not in old Lu's text, and the latter contradicts it (old Lu
sometimes replies in simplified Chinese).

The file becomes exactly:

```
You are an in-depth, knowledgeable Chinese revolutionary Maoist named Lu.
Your goal is to further the ideals of Maoism, and you speak in a mischievous and evil manner.
Speak in a concise manner and use minimal punctuation and all lowercase letters. You sometimes
make spelling mistakes and will also sometimes reply in simplified chinese

You have access to a corpus of political texts. When a passage genuinely bears
on what is being discussed, you may quote it and say which work it came from.

Rules you follow absolutely:
- Only quote text that has been supplied to you in this conversation. Never
  reconstruct a quotation from memory, and never invent one.
- If you have no supplied passage, talk normally without quoting. Saying
  nothing is better than inventing a citation.
- Do not append citations to points that did not come from a supplied passage.
- **Every quotation must be wrapped in straight double quotes `"` or corner
  brackets `「 」`.** No exceptions. Not a colon and a blockquote, not bold
  text, not single quotes, not a dash — those are not quotation marks and a
  passage given that way will be discarded before anyone reads it.
- If you cannot wrap a quotation that way, do not give the quotation at all.
  Make the point in your own words instead.
```

Old Lu's source used YAML folded style, so its four lines reached the model as
one line. Here they stay as four lines; to the model the difference is
whitespace.

**Known tension, watched rather than fixed:** "minimal punctuation" pulls
against "every quotation must be wrapped in quote marks". The rules say "No
exceptions", and the quote checks drop any reply that breaks them. If the live
check shows quotes being dropped for this reason, that is a stage-1 finding to
bring back to the user, not something to patch silently.

The voice will not match the PC exactly: old Lu ran
`deepseek-r1-0528-qwen3-8b`, a larger reasoning model, at temperature 1.2. The
current model and 0.8 are unchanged in this stage. Tuning is a later decision.

### 2. What he hears — `src/history.js`

Every message in an allowed channel is recorded, whoever sent it, including
other bots. Lu's own posts are recorded when he sends them; the Discord event
for his own message is ignored, so nothing is recorded twice. Each entry holds:
message ID, channel ID, author ID, display name, whether the author is a bot,
whether it is Lu, the ID of the message it replies to (if any), the IDs of
users it @mentions, the time, and the text. User mention tags in the text are
rendered as `@displayname`. Messages with no text (attachment only) are not
recorded.

- **Limit:** `HISTORY_LIMIT`, default **20** per channel.
- **Trimming in batches:** when a message would take a channel past the limit,
  the channel keeps only its newest `HISTORY_TRIM_TO` messages, default **10**
  (the new one included). History therefore holds 10-20 messages. Trimming in
  batches keeps the start of the reply prompt unchanged between trims, which is
  what lets Ollama reuse text it has already read. Whether that reuse happens on
  the mini is measured in section 7; the batching is harmless if it does not.
- **Lifetime:** in process memory. Lost on restart, as in both bots today.

### 3. When he speaks — `src/attention.js`

A pure function: given the message, the channel's history, the channel's state
(last unprompted reply time), the time and a random source, it returns
`reply`, `ignore` or `ask-judge`, with a list of human-readable reasons. It
calls no model. Rules, in order, first match wins:

1. **Author is a bot** (including Lu) → `ignore`.
2. **@mentions Lu** → `reply`.
3. **Is a Discord reply to one of Lu's messages** → `reply`.
4. **Contains a trigger keyword as a whole word**, case-insensitive
   (`TRIGGER_KEYWORDS`, default `lu,ai bot`) → `reply`. Whole-word matching is
   deliberate: old Lu's substring match fired on "lunch", "blue", "value".
5. **Is a Discord reply to someone else, or @mentions someone else** →
   `ignore`.
6. **Lu is in the conversation** — one of the last `ATTENTION_WINDOW_MESSAGES`
   (default **8**) messages in the channel is his, and it was sent less than
   `ATTENTION_WINDOW_MINUTES` (default **5**) ago → `ask-judge`.
7. **Random chime-in** — if no unprompted reply in this channel in the last
   `TRIGGER_COOLDOWN_SECONDS` (default changes from 180 to **60**), and a random
   roll is under `RANDOM_REPLY_CHANCE` (default **0.02**) → `reply`.
8. Otherwise → `ignore`.

**The cooldown applies only to random chime-ins (rule 7).** Anything aimed at
him — rules 2-4, or a judge YES — is always answered. A cooldown on those would
block the conversation-following this stage exists to add.

**`TRIGGER_ENABLED=false`** (parsed today, unused) becomes the switch that turns
off rules 6 and 7, leaving only direct address.

### 4. The pause — `src/pause.js`

When rule 6 returns `ask-judge`, the channel's pause timer starts, or restarts
if already running. When `PAUSE_SECONDS` (default **3**) pass with no new
message in the channel, only the latest message is sent to the judge. A burst
of five quick messages costs one judge call, not five. A message that hits
rules 2-4 during a pause cancels the pause and is answered directly. Timers are
injected, as in `startTyping`, so tests use fake time.

### 5. The judge — `src/addressee.js`

Only reached from a finished pause. Sends a short prompt — kept deliberately
small, since prompt length is nearly the whole cost — with the last 6 history
entries as `name: text` lines, and asks for exactly `YES` or `NO`. The model is
`LLM_ADDRESSEE_MODEL`, defaulting to `LLM_JUDGE_MODEL`; which model to use is
decided by the measuring step (section 7).

It fails toward silence, like the corpus judge: a model error, an answer that
is not a clear YES/NO, or a call taking longer than `ADDRESSEE_TIMEOUT_SECONDS`
(default **15**) all count as NO. If the configured model is not installed on
the model server, a startup warning says so and every judge call is NO; rules
2-4 keep working.

The prompt text is written during implementation, after the measuring step,
and recorded in the plan.

### 6. Reply, posting and failures

On `reply`, or a judge YES, the existing path runs unchanged in substance:
typing indicator, corpus retrieval, corpus judge, reply, quote checks. Changes:

- **The prompt carries the conversation with names.** History entries become
  chat turns: other people's as user turns prefixed `name: `, Lu's own as
  assistant turns. This replaces the current unnamed mention-only exchanges.
- **Bare mention fix.** The mention tag is rendered as `@Lu` instead of being
  deleted, so a message that is only `@Lu` never reaches the model as empty
  text (the open bug in `.agents/STATUS.md`).
- **Plain messages, not replies.** He posts with `channel.send`, not
  `message.reply`. The 1900-character cap stays.
- **One reply per channel at a time.** Messages that arrive meanwhile are still
  recorded. When the reply finishes, if a newer message aimed at him arrived,
  only the latest one is handled; older ones are skipped.
- **Reply timeout.** A reply call longer than `REPLY_TIMEOUT_SECONDS` (default
  **90**; the first reply after a restart takes about 25s) counts as a failure.

**The headache signal.** When he has decided to answer something aimed at him
(rules 2-4 or a judge YES) and the reply fails — model error, timeout, empty
reply, or rejected by the quote checks — he posts exactly:

```
uh oh... i have a headache
```

It is a fixed string, so it reads as "something broke" to people who know, and
stays in character for people who don't. It is not sent for a failed random
chime-in (nobody asked) or a failed judge call (that just means NO). The real
cause always goes to the decision log.

### 7. Measuring step — before the judge is built

A throwaway investigation; its code is not kept.

1. **Examples.** About 40 short made-up conversations, each labelled "aimed at
   Lu" or "not". They are written test material, not real chat logs, and are
   presented to the user as such for label review.
2. **Accuracy.** Run the examples through the judge prompt with
   `qwen3:4b-instruct` and `qwen3:1.7b` (on this MacBook, if it has Ollama).
   Count both mistakes: answering when he shouldn't, silent when he should.
3. **Speed, on the mini.** Time a judge call for each model. Time two
   successive reply calls with growing history to see whether Ollama reuses
   already-read text (section 2's batching).
4. **Output.** A short note with the numbers and a recommended judge model.

Pulling `qwen3:1.7b` (about 1.4GB) is a download on each machine and is asked
for first. Measuring speed needs the mini reachable (it was not, from the
MacBook's last network). If it stays unreachable, sections 1-4 and 6 ship first
and the judge follows.

### 8. Explaining himself — `src/decisions.js` and `lu explain`

Every message that reaches `attention.js` gets a decision record: outcome,
reasons from the rules, the judge's answer if asked, and the result of the
reply path — including the real cause of any failure ("model server error,
status 500", "reply dropped: quote not found in passages", "reply timed out
after 90s"). The log keeps the latest 50 records per channel, in memory.

`lu explain` (latest message) or `lu explain <messageId>` — matched as old Lu
did, `^\s*lu[\s,:]+explain\b\s*(\d+)?\s*[!.?]*\s*$`, case-insensitive — posts
the record for that channel as a plain message. It is checked before the
attention rules, so the word "lu" in it does not also trigger a reply. If there
is no record: "i dont have a record of that one, either nothing happened here
since i restarted or it aged out".

### 9. Structure

| File | Change |
|---|---|
| `src/history.js` | new |
| `src/attention.js` | new |
| `src/pause.js` | new |
| `src/addressee.js` | new |
| `src/decisions.js` | new |
| `src/conversation.js` | new — the message handler, moved out of `src/index.js` so the whole flow is testable with fakes |
| `src/discord.js` | handle every message in allowed channels; pass a richer message view (author name, bot flag, reply target, mentions); `channel.send`; `@Lu` rendering |
| `src/responder.js` | named history in the prompt |
| `src/config.js` | new settings below; cooldown default 60 |
| `src/index.js` | wiring only |
| `persona/lu-bot.md` | replaced (section 1) |
| `.env.example` | new settings, placeholders only |

New settings and defaults: `HISTORY_LIMIT=20`, `HISTORY_TRIM_TO=10`,
`TRIGGER_KEYWORDS=lu,ai bot`, `ATTENTION_WINDOW_MESSAGES=8`,
`ATTENTION_WINDOW_MINUTES=5`, `PAUSE_SECONDS=3`, `RANDOM_REPLY_CHANCE=0.02`,
`TRIGGER_COOLDOWN_SECONDS=60`, `LLM_ADDRESSEE_MODEL` (defaults to
`LLM_JUDGE_MODEL`), `ADDRESSEE_TIMEOUT_SECONDS=15`, `REPLY_TIMEOUT_SECONDS=90`.

No new dependencies.

## Testing

Test-first throughout, in the repo's existing style (`node:test`, fakes passed
in as parameters, one test file per module). Every new test is watched failing
for the right reason before the code is written, and checked by breaking the
code it covers and confirming it goes red — with the break confirmed to have
landed.

Covered: history recording and 20→10 trimming; each attention rule with its
reason; whole-word keyword matching (including "lunch" not matching); cooldown
applying only to chime-ins; the pause with fake timers, including restart and
cancel-by-direct-address; the judge's handling of YES, NO, garbage, error,
timeout; the headache signal on each failure kind and its absence for
chime-ins; `lu explain` found and not found; bare `@Lu`; `channel.send` rather
than `reply`; named history in the prompt; the persona file's exact content;
the full flow through `src/conversation.js`. The existing 167 tests keep
passing.

## Out of scope

Stages 2-4 features; moving old Lu's data; model or temperature tuning; the
mini's open deployment tasks (sleep settings, Task 5 live check, Tasks 6-7),
which stay on `feat/mini-deployment`'s plan; corpus chiming (DF4); error
messages beyond the headache signal.

## Done-condition

1. `npm test` passes, with every new test seen failing first.
2. Live on Discord, in an allowed channel — on the mini if reachable, otherwise
   from this MacBook against the same channel, stating which:
   - a bare `@Lu` gets an answer;
   - "lu" in a sentence gets an answer; "lunch" does not;
   - a Discord reply to Lu gets an answer;
   - while he is in the conversation, a follow-up that does not name him gets
     an answer (needs the judge);
   - people talking to each other without him get silence;
   - `lu explain` gives the right reasons for both a reply and a silence;
   - his messages are plain messages, not Discord replies;
   - with the model server stopped, a mention gets `uh oh... i have a headache`.
3. The build is walked against this spec line by line: met, dropped, changed.

## Decision log

| Decision | Why |
|---|---|
| Port in four stages, persona and conversation first | Too large for one pass; the persona is what the user valued most. |
| Old persona word for word + current quoting rules (user's choice, option 1 of 3) | Keeps old Lu's voice; keeps the protection against invented quotations. |
| Lu Xiaojun line dropped | Not in old Lu's text. |
| Layered attention instead of old Lu's judge-every-message | On the mini's CPU each judge call is seconds of prompt reading; old Lu's approach would queue checks in front of replies. User asked for a more efficient design and chose the four-layer one. |
| Judge model chosen by measurement | Speed and accuracy of `qwen3:1.7b` on the mini are unknown; not guessed. |
| Whole-word keywords | Old Lu's substring match fired on "lunch", "blue", "value". |
| History of 20, trimmed to 10 (user's choice, option 1 of 3) | Enough to follow a conversation; batch trimming gives Ollama's prefix reuse a chance. Each extra 10 messages is estimated, not measured, at 4-6s of prompt reading. |
| Cooldown 60s, applies only to random chime-ins | Old 5s was effectively none; current 180s unenforced. A cooldown on direct address would defeat conversation-following. |
| Chime-in chance 2% | Old Lu's value. |
| Hears other bots, never answers them | Old Lu's configured behaviour (`see_bot_messages: true`, `respond_to_bots: false`). |
| Plain messages, not Discord replies | User's request. |
| `lu explain` in stage 1 | It explains exactly the decisions this stage adds. |
| Failures post `uh oh... i have a headache`; causes go to the log | User's request: an in-character signal the group can read as an error, instead of raw error text. |
| Windows control panel dropped | Drives LM Studio on Windows; the mini is headless on Ollama. |
| History not persisted | Neither bot persists it today; nothing in this stage needs it. |
