# Lu Bot — status

> **2026-09-11, new work: porting the original Lu's features into this bot.**
> The repo now lives at `~/Claude/Lu/lu-bot` (moved from `~/Documents/lu-bot`).
> The original Lu (Python, PC) is `JackCurphey/LU2`, checked out at
> `~/Claude/Lu/LU2` on branch `initial-import`. Four stages; stage 1 spec:
> `docs/superpowers/specs/2026-09-11-old-lu-stage1-design.md`, branch
> `feat/old-lu-stage1`. Spec awaiting user review; no plan or code yet.
> The mini-deployment status below is unchanged and still open.

**Last session:** 2026-09-10 → 2026-09-11. Branch `feat/mini-deployment`, not
merged. **Pushed to private GitHub repo https://github.com/JackCurphey/lu-bot**
(all four branches; default branch `feat/mini-deployment`).

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
| 4. Scrub `.env.example`, deploy to mini by rsync | complete, reviewed (`d8ec09d`); **167/167 tests pass on the mini** |
| 5. Lu as launchd service | steps 1-3 done (service was `running`); **live check FAILED — no reply** |
| 6. Fault injection | not started |
| 7. Host config + handover | FileVault checked (**On**); rest not started |

## Why the live check failed — hypothesis, not proven

The mini had `sleep 1` (sleeps after one idle minute) and `autorestart 0`. The
fix needs the user's password so was never applied. Lu likely went down when the
mini slept after the last SSH session ended.

**Unconfirmed.** It could not be checked: the MacBook moved to a different
network (`<other-subnet>`; the mini and PC are on `<lan-subnet>`), so neither was
reachable. A failed ping from the wrong network is NOT evidence of sleep. Prove
it on return with `pmset -g log | grep -E "Sleep|Wake"`.

## Next actions, in order

1. **At the mini:** wake it, then run
   `sudo pmset -a sleep 0 disksleep 0 displaysleep 10 womp 1 autorestart 1 powernap 0`
2. **Tailscale** — user is creating an account. Once the MacBook and mini share a
   network, install it on the mini (and the PC) so `ssh mini` works from anywhere.
3. Confirm the sleep cause from `pmset -g log`, check `~/Library/Logs/lu-bot/bot.log`.
4. Resume Task 5 step 4: user mentions Lu **with text** (not a bare `@Lu`).
5. Tasks 6 and 7.

## Decisions waiting on the user

- **FileVault is On.** Every power cut leaves the mini locked with no Ollama, no
  bot and no SSH until someone types the password at the machine. Turn it off, or
  accept manual unlock. Task 6's reboot test will fail until this is decided.

## Accepted known risk

**The real Discord bot token is still in git history.** `.env.example` held the
live token, guild ID and channel IDs from `568d300` until `d8ec09d` replaced them
with placeholders. The user chose to scrub without rotating. The old values are
still recoverable with `git show <old-sha>:.env.example` — **and that history is
now on GitHub** (private repo, pushed 2026-09-11 at the user's request). It becomes
a real exposure the moment the repo is shared, made public, or GitHub access leaks. Rotating the token in the
Discord developer portal is the only step that makes those copies useless.

## Environment notes

- Mini: `ssh mini` → `jackcurphey@<mini-ip>`, key `~/.ssh/<key>`. **LAN only.**
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

## The bug to fix first (still open)

**A mention with no other text fails.** `src/discord.js` strips the mention tag
and can produce an empty string; the model server returns HTTP 400 because the
message is empty. Test-first: a mention-only message must never reach the model
as empty content.

## Also open

- A model-side failure is silent in-channel: model error, unverifiable quotation
  and over-length reply all look identical from Discord.
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
