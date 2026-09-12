# Old Lu, stage 1 — verification against the spec

Walks `docs/superpowers/specs/2026-09-11-old-lu-stage1-design.md` section by
section against what shipped at `0b2adb1` (branch `feat/old-lu-stage1`).
Evidence is file:line, a test name, or a live-check line from
`.superpowers/sdd/2026-09-11-old-lu-stage1/progress.md` (the ledger).

## 1. Persona — MET

`persona/lu-bot.md` is old Lu's text word for word plus the current quoting
rules, exactly as specified. Verified word-for-word against
`LU2 config.yaml:149-152` at Task 3 (ledger line 59). Test:
`test/persona.test.js` pins the file's exact content. Live check confirmed
the voice: "PASS persona voice: lowercase, mischievous, no capitals — matches
old Lu" (ledger line 109).

The tension the spec flagged ("minimal punctuation" vs "every quotation
wrapped in quote marks") was watched, not fixed, as instructed. Live check:
he used corner brackets `「」` for quotes, so nothing was dropped for missing
delimiters (see "Open items" below).

## 2. What he hears — `src/history.js` — MET

`createHistory({ limit = 20, trimTo = 10 })` (`src/history.js:3`); batch
trim `if (list.length > limit) list.splice(0, list.length - trimTo)`
(`src/history.js:13`). `@displayname` rendering of mention tags is in
`src/discord.js:13-19` (`toEntry`), not `history.js` itself, but produces the
same recorded text the spec describes. Lu's own posts are recorded when sent,
not from the Discord event, per Task 11/12 wiring (`src/conversation.js`).
Covered by `test/history.test.js` (recording, 20→10 trimming) and the
`src/conversation.js` full-flow tests.

## 3. When he speaks — `src/attention.js` — MET

Pure function, no model call, rules in order as specified:
1. bot author → ignore
2. @mentions Lu → reply
3. reply to Lu → reply
4. whole-word keyword match, case-insensitive (`src/attention.js:12-15`,
   `matchKeyword`, lookaround-based word boundary) → reply
5. reply/@mention to someone else → ignore
6. Lu in the window (`ATTENTION_WINDOW_MESSAGES`/`MINUTES`) → ask-judge
7. random chime-in gated by `TRIGGER_COOLDOWN_SECONDS` → reply
8. else ignore

Cooldown applies only to chime-ins — confirmed in code comment and logic at
`src/config.js:92` ("Applies only to random chime-ins...") and
`src/conversation.js:224-228`. `TRIGGER_ENABLED=false` still gates rules 6-7
per `src/config.js`. Whole-word matching (not substring) tested — "lunch"
does not match "lu" — and confirmed live: "PASS keyword 'lu ...' → reply"
without a lunch-triggered false positive in the example set (measurement.md
example 23/32, both `not`-labelled, used "lunch"/"anyone free for lunch" as
judge examples rather than a keyword-rule test, but the keyword unit tests in
`test/attention.test.js` cover "lunch" directly per the spec).

## 4. The pause — `src/pause.js` — CHANGED (R9 narrowed the cancel rule)

`createPauser` restarts on a new `ask-judge` message, fires `onSettled` with
only the latest message after `PAUSE_SECONDS` with no new message
(`src/pause.js`). Fake timers used in tests, per spec.

**Changed by R9:** the spec's line "A message that hits rules 2-4 during a
pause cancels the pause and is answered directly" was implemented in the
original brief as cancel-on-anything-not-ask-judge (P7's wording), which the
final whole-branch review found too broad — it also cancelled on a bot
message or a reply/mention aimed at someone else, stranding a live
conversation's judge check. R9 narrowed the cancel condition to exactly
rules 2-4 (mention, reply-to-Lu, keyword), matching the spec's literal text.
Shipped in `src/conversation.js:220-228`:
`const directAddress = decision.outcome === 'reply' && ['mention',
'reply-to-lu', 'keyword'].includes(decision.trigger);` — only this cancels
the pause. Commit `67feef1`.

## 5. The judge — `src/addressee.js` — CHANGED (R13, R14 revised the timeout and prompt bounding)

Reached only from a finished pause; asks exactly YES/NO with the last 6
history entries as `name: text` lines; fails toward silence on error,
unclear answer, or timeout (`src/addressee.js`). Model is
`LLM_ADDRESSEE_MODEL` defaulting to `LLM_JUDGE_MODEL`, per
`src/config.js:81` (`addresseeModel: env.LLM_ADDRESSEE_MODEL ||
env.LLM_JUDGE_MODEL`).

**Model and prompt chosen by measurement, as the spec required** (section
7): `qwen3:4b-instruct`, revision-3 prompt (279 chars), ruling R4/R5 in the
ledger, full numbers in `measurement.md`.

**CHANGED by R13/R14** (not anticipated by the spec): the live check found
the judge always timed out on real conversation history because Lu's own
long replies made the judge prompt too large for the mini's ~25 tok/s
uncached read speed. Fix, in two rounds:
- R13: truncate each judge line to a bounded length
  (`ADDRESSEE_LINE_CHARS`) and raise `ADDRESSEE_TIMEOUT_SECONDS` from 15 to
  30 (`.env.example:33`, `src/config.js:94`).
- R14: the first fix also head-truncated the last (judged) entry, risking a
  false NO on a long message with an end-loaded addressing cue. R14 exempts
  the last entry from head-truncation and instead tail-caps it at 600 chars
  (`ADDRESSEE_LAST_LINE_CHARS`, `src/addressee.js:31`, `truncateLastLine`,
  `src/addressee.js:43-49`), keeping the tail since addressing cues sit at
  the end of a sentence. Codepoint-safe slicing added to avoid splitting a
  surrogate pair. Commits `121a964`, `6710295`, `0b2adb1`.

Live check, re-tested after the fix: "judge said YES, no timeout" on a
long-history follow-up (ledger line "Judge fix (121a964) deployed to mini
and re-tested live").

## 6. Reply, posting and failures — CHANGED (R7 fixed a queue defect)

- Named conversation turns in the prompt: history converted via
  `toChatTurns()` (plan P2), consumed by `responder.js`'s `buildMessages`.
- Bare-mention fix: mention tags rendered as `@displayname`/`@Lu`, not
  deleted — `src/discord.js:13-19`, comment at line 14: "Mention tags are
  rendered, not deleted: deleting them left a bare '@Lu'...". Live check:
  "PASS bare @mention → reply (old bug fixed, no empty-content 400)".
- Plain messages via `channel.send`, not `message.reply`
  (`src/conversation.js:51`, `state.io.send(...)`); 1900-char cap
  (`src/discord.js:53`, `DISCORD_REPLY_LIMIT = 1900`). Live check: "PASS
  plain channel messages, no pings".
- One reply per channel at a time, priority queue for the pending slot:
  `src/conversation.js:67-104` (`priority()`, `enqueue`). A direct job is
  never replaced by a judge/chime job (see section on R7 below).
- Reply timeout `REPLY_TIMEOUT_SECONDS` (default 90) covers the whole reply
  path (plan P8) — `src/config.js`, `src/conversation.js`.
- Headache signal: exact string `HEADACHE = 'uh oh... i have a headache'`
  (`src/conversation.js:11`), sent only for a failed reply to something aimed
  at Lu, not for a failed chime-in or a failed judge call. Live check: "PASS
  headache: with Ollama stopped, @mention → 'uh oh... i have a headache';
  explain showed 'reply failed: model server error: fetch failed'; Ollama
  restored."

**CHANGED by R7** (queue defect found in Task 12 review, fixed before
Task 13): the brief's original enqueue let a pause-settled judge job replace
a waiting direct job, so a judge NO could silently drop a pending @mention —
contradicting spec §3/§6's "anything aimed at him is always answered." Fixed
by making the pending slot priority-ordered: a direct job is never replaced
by a judge or chime job; among equal priority, the newer wins. Commit
`9d1b7c2`. Further tightened by commit `67feef1` under R9 above (pause
cancellation narrowed so a judge job isn't spuriously dropped by non-direct
traffic either).

## 7. Measuring step — MET

Run entirely on the mini per plan P5 (Ollama not on the MacBook). 40 examples
(20/20 split), `qwen3:4b-instruct` and `qwen3:1.7b` compared for accuracy and
speed; `qwen3:1.7b` disqualified as a thinking model incompatible with the
3-token answer cap (measurement.md Step 7); cache-reuse confirmed (683/700,
694/711 tokens reused across an interleaved judge call — measurement.md
Step 6). Output: `measurement.md`, with the recommendation
`qwen3:4b-instruct` + revision-3 prompt, explicitly not a clean pass (7/40
mistakes, one over the plan's 6-mistake threshold after 3 allowed
revisions) — reported as-is per the brief's "stop and report" instruction.
Ruling R4/R5 adopt it.

## 8. Explaining himself — `src/decisions.js` and `lu explain` — MET

`EXPLAIN_RE = /^\s*lu[\s,:]+explain\b\s*(\d+)?\s*[!.?]*\s*$/i`
(`src/decisions.js:6`) matches old Lu's pattern exactly. `NOT_FOUND` text
matches the spec's exact string (`src/decisions.js:8`). Log keeps latest 50
records per channel (`src/decisions.js:13`, `perChannel = 50`). Checked
before attention rules so "lu" inside "lu explain" doesn't also trigger a
reply, and not recorded in history (plan P6). Live check: "PASS lu explain
for both a reply and a silence; not itself answered, not recorded."

## 9. Structure — MET

All files listed in the spec's table exist as specified: `src/history.js`,
`src/attention.js`, `src/pause.js`, `src/addressee.js`, `src/decisions.js`,
`src/conversation.js`, plus modifications to `src/discord.js`,
`src/responder.js`, `src/config.js`, `src/index.js`, `persona/lu-bot.md`,
`.env.example`. No new dependencies (`package.json` unchanged; ledger notes
this throughout). New settings all present in `src/config.js` and
`.env.example`, with one value changed from the spec's stated default — see
Step B below (`ADDRESSEE_TIMEOUT_SECONDS` 15 → 30, R13).

## Out of scope — MET (correctly excluded)

Stages 2-4 features, old Lu's data migration, model/temperature tuning, the
mini's remaining deployment tasks, corpus chiming (DF4), and error messages
beyond the headache signal were not touched on this branch. Confirmed by
`git log 7cc4935..HEAD` (ledger commits) and by the plan's own scope
boundary — no commit here touches `feat/mini-deployment`'s open tasks.

## Done-condition — MET

1. `npm test` passes: 270/270 (up from 167 baseline + stage-1 additions),
   every new test watched failing first per the ledger's task-by-task
   entries and mutation checks.
2. Live on Discord, on the mini, in `#lu-bot-chat`: all eight listed
   behaviours passed (see Live check below), including the headache signal
   with the model server stopped.
3. This document is the line-by-line walk against the spec required by
   condition 3.

## Live check

Channel: `#lu-bot-chat` in Cry's Cantina. Deployed commit at test time:
`67feef1` (one instance running on the mini, confirmed by rsync + `npm ci` +
kickstart before the checklist). Tester posted as the user's own Discord
account ("Goldylocks") — not a separate bot or test account.

| Result | Item |
|---|---|
| PASS | bare `@mention` → reply (old bug fixed, no empty-content 400) |
| PASS | keyword "lu ..." → reply |
| PASS | follow-up with no name while in the window → pause → judge YES → reply (headline feature, working live) |
| PASS | Discord reply to Lu → reply |
| PASS | message @mentioning someone else → silence, reason "it @mentions someone else", no model call |
| PASS | `lu explain` for both a reply and a silence; not itself answered, not recorded |
| PASS | plain channel messages, no pings |
| PASS | persona voice: lowercase, mischievous, no capitals — matches old Lu |
| PASS | headache: with Ollama stopped, `@mention` → "uh oh... i have a headache"; explain showed "reply failed: model server error: fetch failed"; Ollama restored |
| FAIL (then fixed) | "anyone want lunch tomorrow" → silence for the WRONG reason: "judge said NO (judge timed out after 15s)" — this is the defect fixed by R13/R14, re-tested and confirmed fixed live after `121a964` |

## Open items for the user

1. **Judge false-YES rate.** Measured 6 of 20 on examples not aimed at Lu
   (measurement.md, revision-3 prompt). A judge YES has no cooldown — every
   reply refreshes the 5-minute attention window — so in a busy channel Lu
   can hold the floor across several judge YESes in a row. Ruling R10
   deliberately did not change this: it is the spec's approved design (no
   cooldown on anything aimed at Lu), and the false-YES rate was already
   flagged at measurement time. This is a tuning question for the user, not
   a defect.
2. **Invented quotations with no corpus loaded.** Lu attributes invented
   quotations to Mao in most live replies. This is not a stage-1 regression:
   `src/quotes.js`'s length cap and undelimited-attribution checks run with
   no corpus, but the fabrication-matching check (`needsCorpus: true`,
   `src/quotes.js:408-434`) is skipped entirely when there are no passages to
   match against (`src/quotes.js:461-469`, `checkQuoteLength`) — this is
   spec-sanctioned behaviour from the original design (§6, "with no supplied
   passage, talk normally without quoting" is a persona instruction, not a
   code-enforced check). The persona forbids it; the model does it anyway.
3. **"Minimal punctuation" vs quoting-rule tension.** The spec asked this be
   watched, not fixed. Live check: he used corner brackets `「」` for quotes,
   so nothing was dropped for missing delimiters in the live check. The
   tension has not yet visibly cost a dropped quote, but the sample is small
   (one live check session).
4. **Ollama's context window is 4096 tokens** on the mini's
   `qwen3:4b-instruct` (confirmed via `ollama ps`, ledger). Stage 1's prompts
   (roughly 600-1300 tokens measured) fit comfortably. Once a corpus exists,
   up to 5 retrieved chunks of ~600 words each could exceed 4096 tokens — a
   pre-existing risk, not introduced by stage 1, but worth deciding before
   corpus ingestion ships.
