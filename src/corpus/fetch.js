import { lookup as dnsLookup } from 'node:dns/promises';
import { LearnError } from './errors.js';

// The first five bytes of every PDF. Checked because Content-Type is a claim
// made by whoever is serving the file, and this is not.
const MAGIC = '%PDF-';

const v4 = (a) => a.split('.').map(Number);

// Ranges a fetch driven by a Discord message must never reach. Lu runs on the
// same host as Ollama, so without this "lu learn http://127.0.0.1:11434/..."
// points him at his own model server; 100.64/10 is here because the mini is on
// Tailscale (DECISIONS D11) and that range is the tailnet.
export function isPrivateAddress(address) {
  const addr = String(address).toLowerCase();
  // An IPv4-mapped IPv6 address is an IPv4 address wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  const plain = mapped ? mapped[1] : addr;

  if (/^\d+\.\d+\.\d+\.\d+$/.test(plain)) {
    const [a, b] = v4(plain);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (plain === '::' || plain === '::1') return true;
  if (/^fe[89ab]/.test(plain)) return true;          // fe80::/10, link-local
  if (/^f[cd]/.test(plain)) return true;             // fc00::/7, unique-local
  return false;
}

async function assertPublic(hostname, lookupImpl) {
  let records;
  try {
    records = await lookupImpl(hostname, { all: true });
  } catch {
    throw new LearnError('privateAddress', `could not resolve ${hostname}`);
  }
  // Every resolved address must be public: one private answer among several is
  // enough for the connection to land somewhere it should not.
  if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
    throw new LearnError('privateAddress', `${hostname} resolves to a private address`);
  }
}

async function readCapped(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new LearnError('notAPdf', 'no body');
  const parts = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Enforced on what actually arrives. Content-Length is a claim.
    if (total > maxBytes) {
      await reader.cancel();
      throw new LearnError('tooBig', `body exceeded ${maxBytes} bytes`);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

export async function fetchPdf(url, {
  maxBytes,
  timeoutMs,
  maxRedirects = 5,
  fetchImpl = fetch,
  lookupImpl = dnsLookup,
}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      throw new LearnError('badUrl', `not a url: ${current}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new LearnError('badScheme', `refusing ${parsed.protocol}`);
    }
    await assertPublic(parsed.hostname, lookupImpl);

    let res;
    try {
      // Manual, so the address check above runs on every hop. Automatic
      // redirect following would let a public URL hand off to a private one
      // with no second check.
      res = await fetchImpl(current, { redirect: 'manual', signal });
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw new LearnError('timedOut', `gave up after ${timeoutMs}ms`);
      }
      throw new LearnError('httpError', err?.message ?? 'fetch failed');
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (!res.ok) throw new LearnError('httpError', `status ${res.status}`);

    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/pdf' && type !== 'application/octet-stream' && type !== '') {
      throw new LearnError('notAPdf', `content-type was ${type}`);
    }

    const bytes = await readCapped(res, maxBytes);
    const head = Buffer.from(bytes.subarray(0, MAGIC.length)).toString('latin1');
    if (head !== MAGIC) throw new LearnError('notAPdf', 'no %PDF- header');

    return { bytes, finalUrl: current };
  }

  throw new LearnError('tooManyRedirects', `more than ${maxRedirects} redirects`);
}
