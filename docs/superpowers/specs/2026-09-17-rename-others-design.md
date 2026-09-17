# Lu renames other people

**Asked for (2026-09-17):** "I would like lu to be able to change other
peoples names too, if prompted."

## Decisions taken with the user

1. **Who may ask:** only members with Discord's Manage Nicknames permission —
   the same rule as renaming Lu (`NICKNAME_REQUIRE_PERMISSION`). Nobody can use
   Lu to get round the server's own permissions.
2. **Who is meant:** an @mention, or a typed name. A typed name must match
   exactly one member; none or several and Lu refuses and asks for an @mention.
3. **The new name:** used exactly when given; when not given ("give @sam a new
   name"), Lu invents one in character.

## Phrasings recognised (`src/rename.js`, `parseMemberRename`)

- `rename T to N`, `rename T as N`, `rename T`
- `change|set T's name|nick|nickname [to N]`
- `change|set T's name back`, `reset T's name` — back to their own name
- `give T a [new] name|nick|nickname`

`T` is an @mention, `my` (the asker), or one typed word. Multi-word display
names need an @mention. `your`/`yourself`/pronouns are left alone — renaming Lu
himself stays on the existing `NICKNAME_REQUEST_RE` path. `@Lu` or `lu` as the
target renames Lu.

## Flow (`src/conversation.js`)

1. Guard: in a server, asker has Manage Nicknames — the existing
   `nicknameRefusal`, same lines.
2. Resolve a typed name against recent speakers in the channel's history plus
   Discord's member search (`io.findMembers`, exact case-insensitive match on
   display name, nickname, username or global name). A search failure is
   logged and history alone is used.
3. Name given (or reset): validate with `validateNickname`, rename **before**
   the reply via `io.renameMember`, and tell the model the outcome so he reacts
   to what actually happened. Failure becomes an in-character status line.
4. No name given: instruct the model to emit the existing `NICKNAME: <name>`
   marker, meaning the name for that person; apply it to the target after.
5. Every outcome goes to the decision log for `lu explain`.

## Discord limits (`src/discord.js`, `createChannelIo`)

Lu's role needs Manage Nicknames and must sit above the target's highest role;
nobody can rename the server owner. `renameMember` checks `member.manageable`
first and reports `outranked`; any other rejection is `refused`.

## Done when

- Unit tests cover parsing, resolution, guards, both name paths and the
  adapter; each watched failing first; full suite green on MacBook and mini.
- On the live server: a rename by @mention and by typed name both work, and a
  member without Manage Nicknames is refused.
