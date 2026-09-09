import { loadConfig } from './config.js';
import { createLlm } from './llm.js';
import { loadPersona } from './persona.js';
import { respond } from './responder.js';
import { loadCorpus, search } from './corpus/store.js';
import { shouldUseCorpus } from './judge.js';
import { startBot } from './discord.js';

const HISTORY_LIMIT = 12;

const config = loadConfig(process.env);
const llm = createLlm({ baseUrl: config.llm.baseUrl });
const persona = await loadPersona('persona/lu-bot.md');
const corpus = await loadCorpus('data/corpus');

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
