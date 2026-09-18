import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { loadConfig, startupWarnings } from './config.js';
import { createLlm } from './llm.js';
import { loadPersona } from './persona.js';
import { respondWithReason } from './responder.js';
import { loadCorpus, search } from './corpus/store.js';
import { shouldUseCorpus } from './judge.js';
import { startBot } from './discord.js';
import { createHistory } from './history.js';
import { createDecisionLog } from './decisions.js';
import { isAddressedToLu, hasModel } from './addressee.js';
import { createConversation } from './conversation.js';
import { createCreditStore } from './credits/store.js';
import { announceUpdate } from './announce.js';
import { formatEntry, appendSuggestion } from './suggestions.js';

// A rejected promise with no handler is fatal in Node. The bot is meant to sit
// in a channel for weeks; one unhandled rejection in a background path should
// not end that silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const config = loadConfig(process.env);

for (const warning of startupWarnings(config)) {
  console.warn(`WARNING: ${warning}`);
}

const llm = createLlm({ baseUrl: config.llm.baseUrl });
// Resolved against this module, not the process working directory: under
// launchd, systemd or pm2 — how this is actually run — cwd is not the repo
// root and a relative path here is an ENOENT crash at startup.
const projectRoot = join(import.meta.dirname, '..');
const persona = await loadPersona(join(projectRoot, 'persona', 'lu-bot.md'));
const corpus = await loadCorpus(join(projectRoot, 'data', 'corpus'));

console.log(
  corpus.size > 0
    ? `Loaded ${corpus.size} chunks (${corpus.dim} dimensions).`
    : 'No corpus found. Running persona-only.',
);

// Resolved against this module for the same reason the corpus is: under
// launchd the working directory is not the repo root, and a relative path
// here is an ENOENT crash at startup.
const creditStore = config.credits.enabled
  ? await createCreditStore({ dir: join(projectRoot, 'data'), flushMs: config.credits.flushMs })
  : null;

if (creditStore) {
  console.log(`Credit ledger loaded: ${creditStore.all().length} members.`);
}

// A missing judge model would otherwise surface as a 404 on every judge call.
// Treat it as "never aimed at me" and say so once, at startup; direct address
// keeps working.
let addresseeAvailable = true;
try {
  addresseeAvailable = hasModel(await llm.listModels(), config.llm.addresseeModel);
  if (!addresseeAvailable) {
    console.warn(
      `WARNING: judge model ${config.llm.addresseeModel} is not installed on the model server; ` +
      'Lu will only answer @mentions, replies to him and his name.',
    );
  }
} catch (err) {
  console.warn(`WARNING: could not list installed models (${err.message}); assuming ${config.llm.addresseeModel} is there.`);
}

async function retrieve(content) {
  if (corpus.size === 0) return [];
  const [vector] = await llm.embed({ model: config.llm.embedModel, input: [content] });
  return search(corpus, vector, 5)
    .filter((hit) => hit.score >= config.trigger.similarityFloor)
    .map((hit) => hit.chunk);
}

const conversation = createConversation({
  config,
  history: createHistory(config.history),
  decisions: createDecisionLog(),
  persona,
  llm,
  // Retrieval finds candidates; the corpus judge decides whether they earn a
  // place in the prompt. A model handed passages tends to quote them.
  async chooseChunks(text) {
    const candidates = await retrieve(text);
    return (await shouldUseCorpus({ message: text, chunks: candidates, llm, config })) ? candidates : [];
  },
  respondWithReason,
  isAddressed: ({ entries }) => isAddressedToLu({ entries, llm, config, available: addresseeAvailable }),
  credits: creditStore,
  // Resolved against the project root for the same reason the corpus and the
  // credit ledger are: under launchd the working directory is not the repo.
  recordSuggestion: config.suggestions.enabled
    ? async ({ entry, text }) => {
      await appendSuggestion({
        path: join(projectRoot, config.suggestions.file),
        entry: formatEntry({
          text,
          authorId: entry.authorId,
          authorName: entry.name,
          guildId: entry.guildId ?? null,
          channelId: entry.channelId,
          messageId: entry.messageId,
        }),
      });
    }
    : null,
});

const client = await startBot({
  config,
  onMessage: (entry, io) => conversation.handleMessage(entry, io),
});

console.log('Lu Bot is online.');

// A failure here is logged, never fatal: Lu being up matters more than the
// notice that he is.
if (config.discord.updateChannelId) {
  const lastFile = join(projectRoot, 'data', 'announced-version.txt');
  try {
    const channel = await client.channels.fetch(config.discord.updateChannelId);
    const out = await announceUpdate({
      changelog: await readFile(join(projectRoot, 'CHANGELOG.md'), 'utf8'),
      readLast: () => readFile(lastFile, 'utf8').then((v) => v.trim(), () => null),
      writeLast: (version) => writeFile(lastFile, `${version}\n`),
      send: (content) => channel.send({ content, allowedMentions: { parse: [] } }),
    });
    console.log(out.announced ? `Announced v${out.version}.` : `Update announcement skipped: ${out.reason}`);
  } catch (err) {
    console.warn(`Update announcement failed: ${err.message}`);
  }
}

// launchd stops the service with SIGTERM. Without this, every restart loses up
// to CREDITS_FLUSH_MS of awards -- small, but silent, and it would look like
// the ledger was randomly forgetting things.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    try {
      await creditStore?.close();
    } catch (err) {
      // close() now rejects when the final flush did not succeed (F3 in the
      // final review): every award since the last successful write would
      // otherwise be lost with nothing but this log line to show for it, and
      // exit 0 would tell launchd it was a clean stop. Exit non-zero so the
      // log distinguishes "stopped" from "stopped and lost the ledger".
      console.error('Failed to flush the credit ledger on shutdown:', err);
      process.exit(1);
    }
    process.exit(0);
  });
}
