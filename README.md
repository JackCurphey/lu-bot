# Lu

Lu is a Discord bot with a personality. He plays a Chinese revolutionary Maoist, talks in lowercase with barely any punctuation, occasionally drops into simplified Chinese, and keeps a ledger of how much everyone talks.

He does not run on ChatGPT or any other cloud service. He runs on a language model on a Mac mini in a house, which is why he takes about fifteen seconds to answer and why he is sometimes offline.

---

## For people in the server

### Getting him to reply

He always answers if you:

- **@mention him**
- **reply to one of his messages**
- **say "lu" or "ai bot"** anywhere in your message

Beyond that he tries to judge it. If he has spoken recently — within the last 8 messages and 5 minutes — he reads your message and decides for himself whether it was aimed at him. He gets this wrong sometimes in both directions.

If he has not spoken recently, there is a 2% chance he chimes in unprompted, and after doing so he will not chime in again for three minutes.

He never replies to other bots.

### Why didn't he answer?

Ask him:

```
lu explain
```

He will tell you what he decided about the most recent message and why — "i was @mentioned", "it @mentions someone else", "random chime-in did not fire", or the actual error if something broke. `lu explain 3` explains the third-from-last instead.

This is genuinely useful when he ignores you and you cannot tell whether he is being rude or is broken.

### "uh oh... i have a headache"

That means something went wrong while he was answering you — the model failed, the reply took too long, or he tried to use a quotation he could not verify. It is a real error, not a personality quirk. `lu explain` will tell you which.

### Imperial Credits

Talking earns credits. Credits become a level.

| | |
|---|---|
| Per message | 15–25 credits, at random |
| Cooldown | one paying message every 30 seconds |
| Minimum | messages under 3 characters earn nothing |
| Bots | earn nothing |

The level curve is the same one MEE6 uses, so a level here means roughly what it means in other servers you have been in. Levels get expensive quickly: level 1 costs 100 credits, level 5 costs 1,150 in total, level 10 costs 4,675, and level 25 costs 42,000.

Commands:

```
lu credits
lu credits @someone
lu leaderboard
```

Asking for your balance earns you nothing — that is deliberate.

When you cross a level, Lu says so in the channel. It is the only thing he ever says without being spoken to first.

He also knows your balance and will bring it up unprompted to mock or praise you. He **cannot** change anyone's credits and cannot award or remove them, no matter how you ask him. The scoring is done in code; he only gets told the number.

### Making him change his name

Ask him, in plain English:

- "change your name to X"
- "call yourself X"
- "rename yourself X"
- "go back to your normal name" to undo it

By default only people with Discord's **Manage Nicknames** permission can do this. Going back to his normal name reveals his account name, `Lü Xiaojun` — everything else is a nickname.

### Things worth knowing

**He reads every message in the channels he watches.** He has to, in order to follow a conversation rather than only answering direct mentions. That history lives in memory only and is thrown away when he restarts. Your credit balance is the only thing about you kept on disk.

**Do not trust his quotations.** He is built to quote from a library of political texts, and the checks for that work — but no texts are currently loaded. With nothing to quote from he will sometimes invent a quotation and attribute it to Mao. It will sound plausible and be entirely made up. This is a known gap, not a mystery.

**He is slow.** About fifteen seconds a reply. He shows a typing indicator so you can tell the difference between thinking and ignoring you.

**He is in one server's channels only**, and does not do voice or direct messages.

---

## For people reading the code

### What it is

A Node.js Discord bot, ESM throughout, with `discord.js` as its only runtime dependency. Everything else is the Node standard library. It needs **Node 26 or newer**.

The language model is reached over an OpenAI-compatible HTTP API, which in practice means [Ollama](https://ollama.com) running `qwen3:4b-instruct` locally. Nothing is sent to a third party.

### Running it

```bash
npm install
cp .env.example .env    # then fill in the token and channel or server IDs
npm start
```

```bash
npm test
```

451 tests, no framework — `node:test` and `node:assert/strict`.

### How it fits together

| Module | Job |
|---|---|
| `src/discord.js` | The only file that knows discord.js exists. Flattens a Discord message into a plain object and hands it on. |
| `src/conversation.js` | The orchestrator. Commands, credits, history, and the reply queue. |
| `src/attention.js` | Decides whether a message deserves an answer, without calling a model. |
| `src/addressee.js` | The "was that aimed at me?" judge, for the ambiguous cases. |
| `src/responder.js` | Builds the prompt and enforces the reply rules. |
| `src/quotes.js` | Rejects a reply whose quotation cannot be found in the supplied passages. |
| `src/credits/` | The activity ledger: curve, store, earning rule, commands. |
| `src/corpus/` | Chunking, embedding and searching the text library. |

Two conventions the code sticks to, and worth knowing before changing anything:

**Time and randomness are always injected**, never reached for. Nothing in the test suite sleeps.

**discord.js objects are never mocked.** The adapter boundary is narrow enough that tests build the plain objects it produces by hand.

### Configuration

Everything is environment variables, documented with defaults in [.env.example](.env.example). `loadConfig` is a pure function over an env object and validates ranges at startup, so a bad setting fails immediately with the offending value rather than misbehaving later.

Which channels he watches is either a list of channel IDs (`DISCORD_ALLOWED_CHANNELS`) or every channel in a list of servers (`DISCORD_ALLOWED_GUILDS`), with `DISCORD_DENIED_CHANNELS` to carve exceptions out of the latter.

### Where the thinking is written down

- [docs/superpowers/specs/](docs/superpowers/specs/) — design documents, one per piece of work, including a verification walk for each
- [docs/superpowers/plans/](docs/superpowers/plans/) — the implementation plans those specs turned into
- [.agents/](.agents/) — live project state, an append-only decision log, and a register of things deliberately deferred

The specs record what was decided and why, including the parts that went wrong. The Imperial Credits verification document is the most complete example: it lists the defects found in the plan itself, a regression that only a whole-branch review could have caught, and what was never verified.

### Known gaps

- **No corpus is loaded.** Ingestion works but no texts have been added, so the quoting feature is inert and Lu will invent quotations. Fixing this is the next substantial piece of work.
- **Credits have no per-server dimension.** Balances are keyed on user ID alone, so watching a second server would pool everyone's credits into one leaderboard.
- **Voice credits are not built.** The storage schema has a field waiting for them.
- **Single instance.** There is no clustering and no shared state; two copies would both answer.

---

## Licence

None yet.
