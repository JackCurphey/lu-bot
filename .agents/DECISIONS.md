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

## 2026-09-13 — Imperial Credits

| # | Decision | Rationale | Approver |
|---|---|---|---|
| D12 | Two separate scores, not one — Imperial Credits and Social Credit | They are different engines (activity levelling vs. China-sentiment scoring) that happen to want similar names; kept independent rather than merged | user |
| D13 | Imperial Credits built first; the Social Credit port deferred to its own spec | Imperial Credits is the simpler, better-precedented mechanic (MEE6-style levelling); Social Credit needs its own design pass, including the unresolved Imperial/Maoist register clash | user |
| D14 | MEE6's curve (`5n² + 50n + 100`), unchanged | So a level on Lu's server means what it means on any other MEE6-run server | user |
| D15 | 30-second per-user cooldown, not MEE6's 60 | Cry's Cantina is small and conversation arrives in bursts; halving the cooldown only changes how much wall-clock time a burst can be compressed into, not how many messages a level costs | user |
| D16 | Regex commands (`lu credits`, `lu credits @someone`, `lu leaderboard`), not slash commands | lu-bot has no interaction handling at all, and adding it for this would break the in-character feel | user |
| D17 | Plain text via `channel.send`, not embeds | Matches every other thing Lu says; an embed would read as a different speaker | user |
| D18 | Flat JSON (`data/credits.json`), not `node:sqlite` | Scale is a non-problem — one row per member, tens of members is a few kilobytes — so a database adds complexity with no benefit at this size | user |
| D19 | No role rewards at level thresholds, this stage | Needs Manage Roles, role-hierarchy handling, and a stack-versus-replace policy — real complexity for a server this size; straightforward to add later | user |
| D20 | Voice credits sequenced as phase 2, after text credits ship and have been lived with | It is a second subsystem (new intent, new listener, time-driven tests), not a variation on the first | user |
| D21 | Exact user-facing wording approved as rendered | The user was shown the real rendered output of every user-facing message plus the persona fragment before it shipped, and approved it as-is (lowercase deadpan register matching Lu's existing voice), with one change: an unnamed leaderboard entry renders as `<userId>` rather than a bare number, so it reads as a placeholder rather than a name | user |
