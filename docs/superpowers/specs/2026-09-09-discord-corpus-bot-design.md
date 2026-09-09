# Discord Corpus Bot — Design

**Date:** 2026-09-09
**Status:** Awaiting review

## Purpose

A Discord bot with a defined persona that answers questions about a corpus of
political-philosophy primary texts (works by Marx and Mao), quoting them
verbatim with attribution. It responds when directly mentioned, and can also
volunteer a relevant quote unprompted in an allowlisted channel.

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

### Trigger
The two-stage gate. Takes an incoming message, returns a decision: stay quiet,
or speak with these retrieved chunks.

**This is a pure function with no side effects.** That property is load-bearing:
it allows replaying saved channel history through the trigger offline to see
exactly what it would have said, without it saying anything to anyone. Tuning
thresholds otherwise means restarting the bot and waiting for someone to talk.

### Responder
Takes a message plus retrieved chunks, assembles the persona system prompt,
calls the chat model, returns text. Runs the quote verifier before returning.

## Data flow

1. Message arrives at the adapter.
2. Guardrails reject outright: authored by a bot, channel not on the
   allowlist, or inside the cooldown window.
3. If the bot was directly mentioned, skip the trigger and always respond.
4. Otherwise Trigger stage one embeds the message, finds nearest chunks,
   drops anything below `TRIGGER_SIMILARITY_FLOOR`. No model call.
5. Trigger stage two asks the judge model whether a quote genuinely adds
   something. Structured output (boolean plus confidence), not prose.
6. Responder generates in persona with the retrieved chunks as context.
7. Quote verifier confirms any quoted span appears verbatim in the retrieved
   text. Failures are stripped or the message is dropped.
8. Adapter posts.

## Corpus and retrieval

**Chunking.** Split on natural boundaries — paragraphs first, sentences as
fallback — targeting 500–800 tokens per chunk with ~15% overlap. Overlap
exists because a relevant passage may straddle a boundary. Paragraph-aligned
splitting keeps chunks semantically whole, improving both retrieval and quote
quality.

**Metadata** accompanies every chunk: work title, author, chapter, and position.
This is what makes citation possible and cannot be reconstructed after ingest.

**Storage.** A flat binary file of raw `Float32` vectors loaded into a typed
array, plus a JSON sidecar holding chunk text and metadata. JSON for the
vectors themselves would be roughly 150 MB and slow to parse at every startup.

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

The verifier is tested with a deliberately fabricated quote to prove it catches
them.

## Persona

Defined in an editable prose file, not in code, so character iteration is a
text edit and a restart rather than a code change.

The character is a scholar of the corpus: a distinct personality that knows
these texts well and cites them as text, with chapter and title. Not a figure
speaking from within the works.

The persona presents text with attribution rather than arguing positions. This
is both more useful for a reading group and less likely to make the bot
unwelcome in a shared channel.

## Conversation memory

Per-channel, not per-user. A rolling window of recent channel messages. In a
shared server people talk to each other as much as to the bot; per-user memory
would produce replies that ignore the surrounding conversation.

## Guardrails

All configurable, all enabled by default:

- Channel allowlist. Start narrow — one opted-in discussion channel.
- Cooldown between unprompted messages (`TRIGGER_COOLDOWN_SECONDS`).
- Never respond to itself or to other bots.
- Global off switch effective without restart (`TRIGGER_ENABLED`).
- Maximum quote length (`MAX_QUOTE_CHARS`).

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
3. Retrieval-backed answers when asked.
4. Proactive chiming, tuned via the replay harness.

## Secrets

The Discord bot token is a full credential. It lives only in `.env`, which is
gitignored from the first commit. `.env.example` documents the required keys
with empty values.

## Open questions

- **Source texts.** Which specific works, and where do the text files come
  from? Marx is public domain. Mao's works are widely available via the
  Marxists Internet Archive. Needs deciding before ingest can be built.
- **Model selection.** `Qwen3.6-35B-A3B` is a candidate from current sources
  but unverified against LM Studio's catalogue. An embedding model has not yet
  been chosen. Both require LM Studio first-run, which needs the user at the
  keyboard.
