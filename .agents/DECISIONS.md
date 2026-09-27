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

## 2026-09-27 — Lu replaces Sapphire in Cry's Cantina

Spec: `docs/superpowers/specs/2026-09-27-sapphire-replacement-design.md`.

| # | Decision | Rationale | Approver |
|---|---|---|---|
| D22 | New features are configured by slash commands now, and by a web settings page on the owner's domain later (sub-project 6) | Discord permission gating and autocomplete; the page is a second front end on the same settings. D16 (regex commands) still stands for credits | user |
| D23 | New data in SQLite via built-in `node:sqlite` at `data/lu.db`; no new dependency | Cases need querying, safe numbering and a second reader (web page). Confirmed working on the mini's Node v26.8.1. D18 (JSON) still stands for credits, which are not migrated | user |
| D24 | Scope is a likely core set, not an audit of what Sapphire does in the server | Owner's choice (option 3); gaps surface at rollout when each Sapphire feature is switched off | user |
| D25 | Moderation: warn, timeout, kick, ban/unban, purge, case lookup/history/reason edit; manual Discord actions recorded as cases via audit log | Core set; auto-expiring bans and Sapphire's extras deferred (DF10) | user |
| D26 | Moderation replies ephemeral by default, with a setting for public; never in Lu's voice | A punishment notice must be exact, not in character. The default was Claude's call and was shown to the owner, who accepted the section | user |
| D27 | Logging: messages, members, moderation, member changes; deleted-message text kept in memory only, 24 h / 10,000 messages | Keeps the README's in-memory promise; server-structure logging deferred (DF11) | user |
| D28 | Cases store a 5-message snapshot on disk; README updated to say so | Owner saw and accepted the change to the privacy promise | user |
| D29 | Welcomes and leaves written in character by the LLM, plain voice (no mischief modes), 20 s fallback to fixed templates, >3 joins/60 s collapses to one fixed message, welcomes ahead of queued chat | Owner chose in-character; the safeguards were Claude's design, accepted by the owner | user |
| D30 | Role menus use buttons/dropdowns, not emoji reactions; pick-any and pick-one; roles carrying moderation powers can never be added | Survives restarts, confirms to the member, no reactions intent; Sapphire's reaction messages are replaced, not taken over | user |
| D31 | All features live in the existing lu-bot process, one directory each, each behind an `.env` switch that defaults to off; Sapphire stays in until each feature is checked live | One gateway connection and service; D5 means no test bot, so switches plus staged cut-over are the safety net | user |
| D32 | WP-1 plan deltas approved: `/lu-status` (Manage Server), migrations as numbered modules listed in `src/db/migrations/index.js`, message store only for `DISCORD_ALLOWED_GUILDS` and only while moderation or logging is on | Owner approved all three, 2026-09-27 | user |
| D33 | Anything tested live in the server is tested in the lu-testing-environment channel (`1538590653611515954`), not in public channels | Keeps testing from bothering the rest of Cry's Cantina | user |
