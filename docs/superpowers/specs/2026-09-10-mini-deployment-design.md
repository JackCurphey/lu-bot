# Lu Bot on the Mac mini — deployment design

**Date:** 2026-09-10
**Status:** approved design, not yet implemented
**Supersedes nothing.** Extends `2026-09-09-discord-corpus-bot-design.md`.

## Intent

Move Lu Bot off the MacBook and onto a Mac mini that stays powered on
permanently, so the bot is available whether or not a laptop lid is open.

The existing status file records the problem plainly: *"Closing the MacBook lid
sleeps everything and takes the bot offline."* A bot designed to sit in a
channel for weeks cannot live on a laptop.

## The hardware, and what it forces

The target is a **Mac mini A1993 (Macmini8,1, 2018)**: Intel Core i3-8100B,
4 cores, no hyperthreading, 16GB RAM, macOS 15.7.9, 196GB free.

Being Intel is the decisive fact. It rules out the entire current inference
stack:

- **LM Studio does not support Intel Macs.** Its published requirements state
  Apple Silicon (M1/M2/M3/M4) and that "Intel-based Macs are currently not
  supported".
- **MLX is Apple-silicon only.** `qwen3.6-27b-mlx` and
  `qwen3-4b-instruct-2507-mlx` cannot be loaded on this machine in any runtime.

So the move is not a redeployment of the same stack. It is a change of
inference runtime and a change of model, with the Discord and persona
behaviour held constant.

**Ollama replaces LM Studio.** Its macOS CLI tarball is a universal binary
including `x86_64`, and it ships `libggml-cpu-haswell.so`, the backend this
CPU's AVX2 support selects. It serves an OpenAI-compatible API, which is what
`src/llm.js` already speaks.

## Measurements

Taken on the target machine on 2026-09-10, using the real `persona/lu-bot.md`
as the system prompt and prompt shapes mirroring `buildMessages()` and
`buildJudgeMessages()`. Timings are Ollama's own `prompt_eval_duration` and
`eval_duration`, not wall clock.

| Model | Generation | Cold prefill | RAM |
|---|---|---|---|
| `llama3.2:3b` | 11.8 tok/s | 47.3 tok/s | 2.0GB |
| `gemma3:4b` | 10.5 tok/s | 47.8 tok/s | 3.3GB |
| `qwen3:4b-instruct` | 9.7 tok/s | 45.8 tok/s | 2.5GB |
| `qwen3:8b` | 5.4 tok/s | 23.1 tok/s | 5.2GB |

Embeddings (`nomic-embed-text`): **25ms** per message server-side, ~16ms each
when batched. 768 dimensions, matching the dimensionality the corpus store
already expects.

Two measurement traps were hit and corrected, and are recorded because anyone
re-running this will hit them too:

1. **Prefill measured with a warm cache is meaningless.** An initial run reported
   ~4,600 tok/s prefill because the warmup used an identical prompt and the KV
   cache still held the persona prefix. Prepending a unique nonce to the system
   prompt invalidates the cache and yields the true ~46 tok/s.
2. **Embedding latency measured over SSH is mostly SSH.** An initial 1.13s
   figure was round-trip overhead. Measured server-side it is 25ms — a
   45x error, and one that would have wrongly ruled out proactive chiming on
   throughput grounds.

## Model selection

**`qwen3:4b-instruct` for both the chat model and the judge model.**

Reasons, in order of weight:

1. **It behaves.** Of the four candidates, only `qwen3:4b-instruct` and
   `qwen3:8b` stayed in persona and quoted nothing they were not given.
   `gemma3:4b` fabricated an attributed Marx quotation with no corpus loaded —
   which the undelimited-attribution check would drop, converting its apparent
   speed advantage into silence. `llama3.2:3b` invented a first-person
   political position.
2. **One model serves two roles**, so only one copy occupies RAM. Ollama
   reports 9.2GiB available of 16GB; `qwen3:8b` as chat plus a separate judge
   model would sit near that ceiling and risk evict-and-reload cycles, each
   costing a full cold prefill.
3. **It is non-thinking by construction**, so no reasoning tokens are generated
   and then discarded. This removes the need for the hand-edited Jinja template
   documented in the status file, which a model update silently reverts.
   Ollama additionally accepts a per-request `think: false`, making reasoning
   suppression a config concern rather than a file someone must remember to
   patch.
4. It is the same lineage as `qwen3-4b-instruct-2507-mlx`, the judge model
   already in use and trusted.

`qwen3:8b` is better written but roughly doubles latency and creates the
memory pressure described above.

### Expected latency

With no corpus ingested, `retrieve()` short-circuits and no embedding or judge
call is made, so a reply costs one chat call: **~13-15 seconds**. The first
reply after a service restart is slower — roughly 25 seconds — because the
persona prefix must be prefilled cold.

Once a corpus exists, add ~25ms for retrieval and ~10s for the judge call,
whose prompt contains different passages each time and therefore prefills cold.

## Design

### 1. Inference layer

Ollama is installed at `~/ollama`, user-owned, requiring no `sudo`. A launchd
agent `com.curphey.ollama` runs `ollama serve` with `RunAtLoad` and `KeepAlive`.

- Bound to **127.0.0.1 only**. The model server is never reachable from the
  LAN.
- `OLLAMA_KEEP_ALIVE=-1`, pinning `qwen3:4b-instruct` in memory permanently.
  Without this Ollama unloads idle models after ~5 minutes, so a bot that is
  quiet overnight pays a model load plus a cold prefill on the first message of
  the morning — precisely the message someone is waiting on.

Models installed: `qwen3:4b-instruct` (chat and judge), `nomic-embed-text`
(embeddings). The other three benchmark models are removed once the choice is
settled.

### 2. Node runtime

The mini has no Node and no Homebrew. `package.json` requires `node >=26`.

Node is installed from the **official checksummed tarball**, unpacked into the
user's home directory. Not the `.pkg` (needs a password, installs
system-wide), and not a version manager (an extra third-party install script
for a machine that will only ever run one Node version).

The target is **Node v26.8.1**, the version the MacBook currently runs and
under which all 159 tests pass. Matching it removes runtime version as a
variable if behaviour differs between the two machines. The `darwin-x64` build
and its published SHA-256 were confirmed present on 2026-09-10.

### 3. Code delivery

A **private** GitHub repository is created and `feat/foundation` pushed to it.

This is independently overdue: nine tasks of work and 159 tests currently exist
on exactly one machine, unpushed. Note there is **no `main` branch** in this
repository — only `feat/foundation` and `spec/initial-design`. Establishing a
default branch is part of this work.

The mini clones to `~/lu-bot`. Deployment thereafter is `git pull` plus a
service restart.

`.env` is never committed. It is placed on the mini once, `chmod 600`, from
the values already in use.

### 4. Configuration

```
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_CHAT_MODEL=qwen3:4b-instruct
LLM_JUDGE_MODEL=qwen3:4b-instruct
LLM_EMBED_MODEL=nomic-embed-text
```

`src/llm.js` posts plain OpenAI-compatible JSON to `/chat/completions` and
`/embeddings`, so no client rewrite is expected.

**Verified against the running server on 2026-09-10**, having been flagged as
an assumption when this design was first written. Ollama's OpenAI-compatible
endpoints return exactly the shapes `llm.js` destructures:

- `/v1/chat/completions` → `choices[0].message.content`
- `/v1/embeddings` → `data[].embedding`

No client rewrite is required. The contract is pinned by tests in the
implementation plan so that an Ollama upgrade changing it fails loudly rather
than silently.

### 5. Code changes

Two, both small, both test-first.

**Provider-neutral error text.** `src/llm.js` throws
`"LM Studio request to ${path} failed with status ${res.status}"`. On this
deployment that names software which is not installed and cannot run.

**Typing indicator.** `src/discord.js` posts a reply with no intermediate
signal. At 13-15 seconds, Discord shows nothing at all, which is
indistinguishable from Lu deciding to ignore the message. The adapter sends a
typing indicator when it begins handling a mention.

Discord's typing indicator expires after ~10 seconds, which is shorter than the
expected reply time, so it must be refreshed until the reply is posted or the
handler gives up. A dropped reply — the fabrication and over-length paths in
`respond()` return `null` — must stop the indicator rather than leave Lu
appearing to type indefinitely.

### 6. Service

A launchd agent `com.curphey.lu-bot`: `RunAtLoad`, `KeepAlive`,
`WorkingDirectory` at the clone, stdout and stderr to `~/Library/Logs/lu-bot/`.

`src/index.js` already resolves paths against the module rather than the
process working directory, explicitly because launchd does not run with the
repo as cwd. No change needed.

`KeepAlive` is a backstop, not the primary defence: the client already logs
gateway errors rather than dying, and `unhandledRejection` is trapped.

### 7. Host configuration

Requires the user's password; these are handed over as commands, not run by the
agent.

```
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 womp 1 autorestart 1 powernap 0
```

The mini currently has `sleep 1` and `autorestart 0` — it sleeps after a minute
idle and does not return after a power cut.

**FileVault must be checked.** If it is enabled, a reboot leaves the disk locked
with no Ollama, no bot and no SSH until someone types the password at the
physical machine. That defeats the entire purpose of an always-on box in a
corner. If enabled, the choice — disable it, or accept manual unlock after every
power event — belongs to the user.

## Out of scope

Named explicitly so they are not silently absorbed:

- **The mention-only bug.** A mention with no other text produces empty content
  and a 400. Real, blocking a working bot, and separate work.
- **Silent failure modes.** Model error, unverifiable quotation and over-length
  reply all end in identical silence.
- **Corpus ingest defects.** Author hardcoded to `unknown`, chapter to `null`,
  no sentence fallback in the chunker.
- **Proactive chiming.** See below.

## Proactive chiming — why it is not here

Stage 4 of the original build sequence. It was investigated during this design
and deliberately deferred.

**It is not blocked by the hardware.** Trigger stage one embeds every incoming
message, and at 25ms per embedding the mini could sustain roughly 40 messages a
second. The earlier assumption that this box was too slow for chiming rested on
a mismeasurement.

**It is blocked by the corpus.** Stage one finds nearest chunks and drops
anything below `TRIGGER_SIMILARITY_FLOOR`. With no corpus, retrieval returns
nothing and the trigger reports "stay quiet" for every message forever.
Chiming therefore depends on the ingest defects above being fixed and real
texts being chosen and ingested.

Two findings to carry forward when it is built:

- **Check the cooldown before the judge, not after.** `TRIGGER_COOLDOWN_SECONDS`
  governs how often Lu may speak unprompted. Running the ~10s judge call before
  the cooldown check burns CPU deciding something that is then discarded.
- **Everything serialises on four cores.** A chiming decision in flight delays a
  reply to someone who actually addressed Lu. Direct mentions should take
  priority.

Tuning uses the replay harness against saved channel history. Because the
trigger is specified as a pure function with no side effects, that replay runs
on the MacBook and never involves the mini — the slow hardware does not slow
the iteration loop.

**Sequence:** this deployment, then ingest fixes and a real corpus, then
chiming.

## Done-condition

Each is a command whose output is shown, not an assertion:

1. All 159 existing tests pass **on the mini**.
2. A new test covers the Ollama response shape for chat and embeddings, and has
   been watched to fail before it passed.
3. New tests cover the provider-neutral error text and the typing indicator,
   including that a dropped reply stops the indicator.
4. The bot answers a real mention in the allowlisted channel within ~20 seconds.
5. `launchctl kill` on the bot: it returns unaided.
6. A full reboot of the mini: both services return unaided and the bot appears
   online in Discord without anyone touching the machine.
7. Ollama stopped while the bot runs: the bot stays alive and logs the failure
   rather than crashing.

Items 5-7 are fault injection. A service that has never been killed is not a
service that restarts; it is a service nobody has tested.

## Decision log

| Decision | Reason |
|---|---|
| Ollama over llama.cpp | Universal binary with x86_64, OpenAI-compatible API needing no client change, and a service model suited to always-on. llama.cpp remains the fallback if per-token performance must be fought for. |
| `qwen3:4b-instruct` for chat and judge | Only well-behaved candidate that also fits memory twice over as one resident copy; non-thinking by construction; same lineage as the trusted judge. |
| `qwen3:8b` rejected | ~2x latency and memory pressure against 9.2GiB available, for a quality gain judged not to survive contact with Discord. |
| `gemma3:4b` rejected | Fabricated an attributed quotation with no corpus loaded. |
| Mini runs the only instance | User's decision. Local testing relies on the existing test suite rather than a second Discord application. |
| GitHub over LAN-only deploy | The code currently exists on one machine, unpushed. |
| Typing indicator added | 13-15s of silence is indistinguishable from being ignored. |
| Chiming deferred | Blocked on a corpus, not on hardware. |
