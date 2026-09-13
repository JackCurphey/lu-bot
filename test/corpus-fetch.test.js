import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPdf, isPrivateAddress } from '../src/corpus/fetch.js';
import { LearnError } from '../src/corpus/errors.js';

const PDF = new Uint8Array([...Buffer.from('%PDF-1.4\nhello')]);

// A lookup that claims every hostname resolves to one public address, so the
// address guard is out of the way of tests aimed at the other guards.
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function respond(body, { status = 200, type = 'application/pdf', headers = {} } = {}) {
  return new Response(body, { status, headers: { 'content-type': type, ...headers } });
}

const opts = (fetchImpl, extra = {}) => ({
  maxBytes: 1000,
  timeoutMs: 1000,
  fetchImpl,
  lookupImpl: publicLookup,
  ...extra,
});

async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    assert.ok(err instanceof LearnError, `expected a LearnError, got ${err}`);
    return err.code;
  }
}

test('isPrivateAddress recognises the ranges a fetch must never reach', () => {
  for (const addr of [
    '127.0.0.1', '10.0.0.5', '172.16.4.1', '172.31.255.254', '192.168.1.1',
    '169.254.1.1', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fc00::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isPrivateAddress(addr), true, `${addr} should be private`);
  }
  for (const addr of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220::1']) {
    assert.equal(isPrivateAddress(addr), false, `${addr} should be public`);
  }
});

test('a PDF over http(s) comes back as bytes', async () => {
  const got = await fetchPdf('https://example.com/a.pdf', opts(async () => respond(PDF)));
  assert.deepEqual(got.bytes, PDF);
  assert.equal(got.finalUrl, 'https://example.com/a.pdf');
});

test('non-http schemes are refused', async () => {
  const boom = () => { throw new Error('fetch must not be called'); };
  assert.equal(await codeOf(fetchPdf('file:///etc/passwd', opts(boom))), 'badScheme');
  assert.equal(await codeOf(fetchPdf('data:application/pdf,x', opts(boom))), 'badScheme');
});

test('a hostname resolving to a private address is refused before any fetch', async () => {
  const boom = () => { throw new Error('fetch must not be called'); };
  const code = await codeOf(fetchPdf('http://localhost:11434/x.pdf', opts(boom, {
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
  })));
  assert.equal(code, 'privateAddress');
});

test('a redirect into a private address is refused', async () => {
  const fetchImpl = async (url) => (url.includes('start')
    ? respond(null, { status: 302, headers: { location: 'http://internal.example/x.pdf' } })
    : respond(PDF));
  const lookupImpl = async (host) => (host === 'internal.example'
    ? [{ address: '10.1.2.3', family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }]);
  assert.equal(
    await codeOf(fetchPdf('https://start.example/a.pdf', opts(fetchImpl, { lookupImpl }))),
    'privateAddress',
  );
});

test('redirects are followed, up to the hop limit', async () => {
  let hop = 0;
  const fetchImpl = async () => {
    hop += 1;
    return hop <= 2
      ? respond(null, { status: 302, headers: { location: `https://example.com/${hop}.pdf` } })
      : respond(PDF);
  };
  const got = await fetchPdf('https://example.com/a.pdf', opts(fetchImpl));
  assert.equal(got.finalUrl, 'https://example.com/2.pdf');

  const loop = async () => respond(null, { status: 302, headers: { location: 'https://example.com/next.pdf' } });
  assert.equal(
    await codeOf(fetchPdf('https://example.com/a.pdf', opts(loop, { maxRedirects: 3 }))),
    'tooManyRedirects',
  );
});

test('an oversized body is refused even when Content-Length lies', async () => {
  const big = new Uint8Array(5000);
  big.set([...Buffer.from('%PDF-')], 0);
  const fetchImpl = async () => respond(big, { headers: { 'content-length': '10' } });
  assert.equal(await codeOf(fetchPdf('https://example.com/a.pdf', opts(fetchImpl))), 'tooBig');
});

test('the wrong content type, and the right type with the wrong bytes, are both refused', async () => {
  const html = async () => respond('<html></html>', { type: 'text/html' });
  assert.equal(await codeOf(fetchPdf('https://example.com/a.pdf', opts(html))), 'notAPdf');

  const liar = async () => respond('not a pdf at all', { type: 'application/pdf' });
  assert.equal(await codeOf(fetchPdf('https://example.com/a.pdf', opts(liar))), 'notAPdf');
});

test('an error status is refused', async () => {
  const fetchImpl = async () => respond('nope', { status: 404, type: 'text/plain' });
  assert.equal(await codeOf(fetchPdf('https://example.com/a.pdf', opts(fetchImpl))), 'httpError');
});

test('an aborted fetch surfaces as timedOut', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  assert.equal(await codeOf(fetchPdf('https://example.com/a.pdf', opts(fetchImpl))), 'timedOut');
});
