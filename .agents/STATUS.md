# Lu Bot — status

> **2026-09-13: mischief modes are built and tested on the MacBook only —
> not deployed, not started, not live-checked.**
>
> Branch `feat/mischief-modes`, off `main`. **Pushed and in sync with
> `origin/feat/mischief-modes` at `9f6f5b9`.** No pull request opened.
>
> Lu now picks one of four modes per reply — gossip, needler, narrator,
> windup — and commits to it. The fragments and the weighted picker live in
> `src/mood.js`; the chosen fragment joins the same `instructions[]` array in
> `src/conversation.js` as the nickname and credits fragments, and the choice
> is written to the decision log so `lu explain` says which Lu answered.
>
> **Why selection is in code, not in the prompt.** A prompt that describes
> four personalities produces the average of them, which is the flat register
> this work exists to fix. Picking one in code means the model never sees the
> other three and has nothing to hedge against. It also makes the weights
> tunable from `.env` without a deploy and keeps selection deterministic
> under test.
>
> Weights default to gossip 35, needler 30, narrator 20, windup 15
> (`MOOD_WEIGHT_*`, relative not percentages). Windup is deliberately the
> smallest share: it ages fastest and starts real arguments. `MOOD_ENABLED`
> is the master switch. All of it is `.env`, so re-tuning is a restart, not a
> deploy.
>
> `persona/lu-bot.md`'s head section is rewritten — the old text called Lu
> "mischievous and evil" and then spent the rest of its length forbidding him
> the room to be either. The length cap went from forty-to-sixty words to
> roughly seventy so a setup and a turn both fit. The corpus paragraph and
> the quoting rules are untouched; the quote verifier depends on them.
> `test/persona.test.js` pins the whole file exactly, so the rewrite is a
> visible, deliberate change there.
>
> **Suite: 477 tests, 477 pass, 0 fail** on the MacBook (451 before this
> work). Every new test was watched failing first, and four mutations of the
> production code confirmed the tests bite: stripping the shared rules from
> `moodInstruction` killed the shared-rules test with the right message,
> reversing `MODE_IDS` killed five order and band tests, forcing selection
> off killed the four wiring tests, and removing the decision-log line killed
> only the `lu explain` test. Each mutation's diff was printed before its run
> to prove the edit landed.
>
> **Nothing off-limits was configured** — the user was asked and said none
> for now. When one is wanted it is a sentence appended to
> `SHARED_MODE_RULES` in `src/mood.js`, which reaches all four modes at once;
> a test fails if any mode stops carrying that constant.
>
> **Not checked at all:** whether he is actually funnier. That is not
> unit-testable and needs him running in the real server. Also unchecked
> live: whether modes firing on random chime-ins read as funny or unhinged
> (gossip names people and drags others in, and a chime-in that stirs
> between two people who were not talking is the first thing to watch for —
> the 2% chime rate makes it rare, not impossible), whether windup at 15% is
> still too much, and whether ~70 words gives the narrator room to land.
>
> **Next action for the user:** deploy to the mini, watch an evening of real
> conversation, and re-tune `MOOD_WEIGHT_*` from what actually lands. Then
> decide whether this merges to `main`.

> **2026-09-13: Imperial Credits is built and reviewed on the MacBook only —
> not deployed, not started, not live-checked.**
>
> Branch `spec/imperial-credits`, off `feat/mini-deployment`. **Pushed and in
> sync with `origin/spec/imperial-credits` at `1dd7539`** (verified 2026-09-13;
> the tip was `8ad5a10` when this entry was written).
> Members now earn 15-25 Imperial Credits per eligible
> message (not a bot, in a watched channel, at least 3 characters) on a
> 30-second per-user cooldown. Level derives from credits by MEE6's
> `5n² + 50n + 100` and is never stored. Commands: `lu credits`, `lu credits
> @someone`, `lu leaderboard`, all plain text, none of them themselves earn
> credits. Balances persist in `data/credits.json` — the first durable
> runtime state Lu has ever had. Lu is told the speaker's own balance as
> read-only prompt context and is instructed not to change or announce it.
>
> Spec: `docs/superpowers/specs/2026-09-12-imperial-credits-design.md`. Plan:
> `docs/superpowers/plans/2026-09-13-imperial-credits.md` (10 tasks, all
> complete). Full section-by-section verification, including everything
> below, is `docs/superpowers/specs/2026-09-13-imperial-credits-verification.md`
> — read it before resuming.
>
> **Suite: 451 tests, 451 pass, 0 fail**, on both the MacBook and the mini.
> (438 at the point Imperial Credits merged; the server-allowlist work added 13.)
> Baseline before this
> work was 350 (the stale 167 figure quoted lower in this file predates the
> stage 1 merge and has now been corrected there too).
>
> **Deployed and live-checked, 2026-09-13.** Running on the mini at
> `spec/imperial-credits` merged into `main`, plus the server allowlist.
> Verified in the real server: credits earned from ordinary conversation
> (159 over 7 messages), the 30-second cooldown holding, level 1 crossed
> with the announcement firing in the channel, and the balance surviving a
> token rotation, seven crash-loop restarts, a clean restart, and a full
> physical power-down and move to another room. The restart-and-check test
> that this file previously listed as outstanding is done.
>
> **Still not checked live:** a message under the three-character minimum
> earning nothing, the leaderboard with more than one member in it, and the
> two fault-injection cases (corrupt the ledger file and confirm it refuses
> to start; move it away and confirm a clean start). Full detail, including
> what was and was not proven and how, is in the verification document.
>
> Two real defects were found only by reviewing the whole branch at once,
> after every individual task had already passed its own review — see the
> verification document's section on the history-ordering regression this
> caught. Three separate task reports also failed the evidence-integrity bar
> during this work (a duplicated test-output block presented as two runs, a
> prose sentence presented as terminal output, and a mutation check that
> killed no test); all three are described in the verification document with
> what each cost.
>
> **Next action for the user:** deploy to the mini, work through the
> live-check checklist at the end of the verification document — in order,
> the restart check is the one that must not be skipped — and decide whether
> this merges into `feat/mini-deployment`.

> **2026-09-12: stage 1 of the old-Lu port is built, reviewed and running on
> the mini.**
> **Reply length (2026-09-12, after the live check):** the user found replies
> too long. The persona now asks for two or three sentences (40-60 words) and
> `REPLY_MAX_TOKENS` (default 120) caps the generation; a reply cut at the cap
> is trimmed back to a sentence end, never mid-word and never inside a
> quotation (the trim balances every delimiter pair `src/quotes.js` knows).
> Live: replies dropped from 120-200 words to ~45, and well under 20s.
>
> Repo: `~/Claude/Lu/lu-bot`. The original Lu (Python, PC) is
> `JackCurphey/LU2`, checked out at `~/Claude/Lu/LU2` on branch
> `initial-import` — it is the feature reference for stages 2-4 (nicknames,
> memes, avatars, `!lu` help; long-term per-user memory and social credit;
> `!learn`/`!corpus_status`/file ingest).
>
> Stage 1 (persona, when he speaks, what he hears), the user-requested shorter
> replies, and self-renaming (Task 15/16) are **merged into
> `feat/mini-deployment`** at merge commit `f4f5686` (2026-09-12). The
> `feat/old-lu-stage1` branch was deleted after the merge (its tip was
> `df36838`). **Pushed** (2026-09-13): `feat/mini-deployment` is in sync with
> `origin/feat/mini-deployment` at `fe181ed`, 0 ahead and 0 behind.
>
> **Nicknames:** Lu renames himself when asked, but only for members with
> Discord's Manage Nicknames permission; a reset ("go back to your normal
> name") is handled without the model at all. Resetting clears the server
> nickname, which reveals his account name `Lü Xiaojun` — `LUPHER` was itself
> a nickname. He is currently `COMRADE STONE` at the user's request.
>
> Previously said, still true: It is deployed and
> running on the mini (one instance, deployed via rsync + `npm ci` +
> `launchctl kickstart`). The live check in `#lu-bot-chat` (Cry's Cantina)
> passed every item on the done-condition checklist, tested from the user's
> own Discord account. Full walk against the spec, section by section:
> `docs/superpowers/specs/2026-09-11-old-lu-stage1-verification.md`.
>
> **What stage 1 added:**
> - Old Lu's persona, word for word, plus the current corpus/quoting rules.
> - Lu now hears every message in an allowed channel (`src/history.js`) and
>   follows a conversation, not just direct mentions (`src/attention.js`,
>   `src/pause.js`, `src/addressee.js` — a lean "is this for Lu?" judge).
> - `lu explain` — a per-channel decision log (`src/decisions.js`).
> - Plain messages (`channel.send`, not replies); the bare-`@Lu` bug fixed;
>   a headache signal (`uh oh... i have a headache`) on a failed reply to
>   something aimed at him.
>
> **Open items for the user** (full detail in the verification doc above):
> 1. The judge's false-YES rate (6/20 on non-Lu examples) has no cooldown —
>    every reply refreshes the 5-minute attention window, so Lu can hold the
>    floor in a busy channel. Deliberately left as-is (spec's approved
>    design); a tuning question, not a defect.
> 2. With no corpus loaded, Lu invents quotations attributed to Mao in most
>    live replies — spec-sanctioned (the fabrication check is skipped with no
>    passages to match against), not a stage-1 regression.
> 3. "Minimal punctuation" vs the quoting rules: watched, not fixed, per the
>    spec. Live check showed no dropped quotes (he used `「」`).
> 4. Ollama's context window on the mini is 4096 tokens. Stage 1 fits
>    (~600-1300 tokens); future corpus chunks may not.
>
> **Stages 2-4** (not started): nicknames/memes/avatars/`!lu` help;
> opt-in per-user memory and social credit; `!learn`/`!corpus_status`/file
> save-getfile and PDF/Word ingest. Each gets its own spec and plan, mining
> `~/Claude/Lu/LU2` for the reference behaviour.
>
> **Parked (2026-09-12): web search for Lu.** Brainstormed to "approaches
> agreed, provider undecided", then parked at the user's request. No code.
> Write-up: `docs/superpowers/specs/2026-09-12-web-search-exploration.md`.
> It holds the hardware finding that shapes the whole idea — the mini prefills
> at 45.8 tok/s, so ~22s per 1,000 prompt tokens, which means Lu cannot read
> and summarise web pages himself and compression must happen off-box — plus
> the decisions taken and verified provider research with its unverified gaps
> marked. It also records that the 4096-token context window is an Ollama
> default rather than a hardware ceiling, which bears on open item 4 above and
> on `DF9` in `.agents/deferrals.md`.
>
> The mini-deployment status below is unchanged except where corrected inline.

**Last session:** 2026-09-10 → 2026-09-11. Branch `feat/mini-deployment` —
**stage 1 is now merged into it** (`f4f5686`, 2026-09-12) and it is pushed and
in sync with origin at `fe181ed`. **Private GitHub repo
https://github.com/JackCurphey/lu-bot**; default branch `feat/mini-deployment`.
Six branches now exist on origin (verified 2026-09-13): `feat/foundation`,
`feat/mini-deployment`, `spec/imperial-credits`, `spec/initial-design`,
`spec/mini-deployment`, `spec/web-search-exploration`.

## Where it stands

Lu is being moved from the MacBook (LM Studio + MLX) to a 2018 **Intel Mac mini**
(Macmini8,1, i3-8100B, 16GB, macOS 15.7.9) so he stays online permanently.
Intel rules out LM Studio and MLX entirely, so the stack is now **Ollama** with
**`qwen3:4b-instruct`** as both chat and judge model, and `nomic-embed-text` for
embeddings. Benchmarked on the mini: ~13-15s per reply.

- Spec: `docs/superpowers/specs/2026-09-10-mini-deployment-design.md`
- Plan: `docs/superpowers/plans/2026-09-10-mini-deployment.md` (7 tasks)
- Execution ledger, with every ruling: `.superpowers/sdd/2026-09-10-mini-deployment/progress.md` (gitignored)

| Task | State |
|---|---|
| 1. Ollama contract tests, provider-neutral error | complete, reviewed clean (`b525a37`) |
| 2. Typing indicator | complete, reviewed clean (`e39ec85`) |
| 3. Node v26.8.1 + Ollama launchd service on mini | complete, reviewed clean |
| 4. Scrub `.env.example`, deploy to mini by rsync | complete, reviewed (`d8ec09d`); **167/167 tests pass on the mini at that commit — stale as a current figure; the suite has since grown to 438 on the MacBook (2026-09-13), not yet re-run on the mini** |
| 5. Lu as launchd service | steps 1-3 done (service was `running`); **live check FAILED — no reply** |
| 6. Fault injection | not started |
| 7. Host config + handover | FileVault checked (**On**); rest not started |

**Note (2026-09-12):** the bot running on the mini is no longer at this
branch's commit. Stage 1 (`feat/old-lu-stage1`) was deployed on top of it for
its live check, and the mini currently runs stage 1's `0b2adb1`, not
`feat/mini-deployment`'s `d8ec09d`. Task 5's remaining steps, and Tasks 6-7,
still apply to the deployment mechanics but should be resumed against
whichever commit is live on the mini at the time.

## Why the live check failed — hypothesis, not proven

The mini had `sleep 1` (sleeps after one idle minute) and `autorestart 0`. The
fix needs the user's password so was never applied. Lu likely went down when the
mini slept after the last SSH session ended.

**Unconfirmed.** It could not be checked: the MacBook moved to a different
network (`<other-subnet>`; the mini and PC are on `<lan-subnet>`), so neither was
reachable. A failed ping from the wrong network is NOT evidence of sleep. Prove
it on return with `pmset -g log | grep -E "Sleep|Wake"`.

## Next actions, in order

1. ~~**At the mini:** apply the pmset settings.~~ **DONE** — verified
   2026-09-13: `sleep 0`, `disksleep 0`, `autorestart 1`, `womp 1` are all in
   effect. This entry was stale.
2. **Tailscale** — user is creating an account. Once the MacBook and mini share a
   network, install it on the mini (and the PC) so `ssh mini` works from anywhere.
3. Confirm the sleep cause from `pmset -g log`, check `~/Library/Logs/lu-bot/bot.log`.
4. Resume Task 5 step 4: user mentions Lu **with text** (not a bare `@Lu`).
5. Tasks 6 and 7.

## Decisions waiting on the user

- **FileVault is On.** Every power cut leaves the mini locked with no Ollama, no
  bot and no SSH until someone types the password at the machine. Turn it off, or
  accept manual unlock. Task 6's reboot test will fail until this is decided.

## Resolved: the bot token exposure

**Closed 2026-09-13.** The real Discord bot token was committed to
`.env.example` between `568d300` and `d8ec09d` and was pushed to GitHub. It has
now been **rotated** in the Discord developer portal, which is what actually
made every copy of the old value worthless — rewriting history alone would not
have. Git history was then rewritten to purge the dead string, and the GitHub
repository was deleted and recreated so no pre-rewrite object remains reachable
by SHA. Home-network addresses, the SSH key filename and the real server and
channel IDs were replaced with placeholders in the same pass, before the
repository was made public.

The lesson worth keeping: a credential that has left the machine is
compromised, and scrubbing it from history is tidying, not remediation.
Rotation is the remediation.

## Environment notes

- Mini: `ssh mini` → `<user>@<mini-ip>`, key `~/.ssh/<key>`. **LAN only.**
- Mini has **no working git** (Apple stub, no Xcode CLT). Deploy is rsync from the
  MacBook, excluding `.git`, `node_modules`, `.env`, `.superpowers`; then `npm ci`
  on the mini. The running commit is in `~/lu-bot/DEPLOYED_COMMIT` there.
- Node on the mini is `~/node/bin/node`, **not on the non-interactive SSH PATH**.
  Prefix `PATH=/Users/jackcurphey/node/bin:$PATH` for any `npm` over SSH.
- Services: `com.curphey.ollama`, `com.curphey.lu-bot` (user launchd agents).
  Restart: `launchctl kickstart -k gui/$(id -u)/com.curphey.lu-bot`.
  Logs: `~/Library/Logs/lu-bot/`.
- Ollama binds `127.0.0.1` only (verified unreachable from the LAN) with
  `OLLAMA_KEEP_ALIVE=-1`, so the model never unloads.
- The MacBook's old LM Studio setup (hand-edited Jinja template etc.) is no longer
  the live path.

## Fixed since this section was written

- **Bare `@mention` fails.** Was: `src/discord.js` stripped the mention tag,
  producing an empty string that the model server rejected with HTTP 400.
  Fixed in stage 1 (`feat/old-lu-stage1`, commit `1530b05`): the mention tag
  is rendered as `@displayname`/`@Lu` instead of deleted, so a bare mention
  never reaches the model as empty text. Live-checked on the mini:
  "PASS bare @mention → reply (old bug fixed, no empty-content 400)".
- **A model-side failure was silent in-channel.** Was: model error,
  unverifiable quotation and over-length reply all looked identical from
  Discord. Addressed in stage 1 by the headache signal (`uh oh... i have a
  headache`, posted only for a failed reply to something aimed at Lu) plus
  `lu explain`, which shows the real cause ("model server error: fetch
  failed", "reply dropped: quote not found in passages", etc.) per channel.
  Still open: unverifiable-quotation and over-length-reply failures are not
  yet distinguished from each other in the headache signal itself — only in
  the `lu explain` record.

## Also open

- **Before ingesting real texts:** ingest hardcodes author to `unknown` and
  chapter to `null` (`scripts/ingest.js`); the chunker has no sentence fallback.
- **Proactive chiming** is not built. The mini can afford it (embeddings are 25ms);
  it is blocked on a corpus existing. See the spec's chiming section.

## New scope raised (not yet designed)

- **Lu changing his own username**, matching an earlier version of Lu that ran on
  the user's PC. Discord offers an account username change (heavily rate-limited)
  or a per-server nickname change; the old code decides which.
- **The PC codebase as the persona reference.** The user liked how Lu behaved
  there. The PC is probably SSH host `mrpc` (`<pc-ip>`) — unconfirmed, and it
  was unreachable this session (wrong network). It ran on a graphics card, so
  replies were faster than the mini's CPU will manage.
