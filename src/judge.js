const SYSTEM = [
  'You decide whether quoting a source passage would genuinely improve a reply.',
  'Answer ONLY with JSON: {"useCorpus": true|false, "reason": "<a few words>"}.',
  'Answer true only when the passage directly bears on what was said.',
  'Answer false for greetings, small talk, jokes, and anything the passage only',
  'loosely resembles. When in doubt, answer false — an unnecessary quotation is',
  'worse than none.',
].join(' ');

export function buildJudgeMessages({ message, chunks }) {
  const passages = chunks
    .map((c, i) => `[${i + 1}] ${c.text}`)
    .join('\n\n');

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Message:\n${message}\n\nCandidate passages:\n${passages}` },
  ];
}

function parseVerdict(raw) {
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) return false;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed.useCorpus === true;
  } catch {
    return false;
  }
}

export async function shouldUseCorpus({ message, chunks, llm, config }) {
  if (!chunks || chunks.length === 0) return false;

  try {
    const raw = await llm.chat({
      model: config.llm.judgeModel,
      messages: buildJudgeMessages({ message, chunks }),
      temperature: 0,
    });
    return parseVerdict(raw);
  } catch (err) {
    console.warn(`Judge unavailable, replying without the corpus: ${err.message}`);
    return false;
  }
}
