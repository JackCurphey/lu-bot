# Spec: Lu replaces Sapphire in Cry's Cantina

**Status:** approved
**Approved by:** owner, 2026-09-27 (sections approved in chat; written spec approved)

## Intent

Cry's Cantina (guild `1321631568976150588`) runs two bots: Lu, for
conversation and Imperial Credits, and Sapphire (sapph.xyz), for moderation,
logging, welcomes and self-assigned roles. The owner wants Lu to do the parts of
Sapphire the server uses, so that Sapphire can be removed.

Which Sapphire features the server actually uses was **not** checked. The owner
chose to start from a likely core set rather than audit Sapphire's dashboard
(option 3, 2026-09-27). That core set is this spec's scope. Anything the server
turns out to rely on beyond it is found out during rollout, when each Sapphire
feature is switched off; it is not assumed away here.

The inventory of Sapphire's features comes from docs.sapph.xyz, read
2026-09-27. Note that `saph.xyz` (one "p") is not Sapphire's site.

## Done-condition

Per sub-project, not for the whole project:

- The sub-project's tests pass: `npm test` (`node --test`).
- It is deployed to the mini, with its `.env` switch on in Cry's Cantina.
- The owner has exercised it in the server, and the matching Sapphire feature
  has been switched off *by the owner*.

The project as a whole stands when sub-projects 1–5 have each met that, and
Sapphire no longer has a job in the server. Removing Sapphire is the owner's
call, not a step in any plan.

## Approach

All of it goes in the existing lu-bot process. There is one Discord connection
and one service on the mini (`com.curphey.lu-bot`). Each feature lives in its
own directory under `src/`, and shares a new SQLite database and a slash-command
registry. A failure inside one feature's handler is caught and logged, the same
way `src/discord.js` handles a message today, so it cannot take chat down.

The work is split into six sub-projects. Each gets its own plan and review, and
ships behind its own `.env` switch:

1. Foundation: database, slash commands, new Discord events, settings, and the
   message store.
2. Moderation with case history.
3. Logging.
4. Welcomes, leaves and join roles.
5. Role menus.
6. The web settings page. It is **not designed here**; it gets its own design
   pass once 1–5 exist (see Out of scope).

Sapphire keeps running throughout. Each Lu feature is switched on and checked
before the matching Sapphire feature is switched off.

### Relationship to earlier decisions

- **D16** chose regex chat commands, not slash commands, for Imperial Credits.
  That decision stands for credits. The new features use slash commands (see
  D22), because moderation needs Discord's own permission gating and must not
  be triggered by ordinary chat.
- **D17** chose plain text, not embeds, for things Lu says. That decision stands
  for anything in Lu's voice, including in-character welcomes and leaves.
  Moderation replies, case cards and log entries are embeds. They are records,
  not Lu speaking.
- **D18** chose flat JSON for credits. That decision stands for credits:
  `data/credits.json` is not migrated. New data goes in SQLite (see D23),
  because cases need querying, safe numbering and a second reader (the web
  page).

## Components

### Sub-project 1: foundation

1. `src/db/index.js` opens `data/lu.db` with the built-in `node:sqlite`
   (`DatabaseSync`). This was confirmed working on the mini's Node v26.8.1 on
   2026-09-27. There is no new npm dependency. At startup the module applies
   numbered migrations from `src/db/migrations/` inside a transaction, and
   records the applied version.
2. `src/commands/registry.js`: each feature registers slash-command definitions
   and handlers. At startup Lu registers them as **guild** commands for each
   allowed guild, so they appear instantly. The same module routes
   `InteractionCreate` to the handlers.
   - Each command declares a `default_member_permissions`. Admins can adjust it
     in Server Settings → Integrations.
   - Handlers **re-check** the invoking member's permissions before acting, so a
     loosened integration setting cannot let a member ban anyone.
3. `src/settings.js` holds per-guild, per-feature settings in the database. It
   has typed getters and setters, and is the only way features read their
   configuration.
4. `src/message-store.js` keeps recently seen message content **in memory
   only**: author, channel, text, attachment names and timestamp. Entries
   expire after 24 hours, and the store holds at most the newest 10,000
   messages. A restart empties it. It feeds deleted and edited message logs
   (sub-project 3) and the case message snapshot (sub-project 2). It is
   separate from `src/history.js`, which serves conversation.
5. `src/discord.js` gains new intents and handlers:
   - `GuildMembers` (**privileged**: the Server Members switch must be enabled
     in the Discord Developer Portal) and `GuildModeration`.
   - Handlers for member add, member remove, member update, ban add and remove,
     message update, message delete, bulk message delete, and interactions.
   - The existing `shouldObserve` rule still governs which channels Lu **chats**
     in. The server-wide features act across the whole allowed guild.
6. `src/config.js` gains the switches `MODERATION_ENABLED`, `LOGGING_ENABLED`,
   `WELCOME_ENABLED` and `ROLE_MENUS_ENABLED`. They default to off, and each
   one gates registering its commands and handlers.

### Sub-project 2: moderation (`src/moderation/`)

Commands and their default permissions:

| Command | Default permission |
|---|---|
| `/warn @user reason` | Moderate Members |
| `/timeout @user duration reason` (Discord's timeout, max 28 days) | Moderate Members |
| `/untimeout @user reason` | Moderate Members |
| `/kick @user reason` | Kick Members |
| `/ban @user reason [delete messages 0–7 days]` (works on non-members) | Ban Members |
| `/unban user-id reason` | Ban Members |
| `/purge count [@user]` (≤100; messages older than 14 days skipped and counted) | Manage Messages |
| `/case number`, `/cases @user` | Moderate Members |
| `/reason number new-reason` (previous reason kept) | Moderate Members |

- **Case record.** A per-guild sequential number, the action, the target's ID
  and name at the time, the moderator, the reason, the duration, the time, the
  DM outcome, and a snapshot of the target's last 5 messages from the message
  store.
- **Manual actions become cases.** A ban, unban, kick or timeout done through
  Discord's own interface is matched to its audit-log entry and recorded as a
  case with the right moderator. A kick has no gateway event of its own; it is
  detected as a member-remove event with a matching audit-log entry.
- **Refusals.** Lu refuses to act on:
  - the moderator themself, Lu, or the server owner;
  - a target whose highest role is at or above the moderator's;
  - a target whose highest role is above Lu's.
- **Order of steps:** check → DM the target → act → record the case. If the
  action fails, no case is recorded and the moderator is told why. A DM that
  fails does not block the action; the case notes "not notified".
- **Replies.** Moderation replies and DMs are fixed text. They are never
  generated and never in Lu's voice. Confirmations are **ephemeral by default**
  and a case summary goes to the moderation log. A setting makes confirmations
  public instead.

### Sub-project 3: logging (`src/logging/`)

| Category | Events |
|---|---|
| Messages | Deletes (text, author, channel, attachment names), edits (before/after, jump link), bulk deletes (one entry plus a text-file attachment) |
| Members | Joins (account age; flagged under 7 days), leaves (roles held) |
| Moderation | Every case from sub-project 2 |
| Member changes | Nickname changes, role additions/removals, with the actor where the audit log gives it |

- **Commands.**
  - `/log channel <category> #channel` routes a category, and several categories
    may share one channel.
  - `/log off <category>` stops a category.
  - `/log ignore #channel|@role` and `/log unignore #channel|@role` manage the
    ignore list.
  - `/log status` shows which routes are working.
- **Ignored always:** log channels themselves, and messages sent by bots.
- **Deleted text.** If the text is not in the message store, the entry says
  "text not available".
- **Who deleted it.** "Deleted by X" appears only when an audit-log entry
  clearly matches. Discord does not audit self-deletes.
- **Broken routes.** If a log channel is deleted or Lu loses access to it, the
  error is logged once and that route is disabled. `/log status` shows it.

### Sub-project 4: welcomes, leaves, join roles (`src/welcome/`)

On a member join, in this order:

1. Apply the join roles. There is one list for humans and one for bots.
2. Generate an in-character welcome through the existing LLM path. The only
   inputs are the member's display name, the server name and the member count.
   It uses Lu's **plain voice**: the mischief modes (`src/mood.js`) are not
   applied to welcomes or leaves.
3. Post it with `allowedMentions` limited to the new member, so any other
   mention the model emits does not ping anyone.
4. Add the welcome to that channel's conversation history.

Safeguards:

- **Fallback.** If the model has not replied within **20 seconds**, a fixed
  template is posted. Templates support `{user}`, `{server}` and
  `{membercount}`, one is chosen at random, and a default ships built in.
- **Priority.** Welcome and leave jobs go ahead of queued chat replies.
- **Join waves.** If more than 3 members join within 60 seconds, individual
  generation stops and one fixed combined welcome is posted.

Other behaviour:

- **Leave messages.** Same path and fallback, with the name only and no ping.
- **Welcome DM.** Off by default. It is a fixed template and is never
  generated.
- **Commands.**
  - `/welcome channel|on|off|test`, where `test` runs the full path on the
    invoker in the configured channel.
  - `/welcome fallback add|list|remove` and `/welcome dm ...`.
  - `/leave channel|on|off`.
  - `/joinroles add|remove|list` for the humans and bots lists.

### Sub-project 5: role menus (`src/roles/`)

- **Menus.** A menu is a message Lu posts with a title, a description, and up
  to 25 roles shown as buttons or as a dropdown. There are two modes:
  **pick any** (each role toggles) and **pick one** (choosing a role removes
  the menu's others).
- **Commands.** `/rolemenu create|add|remove|list|delete`. Adding or removing a
  role edits the posted message in place.
- **Survives restarts.** A component's custom ID encodes the menu ID and role
  ID. Every click is resolved against the database, and nothing is held in
  memory.
- **Replies.** Each click gets an ephemeral reply saying what changed.
- **Refused when adding a role to a menu,** with no override:
  - `@everyone`;
  - roles managed by Discord (bot roles, the booster role);
  - roles above Lu's highest role;
  - roles carrying Administrator, Ban Members, Kick Members, Manage Roles,
    Manage Channels, Manage Server, Manage Messages or Moderate Members.
- **Migration.** The owner builds each replacement menu, checks it, and then
  deletes Sapphire's reaction message. Roles members already hold are left
  alone.

## Rejected alternatives

- **Web settings page as the only configuration surface.** Rejected. Slash
  commands come first, and the page comes later as a second front end on the
  same settings (owner, 2026-09-27).
- **Chat commands parsed from messages** (`lu warn @x`). Rejected: anyone can
  type them, there is no Discord permission gating, and there is a
  misfire risk.
- **JSON files or a hosted database.** JSON is fragile for querying and
  numbering cases. A hosted database adds cost, a network dependency and a
  credential.
- **A second bot account, or two processes sharing Lu's token.** A second
  account means two bots in the server, which defeats the goal. Two processes
  on one token would both receive every event.
- **Moderation extras:** auto-expiring bans, mass ban, name bans, channel lock,
  reports, preset reasons, immune roles. Deferred; they are not in the
  core set.
- **Server-structure logging:** channels, roles, emoji, invites, voice, server
  settings. Deferred as noisy; it roughly doubles sub-project 3.
- **Fixed-template-only welcomes, or welcome images.** The owner chose
  in-character welcomes. Images need a new drawing dependency.
- **Emoji reaction roles, or taking over Sapphire's existing reaction
  messages.** Rejected: there is no confirmation to the member, events are
  missed while Lu is offline, and it needs the reactions intent.

## Security and privacy

- **New stored personal data.** Moderation cases, **including a 5-message
  snapshot of the target's messages**, are kept on disk in `data/lu.db`. This
  changes a promise in `README.md`, which says the credit balance is the only
  thing about a member kept on disk. The README is updated in sub-project 2 to
  say so plainly. The owner saw and accepted this change on 2026-09-27.
- **Message store.** It stays in memory only, so the README's "history lives
  in memory only" remains true for everything except case snapshots.
- **New powers.** Lu gains Ban, Kick, Moderate Members, Manage Messages, Manage
  Roles and View Audit Log in Cry's Cantina. That raises the stakes on the bot
  token (see DF2 for its history) and on the handler permission re-checks. The
  re-checks are the main defence against a mis-set integration permission.
- **Model output in welcomes** is posted into a public channel. Mentions are
  restricted by `allowedMentions`, so model output can never ping `@everyone`
  or a role.
- **Role menus** cannot grant any role that carries moderation or admin
  permissions.
- **The web page (sub-project 6)** is the largest new exposure: a public
  endpoint on the owner's domain, with login. It is out of scope here and
  needs its own threat review.

## Risks / tradeoffs

- **There is no separate test bot (D5).** Slash commands and moderation are
  first exercised live in Cry's Cantina. Mitigations:
  - every feature ships switched off;
  - `/welcome test` exists;
  - Sapphire stays in place until each feature is checked.
- **Welcomes compete with chat for one slow model** (about 11 tokens/s on the
  mini, as measured in the Bonsai benchmark). Mitigations: the 20-second
  fallback, the join-wave cap, and welcome priority. The cost is that chat
  replies can arrive later while someone joins.
- **The 24-hour message store is lost on restart.** Deletes of older messages
  log without their text.
- **Role hierarchy.** Lu's role must sit above every role it assigns or
  moderates. The owner must arrange this in Server Settings; Lu reports the
  problem, it cannot fix it.
- **Discord limits in this spec are from memory**, not rechecked for this spec.
  They are checked against Discord's documentation in the sub-project plans:
  - timeout maximum 28 days;
  - bulk delete ≤100 messages, none older than 14 days;
  - ban message deletion up to 7 days;
  - 25 components or options per message;
  - kicks have no gateway event.
- **The STATUS file is over its size cap.** `.agents/STATUS.md` is 32,587
  bytes against an 8,000-byte cap. That is not caused by this project, but it
  makes every session on it more expensive to resume.

## Out of scope

- **The web settings page's design:** hosting on the owner's domain, login
  (likely Discord OAuth), and how the mini is reached from the internet. It is
  its own design pass after sub-projects 1–5.
- **Importing Sapphire's case history.** Whether Sapphire offers an export was
  not checked. Lu's case numbers start at 1, and past cases stay visible in
  Sapphire while it remains in the server.
- **Other Sapphire modules:**
  - AI automod and advanced automod;
  - join guard and appeals;
  - custom commands, message templates, sticky and scheduled messages;
  - social notifications;
  - role connections;
  - welcome images.
- **Migrating Imperial Credits** to SQLite or to slash commands.
- **Removing Sapphire from the server.** That is the owner's action.
- **The thread in guild `781966929198841886`.** Lu chats there, but gets none
  of the server-wide features. That guild is not added to
  `DISCORD_ALLOWED_GUILDS`.

## Open questions

1. **(Blocks sub-project 4's join-role step.)** Cry's Cantina **does** use
   membership screening. On 2026-09-27 the guild's feature list included
   `MEMBER_VERIFICATION_GATE_ENABLED`, read via the Discord API with Lu's
   token. It also has Onboarding with prompts (`GUILD_ONBOARDING`,
   `GUILD_ONBOARDING_HAS_PROMPTS`), which can assign roles itself. Still to
   settle in the WP-4 plan:
   - whether a bot can assign roles to a member who is still `pending`; if not,
     wait for the `pending` flag to clear;
   - whether a welcome should wait for screening too;
   - which roles Onboarding already assigns, so join roles and role menus do
     not duplicate them.
2. **(Blocks deploying sub-project 1.)** The owner must enable the Server
   Members intent in the Developer Portal, and grant Lu's role the permissions
   and position listed above.
3. **(Non-blocking.)** Does Sapphire offer a case export? If yes, an import can
   be a follow-up task.
