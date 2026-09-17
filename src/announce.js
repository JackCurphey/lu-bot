// Tells the testing channel when Lu has been updated. CHANGELOG.md is the one
// place a version lives: its top "## vX.Y" entry is the running version and
// the bullets under it are what gets posted. The last version announced is
// remembered on disk, so a restart for an .env tweak posts nothing.
import { truncateForDiscord } from './discord.js';

const HEADING_RE = /^## v(\d+\.\d+)\b.*$/m;

export function parseChangelog(text) {
  const s = String(text ?? '');
  const heading = HEADING_RE.exec(s);
  if (!heading) return null;
  const rest = s.slice(heading.index + heading[0].length);
  const next = rest.search(/^## /m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const notes = body.split('\n')
    .filter((line) => /^\s*- /.test(line))
    .map((line) => line.replace(/^\s*- /, '').trim());
  return { version: heading[1], notes };
}

export function formatAnnouncement({ version, notes }) {
  return [`lu v${version} is live`, '', 'what changed:', ...notes.map((n) => `- ${n}`)].join('\n');
}

// The version is only remembered once the post has gone through, so a start
// that could not reach the channel tries again next time instead of skipping
// that version for good.
export async function announceUpdate({ changelog, readLast, writeLast, send }) {
  const parsed = parseChangelog(changelog);
  if (!parsed) return { announced: false, reason: 'no version found in CHANGELOG.md' };
  if ((await readLast()) === parsed.version) {
    return { announced: false, reason: `v${parsed.version} was already announced` };
  }
  try {
    await send(truncateForDiscord(formatAnnouncement(parsed)));
  } catch (err) {
    return { announced: false, reason: `could not post v${parsed.version}: ${err.message}` };
  }
  await writeLast(parsed.version);
  return { announced: true, version: parsed.version };
}
