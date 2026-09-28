# Spec: telling Lu to be quiet

**Status:** approved
**Approved by:** owner, 2026-09-28. The design was approved in chat: anyone can use it (option 1).

## Intent

The owner asked for "a feature where somebody can just tell Lu to stop". Right
now the only way to silence Lu in a channel is to restart him or change his
`.env`.

## Done-condition

- In a channel, someone says a stop aimed at Lu, for example "lu stop",
  "@Lu shut up", or "be quiet" as a reply to him. He posts one fixed
  acknowledgement.
- He then posts nothing in that channel for `QUIET_MINUTES` (default 5). That
  includes answers to @mentions, replies to him, level-up lines, and command
  answers.
- "lu you can talk" (or similar) ends the quiet time early, with a fixed line.
- Other channels are unaffected.
- `npm test` passes, with new tests watched failing first.

## Approach

- **`src/quiet.js`** holds the fixed lines and the parser, which classifies a
  message as `'stop'`, `'resume'` or `null`.
- **The quiet time is state on the channel.** The channel state in
  `src/conversation.js` gets a `quietUntil` timestamp. `safeSend` refuses to
  post while it is in the future, so replies already queued or being written
  go nowhere. `run` returns before the model is asked, so there is no typing
  indicator and no model time spent.
- **Commands.** A stop command is handled at the top of `handleMessage`,
  before any other command:
  1. set `quietUntil`;
  2. drop the channel's pending job and pause;
  3. post the acknowledgement, which is the one send allowed through.

  A resume while quiet clears `quietUntil` and posts its line. A resume when he
  is not quiet falls through to normal handling.
- **While quiet**, a message is still recorded in history, so he can follow
  the conversation when he is back, and it still earns credits. Nothing else
  happens.
- **A stop must be aimed at Lu.** Either the text starts with "lu", "@Lu" or
  another configured keyword, or it is an @mention of Lu or a reply to him. The
  whole message must be the command, give or take "please" and punctuation.
  "don't stop believing" does nothing.
- **Nothing is kept.** The quiet time is in memory only, so a restart clears
  it.

## Wording (the owner is shown this before deploy)

- **Stop:** `fine. i'll be quiet for 5 minutes.` The number comes from
  `QUIET_MINUTES`.
- **Resume:** `i'm back.`

## Out of scope

- A permission limit on who can silence him. Anyone can (owner, option 1).
- Server-wide quiet.
- Quiet that survives a restart.

## Risks

- **Someone keeps him quiet on purpose.** Accepted. A permission limit can be
  added later.
- **A stop phrase is missed or misread.** The parser only accepts a whole
  message that is the command, so the failure mode is "didn't stop", never
  "stopped by accident".
