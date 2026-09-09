const SYSTEM = [
  'You decide whether quoting a source passage would genuinely improve a reply.',
  'Answer ONLY with JSON: {"useCorpus": true|false, "reason": "<a few words>"}.',
  'Answer true only when the passage directly bears on what was said.',
  'Answer false for greetings, small talk, jokes, and anything the passage only',
  'loosely resembles. When in doubt, answer false — an unnecessary quotation is',
  'worse than none.',
].join(' ');

export function buildJudgeMessages({ message, chunks }) {
  // Attribution is part of what makes a passage worth quoting: a line from a
  // named work bears differently on a message than an unattributed fragment.
  // This used to pass c.text alone, asking the judge to weigh relevance with
  // the source removed.
  const passages = chunks
    .map((c, i) => {
      const { title, author } = c.source ?? {};
      const attribution = title
        ? ` From "${title}"${author ? ` by ${author}` : ''}:`
        : '';
      return `[${i + 1}]${attribution}\n${c.text}`;
    })
    .join('\n\n');

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Message:\n${message}\n\nCandidate passages:\n${passages}` },
  ];
}

function stripCodeFences(text) {
  return text.replace(/```json/gi, '').replace(/```/g, '');
}

// Walk the string tracking brace depth and collect every substring that
// opens at depth 0 with `{` and closes back to depth 0 with `}`. This is a
// deliberate top-level-object scan, not a "grab everything between the
// first and last brace" heuristic — so multiple objects, or an object
// sitting alongside unrelated brace-prose, are surfaced as distinct
// candidates rather than silently merged into one greedy span.
function extractTopLevelObjects(text) {
  const candidates = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return candidates;
}

function parseVerdict(raw) {
  const cleaned = stripCodeFences(String(raw)).trim();
  const candidates = extractTopLevelObjects(cleaned);
  if (candidates.length !== 1) return false;
  try {
    const parsed = JSON.parse(candidates[0]);
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
