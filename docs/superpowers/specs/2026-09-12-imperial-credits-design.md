# Imperial Credits — an activity ledger for Lu

**Date:** 2026-09-12
**Status:** approved design, not yet implemented
**Branch:** `spec/imperial-credits`, from `feat/mini-deployment`
**Extends:** `2026-09-11-old-lu-stage1-design.md`. Part of stage 3 of the
old-Lu port. Does **not** port LU2's Social Credit; that is a separate,
later spec (see "Two numbers, not one" below).

## Intent

Discord servers commonly run a levelling bot — MEE6, Arcane, Amari — that
awards points for taking part and turns them into a level and a leaderboard.
The user wants that for Lu, with the currency called **Imperial Credits**.

Separately, the original Lu (`JackCurphey/LU2`, branch `initial-import`,
checked out at `~/Claude/Lu/LU2`) already has a feature called **Social
Credit**. It is not a levelling system: `social_credit.py` scores
China-related *sentiment* through a keyword gate and an LLM verdict, at ±5 a
time. The two are different engines that happen to want similar names.

### Two numbers, not one

Decided by the user: Lu will eventually keep **two independent scores**.

| | **Imperial Credits** | **Social Credit** |
|---|---|---|
| Earned by | taking part — messages, later voice | what you say about China |
| Mechanism | random 15-25 per eligible message, cooldown-gated | keyword gate → LLM sentiment verdict, ±5 |
| Direction | only ever goes up | goes up and down |
| Status | **this spec** | a later spec; port from LU2 |

This spec builds Imperial Credits **only**. Social Credit is not implemented,
not stubbed, and not designed here beyond the note below.

**Open question, deliberately left open.** Imperial Credits is a Star Wars
reference; Social Credit is a CCP one. Two jokes from two universes will sit
side by side once both exist. Raised with the user, who chose to proceed. It
should be settled deliberately when the Social Credit port is specified,
not discovered then.

## What the research established

Full briefing gathered 2026-09-12; the load-bearing findings, with sources.

**MEE6's mechanics are public and are the de facto standard.** 15-25 XP per
message, one message per **60-second** cooldown, and the cost of advancing
from level `n` to `n+1` is `5n² + 50n + 100`
([Mee6-documentation/docs/levels_xp.md](https://github.com/Mee6/Mee6-documentation/blob/master/docs/levels_xp.md)).
Arcane's "exponential" preset is `5×level² + level×50 + 75` — the same shape
with a different constant — and Lurkr ships a preset that reproduces MEE6's
curve exactly ([Arcane XP Options](https://docs.arcane.bot/plugins/leveling/setup/xp-options),
[Lurkr](https://lurkr.gg/docs/guides/customize-leveling-speed)). The shape is
quadratic: cheap and fast early, expensive at the top, which keeps the head of
the leaderboard scarce.

**Cooldown is the sanctioned anti-spam control.** Discord's own safety page on
XP systems does not prohibit gamification; it names the per-message cooldown
as the primary mitigation, and recommends no-XP channels and roles alongside
([Discord Safety: Using XP Systems](https://discord.com/safety/using-xp-systems)).

**Message Content is a privileged intent, and lu-bot already has it**
(`src/discord.js:143-147` requests `Guilds`, `GuildMessages`,
`MessageContent`). Without it `MESSAGE_CREATE` still fires but `content` comes
back empty, which would rule out any length or content rule. Not a constraint
here
([discord-api-docs #5412](https://github.com/discord/discord-api-docs/discussions/5412)).

**`GuildVoiceStates` is *not* privileged** — a toggle, no review — but it is
required to see who is in voice and whether they are muted
([discord-api-docs #1724](https://github.com/discord/discord-api-docs/issues/1724)).
lu-bot does not request it today and has no voice code at all.

**Scale is a non-problem.** One row per member; LU2's live score file holds
five users. Fifty members is roughly four kilobytes. Cooldown correctness and
curve tuning are the only hard parts.

**The "social credit" reskin is a well-worn genre**, not a novelty — several
such bots are listed openly on top.gg. No documented platform-enforcement
risk; only the ordinary question of how it lands with a given server's
members.

### Gaps in the research, recorded honestly

Polaris is discontinued and its live documentation is gone, so its numbers
could not be recovered — unrecovered, not confirmed absent. Tatsu does not
publish its cooldown value. No published minimum-message-length rule was found
for MEE6 or Amari; Arcane's "per word ≥3 characters" mode is the only sourced
minimum. Absence of a published floor is not evidence that none exists. The
3-character floor in this spec is therefore our own choice, not a copied one.

## The constraint that shapes this stage

Two, both inherited.

**Nothing in lu-bot currently survives a restart.** History
(`src/history.js:4`, whose own comment says "In memory; lost on restart"), the
decision log (`src/decisions.js:14`) and per-channel conversation state
(`src/conversation.js:48`) are all in-memory `Map`s. The only thing on disk is
the corpus, and it is written solely by the offline ingest script and read-only
at runtime. Imperial Credits is the **first durable runtime state Lu has ever
had**, and durability is the part of this work most likely to fail quietly.

**The host is fragile.** The mini has FileVault on (`DF3`), so a power cut
leaves it locked with no Ollama, no bot and no SSH until someone types the
password at the machine. Whatever crash-safety the store has will be exercised.

## Architecture

### Module layout

Five files under `src/credits/`, each with one job, following the codebase's
existing shape: pure functions over plain objects, with time and randomness
injected rather than reached for.

| Module | Responsibility | Depends on |
|---|---|---|
| `levels.js` | the curve, and nothing else | nothing |
| `store.js` | durable state on disk | `node:fs/promises`, injected `now` |
| `earn.js` | eligibility and amount for one message | `levels`, `store` |
| `commands.js` | anchored regexes and text formatters | `levels` |
| `voice.js` | phase 2; does not exist until then | `store` |

`levels.js` is pure arithmetic with no I/O, which makes the riskiest thing in
the feature — the curve — exhaustively testable in isolation.

### `levels.js`

```
costOfLevel(n)   -> 5n² + 50n + 100        credits to go from n to n+1
totalToReach(n)  -> Σ costOfLevel(k), k=0..n-1
levelFor(credits)-> highest n where totalToReach(n) <= credits
progress(credits)-> { level, into, needed }
```

Level is **derived, never stored**, so the curve can be retuned later without
a data migration.

### `store.js`

```
createCreditStore({ dir, now, flushMs }) -> {
  get(userId)                 -> { credits, name, lastAwardAt, messages, voiceSeconds }
  award(userId, { credits, name, at })  -> new total
  top(n)                      -> [{ userId, name, credits }]  descending
  all()                       -> every record
  flush()                     -> force a write now
  close()                     -> flush and stop the timer
}
```

The store knows nothing about cooldowns, eligibility or the curve. It is a
persistence layer with four verbs.

### On-disk shape — `data/credits.json`

```json
{
  "version": 1,
  "users": {
    "<userId>": {
      "credits": 0,
      "name": "",
      "lastAwardAt": 0,
      "messages": 0,
      "voiceSeconds": 0
    }
  }
}
```

Sits beside `data/corpus`, resolved from the module directory the way the
corpus path is (`src/index.js:32-34`).

**Keyed on user ID alone, with no guild dimension.** `DISCORD_GUILD_ID` is a
required env var (`src/config.js:3`) but is read nowhere in `src/`; the real
gate is the `allowedChannels` list in `shouldObserve` (`src/discord.js:7`).
History, decisions and conversation state are all keyed by channel ID alone.
Treating this as single-guild is consistent with the whole codebase, and adding
a guild dimension later is a `version: 2` migration.

**`name` is the display name observed at the moment credit was awarded**, kept
so the leaderboard can name people without a live member lookup. It is real
observed data and may be stale; it is never synthesised. A user with no
recorded name is shown by ID, not by a guess.

`voiceSeconds` is present in `version: 1` but stays at `0` until phase 2, so
voice does not force a schema change.

### Three departures from LU2's store

LU2's `SocialCreditStore` (`social_credit.py:52-84`) is the closest prior art
and the right general shape — a flat JSON file of user-to-score. Three of its
behaviours are defects and are fixed rather than ported.

1. **Atomic writes.** LU2 rewrote the live file in place on every scoring event
   (`_save`, line 70, called from `add_points`, line 80). A crash mid-write
   truncates the file. We write `credits.json.tmp` and `rename()` it, which is
   atomic on macOS: a reader sees either the whole old file or the whole new
   one.
2. **Debounced flush.** Dirty state is written after ~2s of quiet, and
   unconditionally on shutdown. Bounds loss from a power cut to a couple of
   seconds. LU2's synchronous write-per-event was not a durability measure —
   without the rename it was strictly worse than batching.
3. **A corrupt file is fatal, and says so.** LU2's loader has a bare
   `except Exception: return {}` (lines 66-67), so one corrupt byte silently
   zeroes every score and the bot carries on as if nothing happened. Ours
   refuses to start and names the unreadable file. **Losing everyone's scores
   must be a decision, not a side effect.**

A *missing* file is not corruption: first run starts empty and writes on the
first award. Write failures **after** startup are logged and retried on the
next flush; they never take the bot down. Reading is once, at startup; the
in-memory map is the working copy.

### Earning rules

Per eligible message: a uniformly random **15 to 25** credits, subject to a
**30-second per-user cooldown**.

Eligible means **all** of:

- not from a bot, Lu included — `shouldObserve` (`src/discord.js:5`) already
  distinguishes this and the `entry` carries `isBot`
- in a watched channel — again already gated by `shouldObserve`
- at least **3 characters** of message text

Commands need no eligibility rule of their own: `lu explain`, `lu credits` and
`lu leaderboard` all early-return **before** the awarding step, so asking for
your balance structurally cannot pay you. Every surveyed bot excludes its own
commands; here the ordering does it rather than a predicate. The test suite
asserts the behaviour regardless, so a future reordering cannot silently
reintroduce paid commands.

A message that fails eligibility does not touch the cooldown clock. Only a
message that actually pays sets `lastAwardAt`. (This is the Polaris bug found
in its changelog: a message that awarded nothing still consumed the cooldown
window.)

**Cooldown: 30 seconds, not MEE6's 60.** The curve is MEE6's, unchanged, so the
numbers mean what people expect them to mean from other servers. The cooldown
is halved because Cry's Cantina is small and conversation arrives in bursts;
at 60 seconds a flurry of six messages pays once. Halving it does not change
how many messages a level costs — only how much wall-clock time those messages
can be compressed into.

At ~20 credits per eligible message:

| Level | Cumulative credits | Eligible messages |
|---|---|---|
| 5 | 1,150 | ~58 |
| 10 | 4,675 | ~234 |
| 25 | 42,000 | ~2,100 |
| 50 | 268,375 | ~13,419 |

The level-5 figure is verified term by term against the formula
(100 + 155 + 220 + 295 + 380 = 1,150) rather than taken on trust from the
research summary.

### Where it hooks in

`conversation.handleMessage` (`src/conversation.js:301`) is already the
orchestrator and is where this belongs. `src/discord.js` is **untouched in
phase 1** — its single `MessageCreate` listener (`src/discord.js:159`) already
delivers everything needed.

Order inside `handleMessage`:

1. `lu explain` — existing, unchanged (`src/conversation.js:301-306`)
2. **credits commands** — new; early-return, same pattern
3. **award credits** — new; runs regardless of whether Lu decides to reply
4. history recording, attention, reply — existing, unchanged

Step 3 sitting **outside** the reply pipeline is the structural lesson from
LU2, which fired scoring as a detached task straight from `on_message`
(`bot.py:347-348`) precisely so it did not depend on the bot choosing to
speak. Credit accrues from taking part, not from getting Lu's attention.
Unlike LU2 it does not need to be detached: awarding is local, in-memory and
synchronous, and the disk write is already deferred by the debounce.

Commands early-return **before** history recording, matching how `lu explain`
behaves: a command is not conversation and should not enter the prompt.

### Commands and output

Whole-message anchored regexes in `commands.js`, exported as constants, matched
early in `handleMessage`. The anchoring is deliberate and mirrors `EXPLAIN_RE`
(`src/decisions.js:6`), which is written so that "lu explain why you hate cats"
stays conversation (`test/decisions.test.js:14-15`):

| Command | Shows |
|---|---|
| `lu credits` | your Imperial Credits, level, and progress to the next |
| `lu credits @someone` | the same for a mentioned member |
| `lu leaderboard` | the top 10, highest first |

Plain text via `channel.send`, no embeds — the same voice as every other thing
Lu says. Stage 1 deliberately moved him to plain messages rather than replies;
an embed would read as a different speaker.

A short in-character line on level-up, posted in the channel where it happened,
**one per crossing** — if more than one level is crossed at once, only the
highest is announced.

Message wording is drafted during implementation alongside `persona/lu-bot.md`,
not fixed here: it has to sound like Lu, and it is the wording that has to
carry the Imperial/Maoist register clash noted above.

**Empty and unknown states are stated, never invented.** An unknown user reads
as zero credits, level 0. An empty leaderboard says so — LU2's own empty state
is "No social credit scores recorded yet."

### Persona awareness

The speaker's credits and level are injected into the prompt as **read-only
context**, and the prompt states explicitly that Lu cannot change them and must
not announce changes. This is LU2's `SOCIAL_CREDIT_AWARENESS_TEMPLATE`
(`bot.py:182-192`, injected per-reply at `bot.py:265-272`), and it is what made
the original bit work: **scoring stays deterministic in code; only the
commentary is generative.** LU2's own prompt tells the model to reference it,
mock the user over it, or threaten it — "but don't force it into every single
reply".

Note the codebase already contains both patterns and LU2 chose this one on
purpose: nicknames let the model emit a `NICKNAME:` marker that code acts on,
whereas social credit forbids any marker. For a number, forbidding it is right
— a model that can emit a credit marker can fabricate a balance.

**This is the one part of the port that is not mechanical.** `respondWithReason`
takes a single `extraInstruction` string (`src/conversation.js:173`), currently
used only by the nickname feature. It needs to compose instructions from more
than one source. That is a small, contained refactor of an existing seam, and
the right kind of improvement to make while working in that code — as against
bolting a second parameter alongside the first and leaving the next feature to
add a third.

Cost is roughly 30 prompt tokens per reply. Recorded against `DF9`: Ollama's
context window on the mini is 4096 and stage 1 prompts run 600-1,300 tokens, so
there is room — but it is another draw on a budget that corpus chunks will
later strain.

### Configuration

A new `credits` section in `loadConfig`, following the four-edit pattern the
codebase already uses (section in `loadConfig`; commented lines in
`.env.example`; a banner-delimited block in `test/config.test.js` covering the
default, each override and each range throw; consumption via the injected
`config` object, never `process.env`).

| Variable | Default | Meaning |
|---|---|---|
| `CREDITS_ENABLED` | `true` | master switch |
| `CREDITS_MIN` | `15` | lowest award per message |
| `CREDITS_MAX` | `25` | highest award per message |
| `CREDITS_COOLDOWN_SECONDS` | `30` | per-user gap between paying messages |
| `CREDITS_MIN_CHARS` | `3` | shortest message that earns |
| `CREDITS_ANNOUNCE_LEVEL_UP` | `true` | post the level-up line |
| `CREDITS_FLUSH_MS` | `2000` | debounce before writing to disk |

Booleans use the codebase's default-on idiom — only the literal string
`'false'` turns one off (`src/config.js:100-105`). Range validation throws at
startup with the offending value, as the existing sections do
(`src/config.js:57-61`): `CREDITS_MIN` above `CREDITS_MAX` is a configuration
error, not a runtime surprise.

## Phase 2: voice credits

Sequenced **after** text credits ship and have been lived with. It is a second
subsystem, not a variation on the first:

- `GuildVoiceStates` added to the client's intents (`src/discord.js:143-147`)
- a `VoiceStateUpdate` listener — the **second** listener `src/discord.js` will
  ever have
- per-user session tracking: who joined which channel, when
- credit accrued per minute of connected time
- **muted or deafened members excluded**, so sitting in an AFK channel does not
  pay. This is Arcane's rule and it is the only published anti-farm measure for
  voice.
- a periodic tick, so a two-hour call credits as it goes rather than only on
  disconnect
- its own config block, and its own tests — which will be **time-driven rather
  than message-driven**, unlike anything currently in the suite

`voiceSeconds` already exists in the `version: 1` schema, so phase 2 needs no
migration.

## Testing

Test-first throughout: the failing test comes before the code, and per the
project's standing rule each new test is then broken on purpose and watched to
fail **for the right reason** before it is trusted — with the mutation
confirmed to have actually landed, since a no-op edit makes a test look sound
while proving nothing.

Conventions are `node:test` plus `node:assert/strict`, flat `test()` calls with
no `describe` nesting, run by `npm test`. discord.js objects are never faked;
each file defines a small local factory with an override spread
(`test/history.test.js:6-13`). Time and randomness are injected.

| Module | What the tests must establish |
|---|---|
| `levels.js` | table-driven against known values — level 5 costs exactly 1,150 cumulative; `levelFor` is correct either side of every boundary; level 0 and negative-input behaviour |
| `store.js` | round-trip; the temp-and-rename path; a **corrupt file throws** rather than resetting; a **missing file starts clean**; debounce writes once for a burst; `close()` flushes |
| `earn.js` | cooldown boundary from both sides; an ineligible message does **not** move the cooldown clock; below `CREDITS_MIN_CHARS` earns nothing; bot messages earn nothing; a level crossing is reported once |
| `commands.js` | anchoring rejects conversational near-misses ("lu credits are stupid"); mention parsing; zero-state and empty-leaderboard formatting |
| `config.js` | defaults; each override; `CREDITS_MIN > CREDITS_MAX` throws |
| `conversation.js` | an ordinary message earns; a command does not; a bot message does not; awarding happens whether or not Lu replies |

### Done-condition

1. The full suite green **on the mini** — currently 167 tests, so the new total
   must be stated and every test accounted for.
2. A live check in `#lu-bot-chat`: earn credits from real messages, read them
   back with `lu credits`, see another member's with `lu credits @them`, see
   `lu leaderboard` ordered correctly, watch a level-up fire, and confirm a
   `lu credits` command earns nothing.
3. **Restart the bot and confirm the balance survived.** This is the step that
   matters. Persistence is the only genuinely new capability here, and a
   passing unit test for the store is not evidence that the deployed bot
   reloads its file.

Nothing is reported as working that has not been run and observed.

## Risks

**Level-up announcements are the first time Lu speaks unprompted.** Every other
message he sends answers something aimed at him — stage 1 was explicitly built
around "is this for Lu?" judging, and proactive chiming is deferred as `DF4`
precisely because unprompted speech is a behavioural change. A level-up line is
a small one, but it is one. `CREDITS_ANNOUNCE_LEVEL_UP` exists from day one for
that reason.

**The register clash is unresolved**, as set out at the top. Decide it with the
Social Credit spec.

**This branches off `feat/mini-deployment`, which has open work of its own.**
That branch is 29 commits ahead of origin; Task 5's live check never passed,
and Tasks 6 and 7 are unstarted. Building on top of it is workable but stacks
unfinished work, and the live check above needs a bot that is actually running
on the mini.

**Prompt budget.** ~30 extra tokens per reply against a 4096-token window
(`DF9`).

**A quiet server can make the curve feel dead.** MEE6's curve assumes a busy
room. The 30-second cooldown compensates for burst conversation, but if the
ladder still feels static after real use, the honest fix is retuning the
constants — which the derived-level design makes a config change rather than a
migration.

## Explicitly not in this spec

- Social Credit — the LU2 sentiment engine. Separate spec.
- Role rewards at level thresholds. Decided out by the user: it needs Manage
  Roles, role-hierarchy handling and a stack-versus-replace policy, which is
  real complexity for a server this size. Straightforward to add later.
- Slash commands. lu-bot has no interaction handling at all and adding it for
  this would break the in-character feel.
- Rank-card images. An image library, font handling and render time on a 2018
  Intel mini that already takes 13-15 seconds per reply.
- Credits for reactions.
- No-XP channels or roles beyond the existing `allowedChannels` gate.
- Admin commands for granting or resetting credits.
- Multi-guild support.
