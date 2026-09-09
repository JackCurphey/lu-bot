# Lu Bot — Design

**Date:** 2026-09-09
**Status:** Awaiting review

## Purpose

Lu Bot is a Discord bot with its own personality, named after the Chinese
weightlifter Lu Xiaojun. It converses in character, and can draw on a corpus of
political-philosophy primary texts (works by Marx and Mao) when doing so adds
something — quoting them verbatim with attribution. It responds when directly
mentioned, and can also volunteer a relevant quote unprompted in an allowlisted
channel.

**The corpus starts empty.** Texts are added later; the ingest path exists from
the start so that adding them is a data change, not a code change.

All inference runs locally. No text or conversation leaves the machine.

## Hardware and runtime context

Inference host is the MacBook Pro (Apple M1 Max, 32-core GPU, 32 GB unified
memory, ~400 GB/s memory bandwidth). This was chosen over the alternative
machine (RTX 5060 Ti 8 GB, 448 GB/s — verified) because unified memory allows
roughly 21 GB of model weights versus about 7 GB usable after context. The
bandwidth figures are close enough that generation speed is comparable; the
capacity difference is decisive, allowing a ~30B-class model instead of ~8B.

The model host is a configuration value (`LLM_BASE_URL`), so moving inference
to the other machine over the LAN is a one-line change, not a rewrite.

Runtime: Node.js v26.8.1, `discord.js`. LM Studio 0.4.24 serves the chat,
judge, and embedding models over its OpenAI-compatible endpoint. On Apple
Silicon, prefer MLX model builds over GGUF where available — commonly 10–40%
faster on the same chip.

## Architecture

Four components with single responsibilities and clean seams.

### Discord adapter
Owns the gateway connection, receives messages, sends replies. Knows nothing
about models or the corpus. Everything beneath it is testable without Discord
running.

### Corpus store
Built offline by an ingest script, never by the running bot. Reads source
texts, chunks them, embeds each chunk via LM Studio, writes vectors and
metadata to disk. The bot loads this at startup and searches it in memory.

Ingest is separate because embedding several books takes minutes and must
never happen on the path of answering a message.

### Judge
Decides whether retrieved passages reach the prompt at all. Retrieval finds
candidates; the judge answers a single narrow question about whether quoting
would genuinely add something, using the small fast model with `temperature: 0`.

**It fails closed toward silence.** Empty candidates, an unparseable answer, a
missing field, or a thrown error all mean "do not quote". A judge outage
degrades Lu Bot to an ordinary conversationalist rather than to a quote machine.

This gate exists because a system-prompt instruction is a weak brake once
passages are already in context: a model handed passages tends to use them.

### Trigger
The two-stage gate for speaking *unprompted*. Takes an incoming message,
returns a decision: stay quiet, or speak with these retrieved chunks.

**This is a pure function with no side effects.** That property is load-bearing:
it allows replaying saved channel history through the trigger offline to see
exactly what it would have said, without it saying anything to anyone. Tuning
thresholds otherwise means restarting the bot and waiting for someone to talk.

### Responder
Takes a message plus retrieved chunks, assembles the persona system prompt,
calls the chat model, returns text. Runs the quote verifier before returning.

## Data flow

1. Message arrives at the adapter.
2. Guardrails reject outright: authored by a bot, authored by the bot itself,
   or a channel not on the allowlist. (The cooldown window is listed under
   Guardrails as parsed but not enforced — see that section.)
3. If the bot was directly mentioned, it always responds — but whether that
   response draws on the corpus is decided by the judge, which gates whether
   retrieved passages reach the prompt.
4. Trigger stage one embeds the message, finds nearest chunks, drops anything
   below `TRIGGER_SIMILARITY_FLOOR`. No model call.
5. Trigger stage two asks the judge model whether the corpus genuinely adds
   something here. Structured output (boolean plus confidence), not prose.
6. Responder generates in persona — with retrieved chunks as context if the
   trigger said so, otherwise conversationally with none. For an unprompted
   message, a negative trigger means staying silent; for a direct mention, it
   means replying without the corpus.
7. Quote verifier confirms any quoted span appears verbatim in the retrieved
   text. Failures are stripped or the message is dropped.
8. Adapter posts.

## Corpus and retrieval

**Chunking.** Split on natural boundaries, targeting 500–800 tokens per chunk
with ~15% overlap. Overlap exists because a relevant passage may straddle a
boundary. Paragraph-aligned splitting keeps chunks semantically whole,
improving both retrieval and quote quality.

**As built there is no sentence-level fallback.** The chunker splits on
paragraphs only; a paragraph larger than the target is emitted whole, however
long it is. This is tolerable today because the corpus is empty. It must be
fixed before real texts are ingested — Marx in particular runs to
page-length paragraphs, and an oversized chunk degrades retrieval (the
embedding averages over too much) and pushes past `MAX_QUOTE_CHARS` on the way
out. Deferred deliberately rather than built against zero data.

**Metadata** accompanies every chunk: work title, author, chapter, and position.
This is what makes citation possible and cannot be reconstructed after ingest.

**Storage.** A flat binary file of raw `Float32` vectors loaded into a typed
array, plus a JSON sidecar holding chunk text and metadata. JSON for the
vectors themselves would be roughly 150 MB and slow to parse at every startup.

**Empty corpus is a supported state, not an edge case.** With zero chunks
loaded, retrieval returns nothing, the trigger always reports that the corpus
adds nothing, and Lu Bot operates as a persona-only conversationalist. Startup
must not fail on a missing or empty corpus file, and this case gets its own
test. Designing it in now costs nothing; retrofitting it later means auditing
every retrieval call site.

**Search.** Brute-force cosine similarity across all chunks, returning top-k.
At this corpus size (~10k chunks) this is single-digit milliseconds. No vector
database, no index, no approximation. If the corpus outgrows this, swapping in
`sqlite-vec` is a contained change behind the store's interface.

## Quote integrity

A language model asked to quote will readily invent a passage that sounds
authentic. For this corpus that failure is especially costly — misattributed
Marx quotations are already endemic online, and a bot confidently citing a
fabricated line to a chapter is worse than a bot that says nothing.

Two defences:
1. The system prompt permits quoting only from the chunks supplied in context.
2. Before posting, a mechanical check confirms the quoted span appears verbatim
   in the retrieved text. This is a string check, not a matter of trusting the
   model.

**As built, the verifier returns `{ ok, fabricated, overlong, unverifiable }`,
and `ok` requires all three lists to be empty.** The third list is the outcome
of five review rounds: a reply whose quoting cannot be parsed unambiguously is
rejected rather than waved through. Unbalanced delimiters, ambiguous pairing
where several readings are possible, and unpaired opening or closing marks all
land there. The direction is deliberate — saying nothing beats inventing a
citation.

Recognised delimiters are `" "`, `“ ”`, `「 」`, `『 』`, `« »`, `【 】`,
`﹁ ﹂`, `〈 〉`, `《 》` and fullwidth `＂`. `‘ ’` are deliberately excluded
because they double as apostrophes.

**The load-bearing assumption, stated plainly: the verifier only inspects text
that sits inside a recognised delimiter.** Nothing about the delimiter logic
obliges the model to use one, so five review rounds of hardening delimiter
*pairing* left a reply of the shape `As Mao wrote in On Practice: <invented
sentence>` completely unchecked. Two things follow, and both are now built:

1. The persona is *required* to wrap every quotation in `"` or `「 」`, and is
   told that a quotation it cannot wrap that way must not be given at all.
2. Attribution-shaped output carrying no delimiter — a Discord blockquote
   line, or an attribution cue followed by a colon and quoted-looking text —
   is rejected as `unverifiable`. This occasionally flags a reply that merely
   uses a colon after "said" without quoting. That is the correct direction to
   err.

The same rule scopes what the verifier does *not* do: with no passages
supplied there is nothing to cite, so fabrication matching does not run at
all. Quoting the person you are talking to back at them is conversation, and
running an empty haystack against it muted the bot in its own default
shipping state.

**The length floor is script-aware.** A quoted span is checked when it has five
or more whitespace-separated words *or* eight or more CJK characters. A
word-count-only floor made the verifier inert in Chinese, which for a persona
that quotes Mao is the language a fabricated quotation is most likely to arrive
in.

**The verifier gates quoted spans only, never whole replies.** A conversational
reply with no quotation has nothing to verify and must pass through untouched.
Gating every response would block ordinary conversation on a check with no
subject.

The verifier is tested with a deliberately fabricated quote to prove it catches
them.

## Persona

Defined in an editable prose file, not in code, so character iteration is a
text edit and a restart rather than a code change.

The character has its own personality and voice. The corpus is a resource it
draws on when relevant, not the whole of what it is. It converses normally and
reaches for a quote when one genuinely adds something.

**Consequence: retrieval is optional per response.** Most messages get an
in-character reply with no corpus lookup. This applies to direct mentions too —
being addressed does not imply a citation is wanted. Two response modes:

- **Conversational** — in-character reply, no retrieval, no quote.
- **Corpus-backed** — retrieval runs, quotes are included and attributed.

Where the persona expresses a position, it does so as the character. Where it
quotes, the attribution must be exact. These are separate obligations: the
first is a matter of voice, the second is mechanically enforced below.

## Conversation memory

Per-channel, not per-user.

**As built, the window holds bot-mention exchanges only** — the user message
that mentioned the bot and the reply it gave, the last twelve entries per
channel. Messages between humans never enter it, because the adapter discards
anything that does not mention the bot before it reaches the responder.

The original intent was a rolling window of recent *channel* messages, on the
reasoning that in a shared server people talk to each other as much as to the
bot and per-user memory would produce replies that ignore the surrounding
conversation. That is still the intent; it is not what exists. Reaching it
requires the adapter to buffer non-mention messages, which is a change to the
allowlist and privacy story and belongs with the proactive-speech stage.

## Guardrails

**Enforced as built:**

- Channel allowlist. Start narrow — one opted-in discussion channel. An empty
  allowlist means the bot responds to nothing; startup warns when it is empty,
  because a bot that connects and silently ignores everyone looks healthy.
- Never respond to itself or to other bots.
- Maximum quote length (`MAX_QUOTE_CHARS`).

**Parsed but not yet enforced.** `config.js` loads these and nothing reads
them. They belong to the proactive-speech stage, which is where the behaviour
they gate lives:

- Cooldown between unprompted messages (`TRIGGER_COOLDOWN_SECONDS`) — there
  are no unprompted messages yet to space out.
- Global off switch (`TRIGGER_ENABLED`) — nothing consults it, so setting it
  to `false` currently changes nothing.

## Testing

- Unit tests: chunking, cosine similarity, quote verifier.
- Fixture-based tests for the trigger over saved messages.
- LM Studio is stubbed throughout. The suite runs with no model loaded and no
  GPU; otherwise it is slow, non-deterministic, and stops being run.
- Every test is watched to fail before it is trusted.

## Tuning workflow

A replay script feeds saved channel history through the trigger and reports
what it would have said and where. Tuning happens against real messages in
seconds.

## Build sequence

Each stage is a foundation for the next and independently testable.

1. Persona chat on direct mention.
2. Corpus ingestion and retrieval.
3. Retrieval-backed answers when asked, gated by the judge.
4. Proactive chiming, tuned via the replay harness.

Stages 1-3 are built. Stage 4 remains: the judge ships, but deciding whether to
speak *at all* in a channel nobody addressed is separate work.

## Secrets

The Discord bot token is a full credential. It lives only in `.env`, which is
gitignored from the first commit. `.env.example` documents the required keys
with empty values.

## Models

Verified against LM Studio's catalogue on 2026-09-09, not recalled.

| Role | Model | Size |
|---|---|---|
| Chat | `lmstudio-community/Qwen3.6-27B-MLX-4bit` | 16.1 GB |
| Judge | `lmstudio-community/Qwen3-4B-Instruct-2507-MLX-4bit` | ~2.5 GB |
| Embedding | `text-embedding-nomic-embed-text-v1.5` (768-dim) | 84 MB |

**Why the dense 27B and not the 35B-A3B MoE.** The MoE would generate far
faster (3B active parameters), but at 20.4 GB it leaves no room for a resident
judge model within the ~21 GB the GPU can address. Chat plus judge must fit
together: 16.1 + 2.5 ≈ 18.6 GB fits with headroom for KV cache; 20.4 + 2.5 does
not. Keeping the cheap two-stage trigger was judged more valuable than faster
generation.

**Why the Instruct judge and not base Qwen3-4B.** Base Qwen3 models are hybrid
reasoning models that emit a thinking phase. A judge returning a structured
yes/no on every message must be fast and terse; the Instruct variant skips
thinking.

MLX builds throughout — both runtimes are installed, and MLX is commonly
10-40% faster than GGUF on Apple Silicon.

## Operational requirements

- **`MessageContent` is a privileged Discord intent.** It must be enabled for
  the application in the Discord developer portal, or the bot connects
  successfully and then sees every message as empty — a failure that looks like
  the bot ignoring people rather than like a configuration error.
- The bot token, guild ID and allowed channel IDs live in `.env`, which is
  gitignored. `.env.example` documents every key.

## Open questions

- **Source texts.** Deferred by decision. No texts are added now; the bot runs
  with an empty corpus, persona-only. Which specific works, and where the files
  come from, is settled later. Marx is public domain; Mao's works are widely
  available via the Marxists Internet Archive. This no longer blocks the build.
- **Persona detail.** Direction set: a Chinese Maoist, cheeky but serious.
  Enough to write a first persona file against, explicitly as a starting point.
  Voice, register, and behavioural rules will be tuned against real output
  rather than settled up front.
