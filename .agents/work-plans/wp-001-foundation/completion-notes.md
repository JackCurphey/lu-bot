# Completion notes — wp-001 foundation

- **Closed:** 2026-09-27. All four live checks passed. Check 1 (registration log line) and check 2 (`data/lu.db`, schema v1) were confirmed on the mini. Check 3 (`/lu-status` shows v1.3) and check 4 (chat still answers) were confirmed by the owner in lu-testing-environment.
- **Delivered:** https://github.com/JackCurphey/lu-bot/pull/1 (WP-1, deployed as v1.2) and https://github.com/JackCurphey/lu-bot/pull/2 (`/lu-status` opened to everyone, deployed as v1.3).
- **Deviations from plan:**
  - `/lu-status` is open to everyone (D34, superseding the Manage Server part of D32). The owner's account lacks Manage Server, so Discord hid the command.
  - The final review added partials (`partialsFor`) and a single ordered MessageUpdate handler (F1, F2). Without them, WP-2's kick detection and WP-3's delete and edit logs would not work.
- **Leftovers carried to WP-2:**
  - typed per-feature settings wrappers;
  - a way to see missing permissions;
  - View Audit Log is not granted, so manual-action cases must degrade cleanly;
  - Lu's role sits below the rank roles, which the owner must fix before moderation is switched on.
- **Lessons:** Discord hides a slash command from anyone without its `default_member_permissions`. Typing the name then sends plain chat, and nothing errors. Test commands with the account that will actually use them. This belongs on the project shelf, not a wider one.
