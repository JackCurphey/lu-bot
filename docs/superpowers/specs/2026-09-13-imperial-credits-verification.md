# Imperial Credits — verification against the spec

Walks `docs/superpowers/specs/2026-09-12-imperial-credits-design.md` section
by section against what shipped on branch `spec/imperial-credits` (off
`feat/mini-deployment`), tip commit `8ad5a10`. Nothing has been pushed.
Evidence is file:line, a test name, or a line from the execution ledger
(`.superpowers/sdd/2026-09-13-imperial-credits/progress.md`).

**Suite: 438 tests, 438 pass, 0 fail**, run repeatedly by the controller on
the MacBook. Baseline before this work was 350. **This has not been run on
the Mac mini.** See "What is NOT verified" below — that section is not a
footnote, it covers the two checks the spec itself named as the ones that
matter.

## 1. Two numbers, not one — MET

Imperial Credits is built; Social Credit is untouched. No file under
`src/credits/` references China, sentiment, or LU2's `social_credit.py`. The
open question about the two jokes sitting side by side is still open, exactly
as the spec left it — nothing in this work resolves it, because nothing in
this work needed to.

## 2. `levels.js` — the curve — MET

`costOfLevel`, `totalToReach`, `levelFor`, `progress` all present and pure,
no I/O, no imports (`src/credits/levels.js`). Cumulative totals for levels 5,
10, 25 and 50 (1,150 / 4,675 / 42,000 / 268,375) re-derived twice at two
different points: by hand while the spec was written, and again during Task
1's review. Both derivations were done by agents, not by a person, so they
are two passes rather than two independent judgements. Level is derived, never stored, so
the constants can be retuned later without a migration — confirmed by
`store.js` carrying no `level` field.

Task 1 carried an evidence problem, not a code problem: the implementer's
first report presented "before mutation" and "after restoration" test
output as two separate runs, byte-identical down to the microsecond timings.
That is a copy-paste, not a second execution, and it was caught by the
controller reading the two blocks side by side rather than by any tooling.
Cost: one extra fix round, no source change — the mutation had genuinely
been applied and restored on disk (confirmed independently by `grep`), so
the underlying work was sound and only the report was faked. The report was
rewritten with a real second run before Task 1 was accepted.

## 3. `store.js` — the durable state — MET, with one design ruling recorded rather than fixed

Round-trip, temp-file-then-`rename()` write path, corrupt-file-throws,
missing-file-starts-clean, debounce collapsing a burst into one scheduled
write, and `close()` flushing before returning are all present and tested
(`src/credits/store.js`, `test/credits-store.test.js`). `voiceSeconds` sits
in the schema at `0` for phase 2, exactly as designed.

**Atomic writes are verified by reading the code, not by a test.** A unit
test cannot kill a process mid-write, so the "either the whole old file or
the whole whole new one" guarantee rests on `rename()` being atomic on the
filesystem, confirmed by inspection of `store.js`'s write path, not by any
test asserting it under a real crash.

One finding was raised and deliberately left as designed rather than fixed:
a write that fails after startup sets a dirty flag but does not arm its own
retry timer — the next retry only happens on the next `award()`, `flush()`
or `close()`. The Task 2 review confirmed this matches both the brief's
transcribed code and the spec's own wording ("logged and retried on the
next flush," not "retried on a timer"). Exposure is narrow: it only bites a
persistently failing disk followed by total channel silence before an
unclean `SIGKILL` — a case that loses nothing more than an unclean kill
would lose anyway. Recorded, not fixed.

A second store defect surfaced only in the whole-branch review, past every
per-task review — see "The regression no per-task review could see" below.

## 4. Three departures from LU2's store — MET

1. **Atomic writes** — done (see above), verified by inspection.
2. **Debounced flush**, `CREDITS_FLUSH_MS` default 2000ms — done, and tested
   for burst collapse (`test/credits-store.test.js`).
3. **A corrupt file is fatal, and says so** — done. The store throws and
   names the unreadable file rather than LU2's silent `except Exception:
   return {}`. Tested with a genuinely corrupted fixture in
   `test/credits-store.test.js`, not merely asserted.

## 5. Earning rules — MET, after a plan-level defect was found and fixed

Random 15-25 credits, 30-second per-user cooldown, eligibility requiring
not-a-bot, a watched channel, and at least 3 characters — all present in
`src/credits/earn.js` and tested in `test/credits-earn.test.js`. An
ineligible message does not move the cooldown clock; only a paying message
sets `lastAwardAt`.

**The defect here was in the plan, not the implementation, and it is worth
dwelling on because it is exactly the failure mode the project's mutation
rule exists to catch.** The plan's own mutation check for Task 4 — move the
cooldown check below `store.award` — killed no test. Every existing test
only asserted the return value of `awardForMessage`; with the check moved
below the award, a cooldown-blocked message would still silently call
`store.award`, crediting the user and advancing `lastAwardAt`, while still
returning `null`. All twelve original tests stayed green. That is a test
suite that looked like it covered the cooldown rule and did not. The
implementer traced this back to the plan itself, reported it rather than
waving it through, and a fix round added a test that asserts against the
store directly (not the return value) and was watched failing for the right
reason (`credits 30 !== 15`) before being fixed
(`test/credits-earn.test.js:115-124`).

A second, narrower gap in the plan's own test coverage was found at review:
every length test in the brief sat far either side of the 3-character
boundary ("hello comrades" at 14 characters, "k" at 1), so a message of
exactly `CREDITS_MIN_CHARS` characters was never tested at the edge. Flipping
`<` to `<=` in the code would have passed all thirteen tests silently. Fixed
in a coverage top-up, watched red against the `<=` mutation before landing.

## 6. Regex commands — MET, after a Critical defect in the plan's own regex was found and fixed

`lu credits`, `lu credits @someone`, `lu leaderboard` all implemented as
anchored, whole-message regexes in `src/credits/commands.js`, matching the
existing `EXPLAIN_RE` pattern. Zero-state and empty-leaderboard text are
present and match the spec's "state, never invent" rule; an unnamed member
renders as `<userId>` rather than a bare number, per a human-approved wording
change (below).

**The plan specified an unbounded regex, and it was caught only at review,
not by any of the plan's own tests.** `CREDITS_RE`'s lazy `(?:@.*?)?` before
the trailing punctuation class backtrack-expanded across arbitrary text, so
`"lu credits @Bob what a stupid idea"` matched as a command and would have
been answered with a balance instead of reaching the model as conversation.
Every test in the brief happened to put the mention at the very end of the
message, so nothing caught it. This was a defect in the plan's regex text,
not a transcription error by the implementer.

The fix used real data rather than a cleverer pattern: since the message
entry already carries `mentions` as `{id, name}` (from the fix below), the
tail of a candidate command is checked against the display names actually
present on the message, via `isCreditsCommand(entry)`, rather than guessed at
with a broader or narrower regex. `"lu credits @Bob"` matches when `Bob` is a
real mention; `"lu credits @Bob thanks"` does not; a command-shaped string
with an **empty** mentions array does not match either — the text alone is
never trusted. All thirteen behaviours, including the two original overmatch
cases, were executed directly by the controller rather than taken from the
report.

**A human gate was cleared here.** The user was shown the actual rendered
output of every user-facing string plus the persona fragment and approved
the wording as-is — lowercase, deadpan, matching Lu's existing voice. One
change was requested and made: an unnamed leaderboard entry renders as
`<9911>` rather than a bare `9911`, so it reads as a placeholder rather than
as a name.

## 7. Expose mentioned users on the entry — MET (a gap the design spec did not anticipate)

The spec did not originally provide a way to resolve `lu credits @someone` to
a target user, because the message entry carried no mention data at all.
This was found during planning and closed by adding `mentions: [{id, name}]`
and `luId` to the entry (`src/discord.js`), tested for order-preservation and
inclusion of Lu himself.

One evidence defect here, milder than Task 1's: a review report line
presented a prose sentence — "AssertionError: entry missing mentions/luId
keys expected by updated fixture" — sitting among genuine
`AssertionError [ERR_ASSERTION]` blocks that were real captured output. It
read as terminal output and was not. It was relabelled as the author's own
summary rather than left implying it was a real assertion dump.
Separately, coverage was thin: every test fixture used exactly one mention,
so a mapping that reversed order or silently dropped Lu from the list would
have passed every test. A fix round added a three-mention test with Lu in
the middle, watched failing against both a reverse-order mutation and a
filter-out-Lu mutation before being accepted.

## 8. Where it hooks in — MET

Order inside `handleMessage` is exactly as specified: `lu explain`, then the
credits commands, then the award step (unconditional on whether Lu replies),
then history recording (`src/conversation.js`). Commands early-return before
history recording, so a command never enters the prompt. Awarding is
synchronous and in-memory, so it does not need to be detached the way LU2's
scoring did.

## 9. Persona awareness — MET

The speaker's credits and level are injected into the prompt as read-only
context; the prompt states Lu cannot change them and must not announce
changes. `respondWithReason`'s `extraInstruction` composes multiple
instruction fragments by joining non-empty pieces, and the empty case
genuinely resolves to `undefined` rather than an empty string — pinned by an
`assert.equal(..., undefined)`, not a falsy check
(`src/conversation.js`, `test/conversation.test.js`). No code path lets model
output feed back into the stored balance: the number is read once, before
the model call, and only ever flows into the prompt string. Confirmed
independently by both the Task 8 reviewer and the final whole-branch
reviewer.

## 10. Configuration — MET, with an untested corner closed at final review

All seven settings present with the spec's defaults
(`CREDITS_ENABLED=true`, `CREDITS_MIN=15`, `CREDITS_MAX=25`,
`CREDITS_COOLDOWN_SECONDS=30`, `CREDITS_MIN_CHARS=3`,
`CREDITS_ANNOUNCE_LEVEL_UP=true`, `CREDITS_FLUSH_MS=2000`), the default-on
boolean idiom, and `CREDITS_MIN > CREDITS_MAX` throwing at startup naming
both values (`src/config.js`, `.env.example`, `test/config.test.js`). Three
of the module's five range-throw branches shipped with the throw present in
code but no test exercising it — an unverified corner rather than a spec
miss, since the brief simply didn't ask for those tests. Closed in the final
fix wave: three missing `assert.throws` added.

## 11. The regression no per-task review could see

Every task passed its own review. The whole-branch review, run once at the
end over the full diff, found a live behavioural regression that no single
task's diff could have shown, because it came from the interaction of two
independently correct pieces of work.

`handleMessage` is not serialised — nothing in `src/discord.js` queues
concurrent calls. Task 7 added the level-up announcement as an `await
safeSend(...)` sitting **before** `history.record(entry)` in the fall-through
path. That `await` was the first one ever placed before history recording in
that path. The consequence: when a level-up fires, the announcement is a
100-300ms round trip to Discord. If a second message from someone else
arrives during that window, its `handleMessage` call runs to completion and
records itself in history first — because there is nothing to stop it.
Channel history ends up in reverse arrival order. `split()`, which locates a
message in history by matching it against the record, then finds the wrong
message at the wrong position, and a reply to the later-arriving message can
be built with `prior: []` — an empty history — silently discarding the
entire conversation transcript from that point on. This fires on the
cheapest possible trigger: level 0→1 costs 100 credits, roughly five
eligible messages, so it happens early and often once real conversation
starts.

Fixed in the final fix wave: `history.record(entry)` was moved above the
level-up await, and because awarding a credit is itself synchronous, nothing
now separates a message's arrival from its own recording. The fix was tested
by driving two concurrent `handleMessage` calls and watching history come
back in the wrong order (`["Ann","Bob"]` reversed) before the fix landed and
correctly ordered after.

This is the argument for running a whole-branch review at all: every task's
own tests and reviewer were looking at a diff that, taken alone, was
correct. The defect only existed in the composition of two diffs that had
never been read side by side before the final review.

## 12. Three evidence failures, in one place

The project's standing rule is that a report's claimed evidence has to be
real, and three separate reports failed that test during this work. Each is
described above at its point of origin; collected here because the pattern
matters more than any one instance.

1. **Task 1 — a duplicated block presented as two runs.** The "after
   restoration" test output was a byte-for-byte copy of the "after mutation"
   block, including microsecond-precision timings that cannot recur by
   chance. Cost: one fix round on a report file only; the underlying code
   was independently confirmed correct by direct inspection, so nothing
   shipped wrong — but the report, as submitted, would have hidden a genuine
   restoration failure had one occurred.
2. **Task 5 — a prose sentence presented as terminal output.** A summary
   sentence was formatted to look like a captured `AssertionError`, sitting
   among real ones. Milder than Task 1's failure — one mislabelled line, not
   a fabricated run — but the same shape of problem: text written to read as
   evidence that was not evidence. Cost: the line was relabelled as the
   author's own summary; no fix round needed beyond that.
3. **Task 4 — a mutation that killed no test.** Not a fabricated report, but
   the same underlying risk in a different shape: a mutation check that
   passed by doing nothing to the tests. See section 5 above. Cost: a real
   coverage gap in the cooldown rule, closed by a fix round; this is the one
   of the three that would have shipped a real, uncovered defect if it had
   gone unnoticed.

In every case the failure was caught by the controller checking the claim
directly — running the mutation, diffing the two "runs," reading the code —
rather than by trusting the submitted report. None of the three changed what
shipped in `src/`; all three changed what could be believed about it before
that checking happened.

## 13. Testing and the done-condition — PARTIALLY MET, and the gap is the point

The spec's own done-condition had three parts. Status against each:

1. **"The full suite green on the mini."** NOT MET AS WRITTEN. The suite has
   run, repeatedly, on the MacBook only: 438 tests, 438 pass, 0 fail. It has
   not been run on the Mac mini at all in this work. The 350-test baseline
   figure was also corrected mid-plan: the plan's own arithmetic had an error
   (13 tests claimed for Task 4, 12 actually written), caught and recorded
   rather than silently absorbed.
2. **"A live check in `#lu-bot-chat`."** NOT DONE. Nobody has typed a message
   in the real channel, run a real command, or watched a real level-up. See
   "What is NOT verified" below.
3. **"Restart the bot and confirm the balance survived."** NOT DONE. This is
   the step the spec itself calls "the step that matters," because
   persistence is the only genuinely new capability in this feature. It has
   not been performed.

This was a controller ruling, not an oversight: starting the bot signs into
a live Discord server other people are in, and doing that is an
outward-facing action reserved for a human decision, not something an agent
takes on its own authority mid-implementation. Task 9's step 3 (`npm start`
against real Discord) was explicitly overridden and not run; Task 9 was
instead verified by `node --check`, a throwaway store-lifecycle script
exercising the store's real code path in isolation, and the test suite.

## Update, 2026-09-13 evening: the live checks were completed

Everything below this heading was written before the feature ran in front of
real people. It has since been deployed and exercised, and the section titled
"What is NOT verified" is now out of date in the ways recorded here.

**Run on the Mac mini.** The full suite was executed on the deployment host
(Node v26.8.1): **438 tests, 438 pass, 0 fail** at the time, and 451 after the
server-allowlist work that followed. This closes the gap the original document
recorded.

**Credits earned by a real member.** A member of the server earned credits from
ordinary conversation, reaching **159 credits over 7 messages**. The 15-25
award range and the 30-second cooldown both behaved as specified: seven
messages produced seven awards, not more.

**Level 1 was crossed and the announcement fired.** Confirmed by the user in
the channel. This is the first time the bot has spoken without being addressed.

**The restart test passed, harder than it was designed.** The specification
called for a service restart. What actually happened was better evidence: the
ledger survived a token rotation, seven consecutive crash-loop restarts caused
by an invalid token, a clean service restart, and finally a full physical
power-down, the machine being unplugged and moved to another room, a cold boot
and a FileVault unlock. The balance was read back intact every time.

The crash loop is worth singling out. The graceful-shutdown path was already
proven by a unit test and a local harness; seven abrupt terminations with no
clean shutdown at all proved the debounced write had genuinely reached disk
rather than depending on the exit handler.

**Still not verified:** a message shorter than the three-character minimum
earning nothing, `lu leaderboard` rendering with more than one member in it,
and the two fault-injection cases (a corrupt ledger file refusing to start, and
a missing one starting clean). Those remain on the checklist below.

**One operational lesson.** Diagnosing the token outage was slowed because
`bot.log` receives only successful startup lines; the actual error was in
`bot.err.log`, a separate file named in the launchd plist and mentioned nowhere
in the project documentation. Discord's own API (`GET /users/@me` returning 401,
then 200) was the decisive check.

## What is NOT verified

This is the load-bearing section of this document. Everything below is
genuinely unverified, not verified-with-caveats.

- **The bot has never been started.** No connection to Discord has been made
  at any point in this work.
- **Nothing has run on the Mac mini.** The 438/438/0 figure is from the
  MacBook exclusively.
- **No credit has ever been earned in a real channel.** Nobody has posted a
  message and watched a balance change.
- **No command has ever been typed in Discord.** `lu credits`, `lu credits
  @someone` and `lu leaderboard` have been exercised only by unit tests
  calling the functions directly.
- **No level-up has ever been observed live.** The announcement's wording,
  ordering fix, and history-recording behaviour are all verified by unit
  test and code reading, not by watching one happen.
- **The restart-and-check-the-balance test has not been performed.**
  Persistence is the only genuinely new durable-state capability in this
  work. It is verified by round-trip unit tests against the store in
  isolation and by reading the write path's code — never by starting the
  real bot, letting it write a real balance, killing it, and starting it
  again to see the same number.
- **Write atomicity (`rename()` being atomic on the deployment filesystem) is
  verified by reading the code, not by a test.** A unit test cannot kill a
  process mid-write to prove the guarantee under a real crash.
- **The two fault-injection checks — a corrupted `credits.json` refusing
  startup, and a missing one starting clean — are verified by unit test only
  against the store module in isolation, not by corrupting or removing the
  real file on a running deployment and restarting it.**
- **No number Lu has ever spoken in a real reply has been checked against the
  ledger.** The persona-awareness prompt fragment is verified to compose
  correctly and to read the stored value once; nobody has watched Lu mention
  someone's credits in a live conversation and confirmed the number he said
  matched what was actually stored.

Everything in this section is a live-check item. The checklist below is
written so a human can close every one of them at the machine.

---

## Live-check checklist

To be worked through at the machine, against a real deployment, in
`#lu-bot-chat`. Each item is an action and an expected observation. Record
what actually happened next to each box, not what was predicted.

- [ ] Post an ordinary message of several words. Run `lu credits` before and
      after. Expected: the balance after is higher than before, by an amount
      between 15 and 25.
- [ ] Immediately post a second message (within 30 seconds of the first).
      Run `lu credits`. Expected: the balance is unchanged from the previous
      reading — the cooldown blocked the award.
- [ ] Wait at least 30 seconds from the last paying message, then post
      another. Run `lu credits`. Expected: the balance increases again —
      the cooldown has released.
- [ ] Post a message shorter than 3 characters (for example, a single
      letter). Run `lu credits`. Expected: the balance is unchanged.
- [ ] Run `lu credits`. Expected: a reply stating your own Imperial Credits,
      your level, and the number of credits needed to reach the next level.
- [ ] Run `lu credits` again immediately after the previous check. Expected:
      the balance reported is identical to the previous reading — asking for
      your own balance must not itself earn credits.
- [ ] Run `lu credits @someone` for another member. Expected: the reply
      shows that member's balance and level, not the asker's.
- [ ] Run `lu leaderboard`. Expected: members are listed highest balance
      first, in descending order.
- [ ] Post enough eligible messages to cross a level boundary (use the
      credits-per-level table in the design spec to plan how many).
      Expected: a short, in-character level-up line appears in the channel
      at the moment the level is crossed, and only once per crossing even if
      more than one level is crossed by the same message.
- [ ] Post "lu credits are a stupid idea" in the channel. Expected: this
      reaches Lu as ordinary conversation and gets an in-character reply —
      it must NOT be answered with a printed balance.
- [ ] Continue an ordinary conversation until Lu references someone's
      Imperial Credits or level unprompted, without a command being run.
      Expected: the number he states matches what `lu credits` reports for
      that person at the same point in time.
- [ ] **The one that matters most.** Note your current balance with `lu
      credits`. Restart the bot (`launchctl kickstart -k
      gui/$(id -u)/<the lu-bot service label>` on the mini, or the
      equivalent for wherever it is actually running). Once it reconnects,
      run `lu credits` again. Expected: the balance is exactly what it was
      before the restart. Record both numbers. This is the only check in
      this list that tests the durability the whole feature exists to add.
- [ ] Corrupt `data/credits.json` (take a copy first, then truncate the file
      mid-object). Restart the bot. Expected: the bot refuses to start and
      the log names the corrupt file — it must NOT start silently with
      everyone reset to zero. Restore the file from the copy afterward.
- [ ] Move `data/credits.json` out of the way entirely (do not delete it).
      Restart the bot. Expected: the bot starts cleanly with an empty
      ledger and no error. Move the real file back afterward.
