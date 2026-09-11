# Decisions — append-only

Supersede with a new entry; never rewrite an old one.

## 2026-09-10 — Deploy to the Intel Mac mini

| # | Decision | Rationale | Approver |
|---|---|---|---|
| D1 | Run Lu on the 2018 Intel Mac mini (A1993) | Always-on host; the MacBook sleeps when the lid closes | user |
| D2 | Ollama replaces LM Studio | LM Studio does not support Intel Macs; MLX is Apple-silicon only. Ollama ships an x86_64 universal binary with an OpenAI-compatible API | user |
| D3 | `qwen3:4b-instruct` for both chat and judge | Measured on the mini: only well-behaved candidate (`gemma3:4b` fabricated a quotation; `llama3.2:3b` drifted off persona); one resident copy fits memory; non-thinking | user |
| D4 | ~15s reply latency accepted | Measured, not estimated | user |
| D5 | Mini is the only running instance; no separate dev bot | User's choice; local verification relies on the test suite | user |
| D6 | Typing indicator added | 13-15s of silence is indistinguishable from being ignored | user |
| D7 | Proactive chiming deferred | Blocked on a corpus, not on hardware | user |
| D8 | `.env.example` scrubbed to placeholders, token NOT rotated | User wanted to test now and tighten later. Risk recorded in STATUS.md | user |
| D9 | Deploy by rsync, not git | The mini has no working git; installing Xcode CLT on a headless server to get file transfer was judged the wrong trade | controller ruling R6 |
| D10 | GitHub repo creation deferred | Outward-facing; not yet authorised | controller ruling R5 |
| D11 | Tailscale for remote management | The SSH setup is LAN-only, which blocked all work once the MacBook changed networks | user |
