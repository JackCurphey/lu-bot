# Mac mini Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Lu Bot permanently on an Intel Mac mini, serving inference locally through Ollama, so the bot is online whether or not a laptop is open.

**Architecture:** The bot code is unchanged in substance — `src/llm.js` already speaks the OpenAI-compatible protocol that Ollama serves, so the swap from LM Studio/MLX to Ollama/GGUF is configuration. Two small code changes ship alongside: error text that no longer names LM Studio, and a Discord typing indicator to cover the 13-15 second reply time. Both the model server and the bot run as user-level launchd agents that restart on crash and on boot.

**Tech Stack:** Node v26.8.1 (official darwin-x64 tarball), discord.js 14, Ollama 0.34 (`qwen3:4b-instruct`, `nomic-embed-text`), launchd, macOS 15.7.9 on Macmini8,1.

**Spec:** `docs/superpowers/specs/2026-09-10-mini-deployment-design.md`

## Global Constraints

- **Target host:** Mac mini A1993 / Macmini8,1, Intel i3-8100B, 4 cores, 16GB RAM, macOS 15.7.9. Reachable as `ssh mini` (`jackcurphey@<mini-ip>`, key `~/.ssh/<key>`).
- **Node version:** exactly **v26.8.1**, `darwin-x64`. SHA-256 `fe9c6dbf9c8e1b4443803d75e2a20366e420dae650c747dbb116b22975751baf`.
- **Models:** `qwen3:4b-instruct` for BOTH `LLM_CHAT_MODEL` and `LLM_JUDGE_MODEL`; `nomic-embed-text` for `LLM_EMBED_MODEL`. Never two different chat/judge models — one resident copy is a memory requirement, not a preference.
- **Ollama binds 127.0.0.1 only.** The model server is never exposed to the LAN.
- **`OLLAMA_KEEP_ALIVE=-1`** so the model never unloads.
- **No `sudo` from the agent.** Anything needing a password is handed to the user as a command to run. This includes all `pmset` and FileVault work.
- **Secrets:** `.env` is never committed, never printed in full, never pasted into a commit message. It is `chmod 600` on the mini.
- **Test command:** `npm test` (`node --test`). Baseline is **159 passing, 0 failing**.
- **Branch:** all work on `feat/mini-deployment`, branched from `spec/mini-deployment`. Never commit to a default branch.
- **Every new test must be watched failing before it passes**, and the mutation that makes it fail must be confirmed to have landed.

---

### Task 1: Pin the Ollama response contract and drop the LM Studio name

**Files:**
- Modify: `src/llm.js:11` (error message)
- Modify: `test/llm.test.js` (add contract tests)
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createLlm({ baseUrl, fetchImpl })` unchanged in signature — `chat({ model, messages, temperature })` returns `string`, `embed({ model, input })` returns `number[][]`. Later tasks rely on these being correct against Ollama.

The response shapes below were captured from the running Ollama 0.34 server on the mini on 2026-09-10. They are real, not illustrative.

- [ ] **Step 1: Write the failing tests**

Add to `test/llm.test.js`:

```javascript
// --- Ollama contract ---
//
// Captured from Ollama 0.34 on the deployment host, 2026-09-10. These pin the
// wire format the client depends on: an Ollama upgrade that changes it should
// fail here, loudly, rather than at 2am in a Discord channel.

test('chat parses a real Ollama chat.completion response', async () => {
  const { fetchImpl } = stubFetch({
    id: 'chatcmpl-293',
    object: 'chat.completion',
    created: 1789077699,
    model: 'qwen3:4b-instruct',
    system_fingerprint: 'fp_ollama',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'OK! 😊 How' },
      finish_reason: 'length',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });

  assert.equal(
    await llm.chat({ model: 'qwen3:4b-instruct', messages: [{ role: 'user', content: 'say ok' }] }),
    'OK! 😊 How',
  );
});

test('embed parses a real Ollama embeddings response', async () => {
  const { fetchImpl } = stubFetch({
    object: 'list',
    data: [
      { object: 'embedding', embedding: [0.005299894, -0.0020928506] },
      { object: 'embedding', embedding: [-0.14002158, -0.030111587] },
    ],
    model: 'nomic-embed-text',
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });

  assert.deepEqual(
    await llm.embed({ model: 'nomic-embed-text', input: ['a', 'b'] }),
    [[0.005299894, -0.0020928506], [-0.14002158, -0.030111587]],
  );
});

test('a failure names the endpoint, not a particular vendor', async () => {
  const { fetchImpl } = stubFetch({ error: { message: 'boom' } }, { status: 400 });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });

  await assert.rejects(
    () => llm.chat({ model: 'm', messages: [] }),
    (err) => {
      assert.ok(!/LM Studio/i.test(err.message), `vendor name leaked: ${err.message}`);
      assert.ok(err.message.includes('400'));
      assert.ok(err.message.includes('/chat/completions'));
      return true;
    },
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -20`

Expected: the two contract tests PASS already (the client is correct — that is the point of pinning them), and the vendor-name test FAILS with `vendor name leaked: LM Studio request to /chat/completions failed with status 400`.

If a contract test fails instead, STOP: the assumption in the spec was wrong and `src/llm.js` needs a real change. Report it rather than editing the test to match.

- [ ] **Step 3: Make the error text provider-neutral**

In `src/llm.js`, replace:

```javascript
      throw new Error(`LM Studio request to ${path} failed with status ${res.status}`);
```

with:

```javascript
      throw new Error(`Model server request to ${path} failed with status ${res.status}`);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 162`, `fail 0`.

- [ ] **Step 5: Confirm the vendor test can actually fail**

Temporarily put `LM Studio` back into the message, run `npm test`, confirm the vendor-name test fails, then restore. A test that cannot fail is not a test.

Run: `npm test 2>&1 | grep -c "vendor name leaked"`
Expected while mutated: `1`. After restoring: `0` and `pass 162`.

- [ ] **Step 6: Point `.env.example` at Ollama**

Replace the LLM block in `.env.example` with:

```
# Ollama, bound to loopback on the host running the bot.
LLM_BASE_URL=http://127.0.0.1:11434/v1
# One model serves both roles so only one copy occupies RAM.
LLM_CHAT_MODEL=qwen3:4b-instruct
LLM_JUDGE_MODEL=qwen3:4b-instruct
LLM_EMBED_MODEL=nomic-embed-text
```

- [ ] **Step 7: Commit**

```bash
git add src/llm.js test/llm.test.js .env.example
git commit -m "feat: pin the Ollama response contract and drop the LM Studio name"
```

---

### Task 2: Typing indicator

**Files:**
- Modify: `src/discord.js`
- Modify: `test/discord.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `startTyping({ channel, intervalMs, setIntervalImpl, clearIntervalImpl })` returning `{ stop() }`. Exported from `src/discord.js`.

Discord's typing indicator expires after roughly 10 seconds. Replies take 13-15 seconds, and ~25 on the first message after a restart, so a single `sendTyping()` is not enough — it must be refreshed until the reply lands. Equally it must stop when the handler returns nothing, because `respond()` returns `null` on a dropped fabrication or an over-length reply, and Lu appearing to type forever is worse than silence.

The refresh interval is 8 seconds: comfortably inside the ~10s expiry, without hammering the API.

- [ ] **Step 1: Write the failing tests**

Add to `test/discord.test.js`:

```javascript
import { startTyping, TYPING_REFRESH_MS } from '../src/discord.js';

// --- Typing indicator ---
//
// A reply takes 13-15s on the deployment host, and ~25s on the first message
// after a restart. Discord's indicator expires after ~10s, so it is refreshed
// on a timer rather than sent once.

function stubChannel() {
  const calls = [];
  return { calls, sendTyping: async () => { calls.push(Date.now()); } };
}

function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setIntervalImpl: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearIntervalImpl: (id) => { timers.delete(id); },
    tick: () => { for (const { fn } of timers.values()) fn(); },
    active: () => timers.size,
  };
}

test('typing is sent immediately, before any timer fires', async () => {
  const channel = stubChannel();
  const t = fakeTimers();
  startTyping({ channel, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl });
  await new Promise((r) => setImmediate(r));

  assert.equal(channel.calls.length, 1);
});

test('typing refreshes on each interval so it outlives Discord expiry', async () => {
  const channel = stubChannel();
  const t = fakeTimers();
  startTyping({ channel, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl });
  await new Promise((r) => setImmediate(r));
  t.tick();
  t.tick();
  await new Promise((r) => setImmediate(r));

  assert.equal(channel.calls.length, 3);
});

test('the refresh interval is inside Discord ten-second expiry', () => {
  assert.ok(TYPING_REFRESH_MS < 10000, `${TYPING_REFRESH_MS} would let the indicator lapse`);
});

test('stop clears the timer so Lu does not type forever', async () => {
  const channel = stubChannel();
  const t = fakeTimers();
  const handle = startTyping({ channel, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl });
  handle.stop();

  assert.equal(t.active(), 0);
});

test('a failing sendTyping does not reject into the caller', async () => {
  const channel = { sendTyping: async () => { throw new Error('discord down'); } };
  const t = fakeTimers();

  // A cosmetic indicator must never be able to take down a reply.
  const handle = startTyping({ channel, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl });
  await new Promise((r) => setImmediate(r));
  handle.stop();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `SyntaxError: The requested module '../src/discord.js' does not provide an export named 'startTyping'`.

- [ ] **Step 3: Implement `startTyping`**

Add to `src/discord.js`:

```javascript
// Discord's typing indicator expires after roughly ten seconds. A reply on the
// deployment host takes 13-15s, and ~25s on the first message after a restart,
// so one sendTyping() would lapse before the reply lands and the channel would
// show nothing — indistinguishable from Lu ignoring the message.
export const TYPING_REFRESH_MS = 8000;

export function startTyping({
  channel,
  intervalMs = TYPING_REFRESH_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  // Cosmetic. A failure here must never propagate into the reply path, so
  // every call swallows its own rejection.
  const send = () => { Promise.resolve(channel.sendTyping()).catch(() => {}); };

  send();
  const id = setIntervalImpl(send, intervalMs);
  // Node holds the event loop open for a pending interval. Nothing here should
  // keep the process alive on its own.
  if (typeof id?.unref === 'function') id.unref();

  return { stop: () => clearIntervalImpl(id) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 167`, `fail 0`.

- [ ] **Step 5: Confirm the refresh test can fail**

Change `TYPING_REFRESH_MS` to `12000`, run `npm test`, confirm *the expiry test* fails with `12000 would let the indicator lapse`. Restore to `8000` and confirm green again. Verify the edit actually landed before trusting the result — a no-op edit makes a broken test look sound.

- [ ] **Step 6: Wire it into the mention handler**

In `src/discord.js`, in the `Events.MessageCreate` handler, replace:

```javascript
    const content = message.content.replace(/<@!?\d+>/g, '').trim();
    try {
      const reply = await onMention({ content, channelId: message.channelId, authorId: message.author.id });
      if (reply) await message.reply(truncateForDiscord(reply));
    } catch (err) {
      console.error('Failed to handle mention:', err);
    }
```

with:

```javascript
    const content = message.content.replace(/<@!?\d+>/g, '').trim();
    const typing = startTyping({ channel: message.channel });
    try {
      const reply = await onMention({ content, channelId: message.channelId, authorId: message.author.id });
      if (reply) await message.reply(truncateForDiscord(reply));
    } catch (err) {
      console.error('Failed to handle mention:', err);
    } finally {
      // finally, not the try body: a dropped reply and a thrown error must
      // both stop the indicator.
      typing.stop();
    }
```

- [ ] **Step 7: Run the full suite**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 167`, `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/discord.js test/discord.test.js
git commit -m "feat: show a typing indicator while Lu composes a reply"
```

---

### Task 3: Node and Ollama on the mini

**Files:**
- Create (on mini): `~/Library/LaunchAgents/com.curphey.ollama.plist`
- No repo files.

**Interfaces:**
- Consumes: nothing.
- Produces: `~/node/bin/node` at v26.8.1; Ollama answering on `http://127.0.0.1:11434` as a launchd-managed service with the model pinned resident.

Ollama is already installed at `~/ollama` and currently runs from a manual `nohup` started during benchmarking. That process must be replaced by the managed service, not left racing it.

- [ ] **Step 1: Install Node v26.8.1 and verify its checksum**

```bash
ssh mini 'set -e
cd ~
curl -fL -o node.tar.gz https://nodejs.org/dist/v26.8.1/node-v26.8.1-darwin-x64.tar.gz
echo "fe9c6dbf9c8e1b4443803d75e2a20366e420dae650c747dbb116b22975751baf  node.tar.gz" | shasum -a 256 -c -
tar xzf node.tar.gz
rm -rf ~/node && mv node-v26.8.1-darwin-x64 ~/node && rm node.tar.gz
~/node/bin/node --version'
```

Expected: `node.tar.gz: OK` then `v26.8.1`. If the checksum line does not say `OK`, STOP and report — do not proceed with an unverified binary.

- [ ] **Step 2: Put Node on the interactive PATH**

```bash
ssh mini 'grep -q "HOME/node/bin" ~/.zshrc 2>/dev/null || echo "export PATH=\"\$HOME/node/bin:\$PATH\"" >> ~/.zshrc; tail -2 ~/.zshrc'
```

- [ ] **Step 3: Stop the manual Ollama process**

```bash
ssh mini 'pkill -f "ollama serve" || true; sleep 2; curl -fsS --max-time 3 http://127.0.0.1:11434/api/version && echo "STILL UP" || echo "stopped"'
```

Expected: `stopped`.

- [ ] **Step 4: Write the launchd agent**

```bash
ssh mini 'mkdir -p ~/Library/LaunchAgents ~/Library/Logs/lu-bot && cat > ~/Library/LaunchAgents/com.curphey.ollama.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.curphey.ollama</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/jackcurphey/ollama/ollama</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OLLAMA_HOST</key><string>127.0.0.1:11434</string>
    <key>OLLAMA_KEEP_ALIVE</key><string>-1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/jackcurphey/Library/Logs/lu-bot/ollama.log</string>
  <key>StandardErrorPath</key><string>/Users/jackcurphey/Library/Logs/lu-bot/ollama.err.log</string>
</dict>
</plist>
PLIST
plutil -lint ~/Library/LaunchAgents/com.curphey.ollama.plist'
```

Expected: `OK`.

- [ ] **Step 5: Load it and confirm the service answers**

```bash
ssh mini 'launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.curphey.ollama.plist 2>/dev/null || launchctl kickstart -k gui/$(id -u)/com.curphey.ollama
sleep 5
launchctl print gui/$(id -u)/com.curphey.ollama | grep -E "state|pid" | head -3
curl -fsS http://127.0.0.1:11434/api/version'
```

Expected: `state = running` and `{"version":"0.34.0"}`.

- [ ] **Step 6: Confirm it is NOT reachable from the LAN**

From the MacBook:

```bash
curl -fsS --max-time 5 http://<mini-ip>:11434/api/version && echo "EXPOSED - FIX THIS" || echo "correctly loopback-only"
```

Expected: `correctly loopback-only`. If it says `EXPOSED`, stop and fix `OLLAMA_HOST` before going further.

- [ ] **Step 7: Pin the model resident and remove the benchmark models**

```bash
ssh mini 'set -e
~/ollama/ollama rm llama3.2:3b gemma3:4b qwen3:8b
~/ollama/ollama run qwen3:4b-instruct "ok" > /dev/null
~/ollama/ollama ps
~/ollama/ollama list
df -h / | tail -1'
```

Expected: `ollama ps` lists `qwen3:4b-instruct` with `Forever` as its expiry (that is `OLLAMA_KEEP_ALIVE=-1` taking effect); `list` shows only `qwen3:4b-instruct` and `nomic-embed-text`; ~10GB reclaimed.

---

### Task 4: Private GitHub repo, and the code onto the mini

**Files:**
- No repo file changes. Creates a remote and a clone.

**Interfaces:**
- Consumes: the commits from Tasks 1 and 2.
- Produces: `~/lu-bot` on the mini, on branch `feat/mini-deployment`, with a populated `.env`.

There is **no `main` branch** in this repository — only `feat/foundation`, `spec/initial-design`, `spec/mini-deployment` and this task's `feat/mini-deployment`. Creating the remote is the moment to establish a default branch.

**This task creates a GitHub repository, which is an outward-facing action. Confirm with the user before running Step 2, and confirm the repository is private.**

- [ ] **Step 1: Confirm the working tree is clean and tests pass**

```bash
git status --short && npm test 2>&1 | tail -5
```

Expected: no output from `status`; `pass 167`, `fail 0`.

- [ ] **Step 2: Create the private repo and push (after user confirmation)**

```bash
gh repo create lu-bot --private --source=. --remote=origin --push
git push -u origin feat/mini-deployment
gh repo view --json name,visibility,defaultBranchRef
```

Expected: `"visibility": "PRIVATE"`. If it reports `PUBLIC`, stop immediately — the persona and channel configuration are not intended to be public.

- [ ] **Step 3: Verify `.env` was not pushed**

```bash
git ls-files | grep -E "^\.env$" && echo "SECRET COMMITTED - STOP" || echo "clean: .env is not tracked"
gh api repos/:owner/lu-bot/contents/.env --silent 2>&1 | grep -q "Not Found" && echo "confirmed absent on remote"
```

Expected: `clean: .env is not tracked` and `confirmed absent on remote`.

- [ ] **Step 4: Clone onto the mini**

The mini authenticates to GitHub over HTTPS with a token, or the repo is copied over SSH from the MacBook. Prefer whichever the user already has working; if neither, push over SSH directly:

```bash
ssh mini 'git init --bare ~/lu-bot.git'
git remote add mini ssh://mini/~/lu-bot.git
git push mini feat/mini-deployment
ssh mini 'git clone ~/lu-bot.git ~/lu-bot && cd ~/lu-bot && git checkout feat/mini-deployment && git log --oneline -3'
```

Expected: the three most recent commits, matching the MacBook.

- [ ] **Step 5: Install dependencies on the mini**

```bash
ssh mini 'cd ~/lu-bot && ~/node/bin/npm ci 2>&1 | tail -3 && ls node_modules/discord.js/package.json'
```

- [ ] **Step 6: Place `.env` on the mini**

Copy the existing `.env`, changing only the four LLM values to the Ollama settings from `.env.example`. Do not print the token to the terminal.

```bash
ssh mini 'chmod 600 ~/lu-bot/.env && ls -l ~/lu-bot/.env && grep -c DISCORD_BOT_TOKEN ~/lu-bot/.env'
```

Expected: `-rw-------` and `1`.

- [ ] **Step 7: Run the full test suite ON THE MINI**

```bash
ssh mini 'cd ~/lu-bot && ~/node/bin/npm test 2>&1 | tail -8'
```

Expected: `pass 167`, `fail 0`. This is the first proof the code runs on Intel at all.

---

### Task 5: Run Lu Bot as a service

**Files:**
- Create (on mini): `~/Library/LaunchAgents/com.curphey.lu-bot.plist`

**Interfaces:**
- Consumes: `~/lu-bot` from Task 4, Ollama service from Task 3.
- Produces: a running bot that answers mentions.

`src/index.js` already resolves the persona and corpus paths against the module rather than the process working directory, explicitly because launchd does not run with the repo as cwd. No code change is needed for this.

- [ ] **Step 1: Confirm it runs in the foreground first**

Do not debug a service. Confirm the process works before wrapping it.

```bash
ssh mini 'cd ~/lu-bot && timeout 25 ~/node/bin/node --env-file-if-exists=.env src/index.js 2>&1 | head -20'
```

Expected: `No corpus found. Running persona-only.` and `Lu Bot is online.` If `DISCORD_ALLOWED_CHANNELS` is empty you will also see the startup warning that the bot will respond to nothing — fix `.env` before continuing.

- [ ] **Step 2: Write the launchd agent**

```bash
ssh mini 'cat > ~/Library/LaunchAgents/com.curphey.lu-bot.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.curphey.lu-bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/jackcurphey/node/bin/node</string>
    <string>--env-file-if-exists=.env</string>
    <string>src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/jackcurphey/lu-bot</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/Users/jackcurphey/Library/Logs/lu-bot/bot.log</string>
  <key>StandardErrorPath</key><string>/Users/jackcurphey/Library/Logs/lu-bot/bot.err.log</string>
</dict>
</plist>
PLIST
plutil -lint ~/Library/LaunchAgents/com.curphey.lu-bot.plist'
```

Expected: `OK`.

`ThrottleInterval` of 10 stops a crash-looping bot from reconnecting to Discord in a tight loop, which risks rate limiting.

- [ ] **Step 3: Load it**

```bash
ssh mini 'launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.curphey.lu-bot.plist 2>/dev/null || launchctl kickstart -k gui/$(id -u)/com.curphey.lu-bot
sleep 8
launchctl print gui/$(id -u)/com.curphey.lu-bot | grep -E "state =|pid ="
tail -5 ~/Library/Logs/lu-bot/bot.log'
```

Expected: `state = running`, a pid, and `Lu Bot is online.`

- [ ] **Step 4: The live check — done-condition 4**

Ask the user to mention Lu in the allowlisted channel and report what they see and roughly how long it took.

```bash
ssh mini 'tail -20 ~/Library/Logs/lu-bot/bot.log'
```

Expected: a reply in the channel within ~20 seconds, a typing indicator visible for the whole wait, and no warnings in the log about dropped replies.

Note: a mention with **no other text** is the known open bug and will fail with a 400. Ask for a mention with actual text. Do not fix that bug here; it is out of scope.

---

### Task 6: Fault injection

**Files:** none.

**Interfaces:**
- Consumes: both services from Tasks 3 and 5.
- Produces: evidence that the services actually recover.

A service that has never been killed is not a service that restarts. Each step below must be run and its output recorded — not assumed.

- [ ] **Step 1: Kill the bot, confirm it returns — done-condition 5**

```bash
ssh mini 'PID=$(launchctl print gui/$(id -u)/com.curphey.lu-bot | awk "/pid =/{print \$3}")
echo "killing $PID"; kill -9 $PID; sleep 20
launchctl print gui/$(id -u)/com.curphey.lu-bot | grep -E "state =|pid ="
tail -3 ~/Library/Logs/lu-bot/bot.log'
```

Expected: `state = running`, a **different** pid, and a fresh `Lu Bot is online.` in the log.

- [ ] **Step 2: Stop Ollama while the bot runs — done-condition 7**

```bash
ssh mini 'launchctl kill SIGSTOP gui/$(id -u)/com.curphey.ollama 2>/dev/null || pkill -STOP -f "ollama serve"
sleep 2
launchctl print gui/$(id -u)/com.curphey.lu-bot | grep -E "state =|pid ="'
```

Ask the user to mention Lu while Ollama is stopped, then:

```bash
ssh mini 'tail -10 ~/Library/Logs/lu-bot/bot.err.log ~/Library/Logs/lu-bot/bot.log
pkill -CONT -f "ollama serve"'
```

Expected: the bot is STILL RUNNING with the same pid, and the log shows a handled failure naming `/chat/completions` — not a crash, and not the words "LM Studio". The typing indicator must have stopped rather than run forever.

- [ ] **Step 3: Reboot — done-condition 6**

This needs the user's password.

```bash
ssh mini 'sudo shutdown -r now'
```

Wait, then from the MacBook:

```bash
until ssh -o ConnectTimeout=5 mini 'true' 2>/dev/null; do sleep 10; done
ssh mini 'uptime
launchctl print gui/$(id -u)/com.curphey.ollama | grep "state ="
launchctl print gui/$(id -u)/com.curphey.lu-bot | grep "state ="
tail -3 ~/Library/Logs/lu-bot/bot.log'
```

Expected: uptime of a few minutes, both services `running`, `Lu Bot is online.` — with nobody having touched the machine.

**If FileVault is enabled this step will fail** — the mini will not come back on the network at all until someone types the password at the physical machine. That is itself the finding, and it goes to the user as a decision (see Task 7).

---

### Task 7: Host configuration and handover

**Files:**
- Modify: `.agents/STATUS.md`

**Interfaces:**
- Consumes: the verified deployment.
- Produces: a machine that survives a power cut, and a status file a fresh session can resume from.

- [ ] **Step 1: Report FileVault status to the user**

```bash
ssh mini 'fdesetup status'
```

If it reports `FileVault is On`, present the consequence and the choice — do not decide it: every power cut leaves Lu offline until someone physically unlocks the mini. Turning FileVault off restores unattended boot at the cost of at-rest encryption on a machine sitting in a room.

- [ ] **Step 2: Hand the user the power settings command**

This needs their password; it is theirs to run.

```bash
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 womp 1 autorestart 1 powernap 0
```

Then verify:

```bash
ssh mini 'pmset -g | grep -E " sleep|womp|autorestart|powernap"'
```

Expected: `sleep 0`, `womp 1`, `autorestart 1`, `powernap 0`.

- [ ] **Step 3: Note the DHCP risk**

The mini is at `<mini-ip>` by DHCP lease. The bot itself is unaffected — it talks to Ollama on loopback — but `ssh mini` breaks silently if the lease changes. Recommend a DHCP reservation on the router, or note `Jacks-Mac-mini.local` as the fallback. This is a recommendation to the user, not an action.

- [ ] **Step 4: Rewrite `.agents/STATUS.md`**

It currently describes a bot running on the MacBook against LM Studio and MLX models, which will be false. It must record: the mini deployment, the model change, the two launchd services and how to restart them, the log locations, the still-open mention-only bug, and the next project (ingest fixes, then chiming). Keep the existing "bug to fix first" section — that bug is still open.

- [ ] **Step 5: Commit and push**

```bash
git add .agents/STATUS.md
git commit -m "docs: record the Mac mini deployment as the live state"
git push origin feat/mini-deployment
```

- [ ] **Step 6: Report the done-condition results**

State plainly, with the command output for each: tests on the mini, live reply time, bot restart, Ollama outage, reboot. Any item not actually run is reported as not run — not as passing.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1. Inference layer (loopback, KEEP_ALIVE) | Task 3, steps 4-7 |
| 2. Node runtime (v26.8.1, checksummed) | Task 3, steps 1-2 |
| 3. Code delivery (private GitHub, no `main`) | Task 4 |
| 4. Configuration | Task 1 step 6, Task 4 step 6 |
| 5. Code changes (error text, typing) | Tasks 1 and 2 |
| 6. Service (launchd) | Task 5 |
| 7. Host config (pmset, FileVault) | Task 7 |
| Done-conditions 1-7 | Task 4 step 7; Task 1 steps 4-5 and Task 2 steps 4-5; Task 5 step 4; Task 6 steps 1-3 |
| Out of scope (mention bug, chiming, ingest) | Not implemented; Task 5 step 4 explicitly avoids the mention bug |

**Type consistency:** `startTyping` is named identically in Task 2 steps 1, 3 and 6, and returns `{ stop() }` in all three. `TYPING_REFRESH_MS` is used consistently. `createLlm` signatures are unchanged from the existing code.

**Placeholders:** none. Every command is runnable and every test is complete code. The one deliberately open decision — HTTPS token versus SSH push in Task 4 step 4 — offers both concrete commands rather than deferring.
