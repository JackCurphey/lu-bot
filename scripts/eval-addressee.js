// Scores the "is this aimed at Lu?" judge against a real model, using the
// made-up conversations in scripts/addressee-examples.json. Reads the same
// settings Lu does: LLM_BASE_URL, LLM_ADDRESSEE_MODEL / LLM_JUDGE_MODEL and
// LLM_DISABLE_THINKING.
//   node --env-file-if-exists=.env scripts/eval-addressee.js [tune|holdout|all]
// Exits non-zero when any example is judged wrong.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadLlmConfig } from '../src/config.js';
import { createLlm } from '../src/llm.js';
import { buildAddresseeMessages, parseAddresseeAnswer } from '../src/addressee.js';

const which = process.argv[2] ?? 'all';
const examples = JSON.parse(readFileSync(path.join(import.meta.dirname, 'addressee-examples.json'), 'utf8'));
const sets = which === 'all' ? ['tune', 'holdout'] : [which];

const cfg = loadLlmConfig(process.env);
const llm = createLlm({ baseUrl: cfg.baseUrl, disableThinking: cfg.disableThinking });

let wrong = 0;
for (const set of sets) {
  let right = 0;
  for (const ex of examples[set]) {
    const entries = ex.chat.map(([name, text]) => ({ name, text, isLu: name === 'Lu' }));
    const raw = await llm.chat({
      model: cfg.addresseeModel, messages: buildAddresseeMessages({ entries }), temperature: 0, maxTokens: 3,
    });
    const got = parseAddresseeAnswer(raw).yes ? 'yes' : 'no';
    if (got === ex.want) right += 1;
    else console.log(`WRONG (${set}) want ${ex.want}, got ${JSON.stringify(raw)}: ${ex.chat.at(-1).join(': ')}`);
  }
  wrong += examples[set].length - right;
  console.log(`${set}: ${right}/${examples[set].length} right`);
}
process.exitCode = wrong === 0 ? 0 : 1;
