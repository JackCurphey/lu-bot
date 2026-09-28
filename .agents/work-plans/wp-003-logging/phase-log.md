# WP-3 Logging — phase log

Plan: `docs/superpowers/plans/2026-09-27-wp3-logging.md`
Spec: sub-project 3. Decisions D27, D35, D36.

Baseline on feat/wp3-logging (2026-09-27): npm test → 632 pass, 0 fail.

| Date | Task | Test result | Mutation check | Commit |
|---|---|---|---|---|
| 2026-09-27 | 1 Adapter groundwork | 640 pass | sub-command unwrap deleted; "a sub-command becomes view.subcommand" red `undefined` vs 'messages'; restored | 4eb7f77 |
| 2026-09-27 | 2 Logging settings | 647 pass | markBroken keeps route; "broken route is switched off" red `'c1' !== null`; restored | 9aece26 |
| 2026-09-27 | 3 Message formats | 654 pass | `text === undefined`; "text is not available" red on regex; restored | 39538e4 |
| 2026-09-27 | 4 Router | 660 pass | log-channel check removed; "…a log channel… are skipped" red `'sent' !== 'ignored'`; restored | 3495bb0 |
| 2026-09-27 | 5 Message handlers | 669 pass | forget→get; "a delete… forgets it" red (record not null); restored | 9d4e0cf |
| 2026-09-27 | 6 /log command | 675 pass | setRoute above try; "does not save a channel Lu cannot post in" red `'c9' !== null`; restored | 9149738 |
| 2026-09-27 | 7 Wiring + docs | 675 pass | no new tests (wiring); `node --check src/index.js` ok | 9e96953 |
| 2026-09-27 | Final review fixes F1, F2, F4, F5, F6 | 687 pass | F1 missing-permission result ignored: red on /Attach Files/; F2 editedTimestamp guard removed: red `1 !== 0`; restored | 618b6d4..d46b9fa |

Final review of PR A (fresh context, most capable model): ready after fixes. Fixed: /log channel now checks View Channel, Send Messages, Embed Links and Attach Files before saving; unedited updates to messages Lu no longer holds are not logged; bulk deletes honour ignored roles; system messages skipped; README known gap for uncached bot messages. Scoped re-review: all addressed, no new breakage.
Left by ruling: /log channel is not deferred (3-second deadline risk); ignore-role check duplicated in router.post and isIgnoredAuthor (both correct).
Not yet done: PR A opened, merged, deployed, LOGGING_ENABLED switched on, live check. PR B (Tasks 8–10).
| 2026-09-28 | 8 Member formats | 687→ (branch) | WEEK/7: "under 7 days is flagged" red (field missing); restored | 68b379e |
| 2026-09-28 | 9 Member handlers | 701 pass | partial-before guard removed: "uncached before logs nothing" red `2 !== 0`; restored | 4c6dfdf |
| 2026-09-28 | 10 Wiring + docs | 701 pass | no new tests (wiring) | 830ee29 |
| 2026-09-28 | PR B final fixes I1, M3 | 704 pass | I1 stop-after-first-failure: red on deep-equal; restored | e4eda03, 05154c9 |

PR B final review (fresh context, most capable model): ready to merge. Fixed: warm member caches at startup when Server Members is requested (first change after a restart was dropped); /log status footer mentions member changes. Re-review: both addressed.
