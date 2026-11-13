# Lu on the PC, talking through Bonsai 2 27B — design

Date: 2026-11-13. Branch: `feat/lu-on-pc` (cut from `feat/tiny-chat`, which is
deployed but not merged). Status: draft, awaiting Jack's approval.

## Intent

Lu should be able to hold a conversation. Today his replies come from the tiny
model, which sounds absurd. Before that, a small Qwen model could produce a
sensible sentence, but Lu couldn't follow a back-and-forth: he kept replying,
but his replies didn't follow the conversation (Jack, 2026-11-13). Jack wants
him to sound normal and to keep track of what's being talked about.

The way to get there is a much bigger model, Bonsai 2 27B: PrismML's compressed
copy of Qwen3.8 27B. It runs on Jack's Windows PC, which has an NVIDIA RTX 5060
Ti with 8 GB of video memory. Lu moves to that PC, and replies should also get
faster.

## Goals

1. Lu's replies come from Bonsai 2 27B running on the PC's graphics card.
2. He follows a conversation over several turns, including turns from several
   people. He recalls what was said earlier in it.
3. A reply takes about 1–2 seconds to generate (measured below) — no slower
   than the tiny model on the mini.
4. Lu (the bot) runs on the PC, starts on its own after a reboot, and restarts
   if it crashes.
5. His current state moves with him: settings, logs database and credits.

## Non-goals

- **Memory of people across days, or searching old chats.** Jack confirmed the
  problem is following the current conversation, not long-term memory
  (2026-11-13). Saving and searching history can be a later project.
- **Changing his personality, mood modes or credits.** Only the reply length
  limits change (see Prompt and limits).
- **Changing when he joins a conversation** (attention, addressee judge). Jack
  said he didn't drop out of conversations; his replies just didn't make sense.
- **Linux.** Jack chose to stay on Windows (2026-11-13).
- **Pictures.** Bonsai can read images, but Lu doesn't need that yet. Its
  vision file isn't downloaded.

## Anti-goals (would count as failure even if it technically works)

- Lu running on the mini and the PC at the same time. Both would log in with
  the same token and reply twice.
- The model server reachable from the network without a password. Today it
  listens only on the PC itself.
- Losing the credits ledger or settings in the move.
- Replies that think out loud before answering. Thinking takes 3–7 seconds and
  can use up the whole reply limit, leaving an empty reply (measured below).

## What the test on 2026-11-13 established

These are measurements from the PC, not assumptions. The test server has since
been stopped.

| Item | Result |
| :--- | :--- |
| Software | PrismML's llama.cpp build `prism-b10777-e3de715`, Windows CUDA 13.3 version, in `C:\bonsai\bin` |
| Model file | `Ternary-Bonsai-2-27B-PTQ1_0.gguf`, 5,946,648,928 bytes, saved as `C:\bonsai\bonsai.gguf` |
| Server command | `llama-server.exe -m bonsai.gguf -ngl 99 -fa on -c 16384 --cache-type-k q4_0 --cache-type-v q4_0 --jinja --host 127.0.0.1 --port 8080` |
| Video memory | 7,006 of 8,151 MiB used with the model loaded. Windows alone was using 914 MiB before |
| Generation speed | 53–55 tokens per second, fully on the graphics card |
| Prompt reading | about 750–830 tokens per second |
| Reply time, thinking off | 0.5–1.4 seconds with Lu's real personality file |
| Turning thinking off | `--reasoning-budget 0` did **not** turn it off. Sending `chat_template_kwargs: {"enable_thinking": false}` in each request did |
| Empty replies | 1 in 5 in the first run, then 0 in 12 repeats of the same turn |
| Conversation | Over five turns, he kept the topic, answered a second speaker, and correctly recalled his earlier suggestion |

The PC also has: Windows 11 Pro, a Ryzen 7 7800X3D, 31 GB of RAM, 187 GB free
on C:, git 2.55, and **Node 24.19**. The repo needs Node ≥ 26. Sleep is set to
never, and the network is marked Private. SSH from the Mac works as `mrpc`
(lowercase; `MRPC` does not resolve).

## Constraints

- **8 GB of video memory.** Only the smallest Bonsai 2 27B file (PTQ1_0) fits,
  leaving about 1.1 GB. Nothing else can go on the card alongside it.
- **PTQ1_0 needs PrismML's own llama.cpp build.** Standard llama.cpp rejects
  it.
- **The PC is also Jack's gaming PC.** A game needs video memory too. See open
  question 1.
- The repo uses `node:sqlite`, so Node 26 has to be installed on the PC.
  Installing it is a dependency change and needs Jack's approval.
- The repo's own test command is `npm test`. It has to pass before a commit.

## Approaches considered

1. **Bonsai 2 27B on the PC, fully on the card (chosen by Jack, 2026-11-13,
   after the test).** It gives the smartest Lu the card can run. The test
   showed it fits with room for a 16K-token conversation window at 55 tokens
   per second.
2. **Bonsai 2 9B.** It fits easily and leaves room for other models. It is
   faster but noticeably less capable. Kept as the fallback if open question 1
   makes 27B unworkable.
3. **27B partly in normal memory.** It always fits, but it is much slower,
   which defeats the reason for moving. Rejected.

## Design

### Where things run

Everything runs on the PC.

```text
Discord ──> Lu (node src/index.js, C:\lu-bot)
               │  replies + judges
               └──> llama-server (Bonsai 2 27B) on 127.0.0.1:8080, on the GPU
```

- **Judges move to Bonsai** too: the addressee judge and the corpus judge.
  Ollama/Qwen isn't installed on the PC. With thinking off, a judge answer is a
  few tokens and takes well under a second.
- **No embedding model is needed today.** The live mini has no text library:
  `data/raw` is empty and there is no `data/corpus`. `retrieve()` returns
  before embedding when the library is empty (`src/index.js:85-86`).
  `LLM_EMBED_MODEL` stays a required setting, so it keeps its current value,
  but nothing calls it. If a text library is added later, a small embedding
  model can run on the processor; that is out of scope here. This replaces my
  earlier suggestion in chat to run one on the processor.

### Code changes

1. **Turn thinking off per request.** Add an optional setting,
   `LLM_DISABLE_THINKING` (default off, so the mini's behaviour is unchanged).
   When it's set to `true`, both `chat()` and `chatWithFinish()` in
   `src/llm.js` add `chat_template_kwargs: { enable_thinking: false }` to the
   request body. The setting applies to judges as well as replies: the
   addressee judge allows 3 tokens, and thinking would use all of them. Tests
   first, in `test/llm.test.js` and `test/config.test.js`.
2. **Prompt and limits.** Raise `HISTORY_LIMIT` / `HISTORY_TRIM_TO` from 20/10
   to 60/40, so he sees more of the conversation. 40 messages is roughly
   1,500–3,000 tokens, well inside the 16K window. Keep `REPLY_MAX_TOKENS` at
   120: with thinking off, the test replies used 16–31 tokens. Leave the
   persona's "under about forty words" line as it is, because Jack hasn't asked
   for longer replies. These are `.env` values on the PC, not code changes.
   Exact numbers are the builder's call after a live check.
3. **Shutting down on Windows (my call; Jack can overrule).**
   `src/index.js:207` saves credits on SIGINT/SIGTERM. Neither Task
   Scheduler's "End" nor a forced Windows Update reboot sends either signal;
   both just kill the process. The ledger is already written to disk 2 seconds
   after the last award (`CREDITS_FLUSH_MS`). So a hard kill loses at most the
   awards from the last 2 seconds, and only if they came just before the kill.
   I'm accepting that small loss rather than adding a wrapper program (a new
   dependency) or new shutdown code. No code change.
4. **Version and changelog.** Bump the version (v1.9) and write a changelog
   entry that Lu announces on start, as with previous releases.

Nothing else in `src/` changes. Paths already use `path.join` from the
project root.

### Running it on Windows

- **Install:** Node 26 (needs Jack's approval). The model stays in
  `C:\bonsai`, which is already downloaded.
- **Getting the code there (my call).** Copy the tracked files to `C:\lu-bot`
  over SSH, the same way the mini has been deployed (`git ls-files`, then
  copy). This means nothing has to be pushed to GitHub, and neither
  `feat/tiny-chat` nor `feat/lu-on-pc` has to be merged first. Merging both to
  `main` is Jack's call at pull-request time. Run `npm ci` on the PC after
  copying.
- **Starting both at boot, restarting on crash.** Two Windows Task Scheduler
  tasks, set to run whether or not Jack is logged in and to restart on
  failure. One runs `llama-server`, the other runs Lu (with Lu waiting until
  the model server answers). Task Scheduler is built into Windows, so nothing
  extra is installed. See code change 3 for what a stop costs.
- **Logs:** each task writes its output to `C:\lu-bot\logs\` (gitignored).
- **Model server settings:** the server command from the test table above,
  plus `--parallel 2`. One reply and one judge can overlap, and the test's
  default of 4 slots wasn't needed. Bound to 127.0.0.1 only. The 16K window is
  shared between the slots, so each gets 8K tokens. The persona plus 40
  messages should fit in that. Check it against the real prompt size, and
  raise `-c` if it doesn't fit (the card has about 1.1 GB spare).

### Moving over (cutover)

1. Stop Lu on the mini: `launchctl bootout` for `com.curphey.lu-bot` and
   `com.curphey.lu-tiny`, so neither restarts. Leave the plists in place as the
   way back.
2. Copy `data/lu.db` (after the bot stops, so its `-wal` file has been merged
   in), `data/credits.json` and `data/announced-version.txt` to the PC, plus
   `data/suggestions.jsonl` if it exists by then (it doesn't today). Copy
   `.env` over SSH, never through git. On the PC, change `LLM_BASE_URL` to
   `http://127.0.0.1:8080/v1`, remove `LLM_CHAT_BASE_URL`, set both
   `LLM_CHAT_MODEL` and `LLM_JUDGE_MODEL` to `bonsai.gguf`, and set
   `LLM_DISABLE_THINKING=true`. The mini's `.env` has no
   `LLM_ADDRESSEE_MODEL`, so the addressee judge follows `LLM_JUDGE_MODEL`.
   Keep it that way: setting it to a model the server doesn't have turns that
   judge off at startup (`src/index.js:74`).
3. Start both tasks on the PC. The log should show `Loaded N members`,
   `Registered 2 slash command(s)` and `Announced v1.9`.
4. Live check in Discord: a five-turn conversation with two people, plus one
   message that isn't aimed at Lu, to check the addressee judge.
5. **Way back:** stop and disable both PC tasks, then on the mini
   `launchctl enable gui/$(id -u)/com.curphey.lu-bot` and
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.curphey.lu-bot.plist`
   (and `lu-tiny`) on the mini. Copy back `credits.json` and `lu.db` first if
   members earned credits on the PC.

### Done when

- `npm test` passes on the branch, including new tests for
  `LLM_DISABLE_THINKING`. Each new test has been seen to fail with the code
  change reverted.
- On the PC after a reboot, both tasks are running without anyone logging in.
- In Discord, Lu follows a five-turn, two-person conversation. A message that
  names or @mentions him gets its reply within about 3 seconds. A follow-up
  that doesn't name him first waits the existing 3-second pause
  (`PAUSE_SECONDS`, `src/conversation.js:600`). That pause is unchanged, so it
  isn't counted against the target.
- The mini's Lu is stopped and stays stopped.

## Open questions (Jack's to answer)

1. **Gaming — answered 2026-11-13: Lu goes offline, keep it simple.** No
   fallback to the mini and no code to detect games. If a game crowds the
   model out, Lu is slow or silent until it ends. When the PC is off or
   restarting, Lu is offline. The original question follows for the record.

   While a game is running, the model holds about 6 GB of the 8 GB
   card. What should happen then? Options:
   1. Lu keeps running. Games get less video memory, and Lu may slow down if
      Windows pushes the model out to normal memory.
   2. Lu goes quiet, or falls back to a smaller model, while a game is
      running.
   3. Don't game on that PC while Lu lives there.

   Not measured yet. The same goes for whenever the PC is off or restarting,
   for example after Windows Update. The mini is up all the time, but on the
   PC Lu is offline whenever the PC is. The answer could change the whole
   setup. Keeping the mini as a standby would also need a way to make sure
   only one copy of Lu replies.
2. **Node 26 on the PC.** Installing it is a new dependency on that machine,
   so it needs a yes.

## Left to the builder

- Exact history limit numbers, after a live check.
- Whether Lu's start waits for the model server, or retries the first call.

## Decision log

| When | Decision | Why |
| :--- | :--- | :--- |
| 2026-11-13 | Stay on Windows, no Linux | Jack: the PC is used as a normal Windows machine |
| 2026-11-13 | Fix conversation-following, not long-term memory | Jack: the problem is replies not following the conversation |
| 2026-11-13 | Test 27B before choosing between 27B and 9B | Jack picked option 1 |
| 2026-11-13 | CUDA 13.3 build, not 12.4 | The 5060 Ti is newer than CUDA 12.4. It loaded and ran on driver 610.88 |
| 2026-11-13 | Turn thinking off per request with `enable_thinking: false` | `--reasoning-budget 0` didn't work in the test; the per-request setting did |
| 2026-11-13 | Judges on Bonsai, no embedding model | No room on the card; the live mini has no text library, so embeddings never run |
| 2026-11-13 | Model server bound to 127.0.0.1 | Lu runs on the same PC; no reason to open it to the network |
| 2026-11-13 | Task Scheduler, accept losing at most 2 s of credits on a hard kill | Reviewer: Task Scheduler and forced reboots don't send Ctrl+C. A wrapper would be a new dependency for a tiny loss |
| 2026-11-13 | Deploy by copying files over SSH, no push or merge needed first | Reviewer: neither branch is on GitHub. Same method as the mini deploys |
| 2026-11-13 | Lu goes offline while the PC is busy gaming, off or restarting; no mini fallback | Jack: "Go offline, keep simple" |
| 2026-11-13 | The 3 s reply target excludes the existing pause | Reviewer: follow-ups wait `PAUSE_SECONDS` before Lu starts, and that's a non-goal to change |
