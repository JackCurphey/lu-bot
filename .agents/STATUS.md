# Lu Bot — status

**Last session:** 2026-09-09. Branch `feat/foundation`, not merged, nothing pushed.

## Where it stands

Nine tasks built and reviewed, plus a whole-branch review and two fix waves.
**159 tests passing.** The bot connects to Discord, loads its persona, and
replies in character in ~6.6s end to end.

Live run happened. The Discord half is confirmed working — mentions are
received and handled. Replies failed for one specific reason, now diagnosed.

## The bug to fix first

**A mention with no other text fails.** `src/discord.js` strips the mention tag
and can produce an empty string; LM Studio returns HTTP 400 "No user query
found in messages." Verified directly: empty user content → 400, non-empty →
200. Both live attempts were bare `@Lu` mentions.

Test-first: a mention-only message must never reach the model as empty content.

## Also open

- A model-side failure is silent in-channel. Several paths now end in silence
  (model error, unverifiable quotation, over-length reply) and look identical
  from Discord. A dropped fabrication should stay silent; a model error should
  probably say something.
- **Before ingesting any real texts:** ingest hardcodes every author to
  `unknown` and chapter to `null` (`scripts/ingest.js`), and the chunker has no
  sentence fallback, so an oversized paragraph becomes one oversized chunk
  (`src/corpus/chunk.js`). Both deferred deliberately — no corpus exists yet.
- Proactive chiming (speaking unprompted) is not built. `TRIGGER_COOLDOWN_SECONDS`
  and `TRIGGER_ENABLED` are parsed but nothing reads them.

## Environment notes

- LM Studio 0.4.24. Models: `qwen3.6-27b-mlx` (chat), `qwen3-4b-instruct-2507-mlx`
  (judge), `text-embedding-nomic-embed-text-v1.5` (768-dim).
- **The chat model's Jinja template was hand-edited** to add
  `{%- set enable_thinking = false %}` as line 1. This took replies from 82s to
  2.7s. Re-downloading or updating the model WILL undo it. Original backed up
  during the session; the edit is one line at the top of
  `~/.lmstudio/models/lmstudio-community/Qwen3.6-27B-MLX-4bit/chat_template.jinja`.
- Closing the MacBook lid sleeps everything and takes the bot offline.
- `.env` exists, is gitignored, and is correctly configured.

## Read next

- Spec: `docs/superpowers/specs/2026-09-09-discord-corpus-bot-design.md`
- Plan: `docs/superpowers/plans/2026-09-09-lu-bot-foundation.md`
- Full ledger incl. every ruling and parked finding:
  `.superpowers/sdd/2026-09-09-lu-bot-foundation/progress.md` (gitignored)
