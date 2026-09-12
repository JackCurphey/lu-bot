# Deferrals

| ID | Item | Reason | Approver | Revisit when |
|---|---|---|---|---|
| DF1 | ~~Create private GitHub repo and push~~ | DONE 2026-09-11 at user's request | user | — |
| DF2 | Rotate the Discord bot token | User chose scrub-only | user | Before the repo is shared or made public |
| DF3 | Decide FileVault on the mini | User's security trade-off | user | Before Task 6's reboot test |
| DF4 | Proactive chiming | Needs a corpus | user | After ingest is fixed and texts are ingested |
| DF5 | Lu changing his own username | New scope; stage 2 | user | Stage 2 (nicknames, memes, avatars, `!lu` help) |
| DF6 | ~~Port persona behaviour from the PC codebase~~ | DONE for stage 1 by `feat/old-lu-stage1` (persona + conversation behaviour) | user | — |
| DF7 | Synchronous-throw gap in `startTyping` (`src/discord.js`) | Minor; cannot fire against real discord.js | controller | Final whole-branch review |
| DF8 | Abort signal for corpus retrieval during a reply timeout | Not load-bearing while no corpus exists; `chooseChunks`/`shouldUseCorpus` get no abort signal, so after a reply timeout a corpus call can overlap the next job | controller | Becomes real once a corpus is ingested |
| DF9 | Ollama's context window (4096 tokens) vs corpus chunk size | Stage 1's prompts (~600-1300 tokens) fit; up to 5 retrieved chunks of ~600 words each could exceed it | controller | Before corpus ingestion ships |
