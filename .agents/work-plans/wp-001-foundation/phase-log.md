# WP-1 Foundation — phase log

Plan: `docs/superpowers/plans/2026-09-27-wp1-foundation.md`
Spec: `docs/superpowers/specs/2026-09-27-sapphire-replacement-design.md` (sub-project 1)

Baseline before any change (2026-09-27): `npm test` → 564 pass, 0 fail.

| Date | Task | Test result | Mutation check (what, confirmed landed, went red for the right reason, restored) | Commit |
|---|---|---|---|---|
| 2026-09-27 | 1 Switches + intents | 575 pass | `f.welcome` dropped from GuildMembers condition; diff shown; "Server Members" test red on welcome; restored | 0b8b321 |
| 2026-09-27 | 2 Database | 580 pass | ruling: `m.up(db)` moved above BEGIN; "rolled back as a whole" red (table b persisted); restored | 1e43f53 |
| 2026-09-27 | 3 Settings | 587 pass | first attempt crashed on bind arity (wrong reason); redone as `(feature = ? OR 1)`: isolation assertion red `'a' !== null`; restored | 9946bbd |
| 2026-09-27 | 4 Message store | 595 pass | expiry `ttlMs * 10`; both expiry tests red; restored | a811872 |
| 2026-09-27 | 6 Guild events | 601 pass | guild scoping removed; "other guilds dropped" red; restored | efd1abc |
| 2026-09-27 | 5 Command registry | 613 pass | re-check forced false; "permission is re-checked" red `true !== false`; restored | 239f26a |
| 2026-09-27 | 7 Discord adapters | 621 pass | ephemeral default false; "private by default" red `undefined !== 64`; restored | 6de76a2 |
| 2026-09-27 | 8 Wiring + docs | 621 pass | no new tests (wiring); `node --check src/index.js` ok | 85c1544 |
| 2026-09-27 | Final review fixes F1–F5 | 631 pass | F1 partialsFor forced []: red; F2 store-before-emit: red `'new' !== 'old'`; restored | 0ff833d, a0e09fb |

Final whole-branch review (fresh context, most capable model): ready to merge; F1 (no partials) and F2 (edit text overwritten before handlers) fixed in the same wave, scoped re-review: all 5 addressed, no new breakage.
Not yet done: deploy + the four live checks (Task 8 Step 8) — awaiting owner approval.
