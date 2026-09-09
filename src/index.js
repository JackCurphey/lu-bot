import { join } from 'node:path';

import { loadConfig, startupWarnings } from './config.js';
import { createLlm } from './llm.js';
import { loadPersona } from './persona.js';
import { respond } from './responder.js';
import { loadCorpus, search } from './corpus/store.js';
import { shouldUseCorpus } from './judge.js';
import { startBot } from './discord.js';

const HISTORY_LIMIT = 12;

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

const histories = new Map();

async function retrieve(content) {
  if (corpus.size === 0) return [];
  const [vector] = await llm.embed({ model: config.llm.embedModel, input: [content] });
  return search(corpus, vector, 5)
    .filter((hit) => hit.score >= config.trigger.similarityFloor)
    .map((hit) => hit.chunk);
}

await startBot({
  config,
  async onMention({ content, channelId }) {
    const history = histories.get(channelId) ?? [];

    // Retrieval finds candidates; the judge decides whether they earn a place
    // in the prompt. Without this gate a mention always passes passages to the
    // chat model, and a model handed passages tends to quote them.
    const candidates = await retrieve(content);
    const useCorpus = await shouldUseCorpus({ message: content, chunks: candidates, llm, config });
    const chunks = useCorpus ? candidates : [];

    const reply = await respond({ message: content, chunks, history, persona, llm, config });

    if (reply) {
      histories.set(
        channelId,
        [...history, { role: 'user', content }, { role: 'assistant', content: reply }]
          .slice(-HISTORY_LIMIT),
      );
    }
    return reply;
  },
});

console.log('Lu Bot is online.');
