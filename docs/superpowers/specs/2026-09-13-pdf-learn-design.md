# Teaching Lu a PDF from Discord — design

**Status: specified, not approved, not built.** 2026-09-13.

Someone in an allowed channel posts `lu learn <url>` pointing at a PDF. Lu
fetches it, extracts its text, chunks and embeds it, and adds it to a corpus he
retrieves from. `lu sources` lists what he has been taught; `lu forget <title>`
removes one.

## Decisions taken in the brainstorming session

| # | Decision | Rationale | Approver |
|---|---|---|---|
| L1 | Anyone in an allowed channel may teach him, not just the owner | User's call, made with the injection risk stated (see "The trust surface") | user |
| L2 | Explicit `lu learn <url>` command; a bare PDF link does nothing | Matches the `lu credits` / `lu leaderboard` precedent (D16); nothing enters the corpus unasked | user |
| L3 | Learned documents persist, and are manageable from Discord — `lu sources`, `lu forget <title>` | A bad document can be undone without SSH to the mini | user |
| L4 | `unpdf` (1.8.1, MIT, 2.1 MB) for text extraction | Smallest of the three viable pure-JS options; text extraction is its whole purpose. `pdfjs-dist` is 35 MB; `pdf-parse` now hard-depends on the native `@napi-rs/canvas`; `pdf2json` emits positional JSON, the wrong shape for chunking | user |
| L5 | Learned chunks live in a separate store, `data/learned/`, merged with `data/corpus/` at load | Writes never touch the curated corpus, so a pasted document cannot corrupt it, `npm run ingest` cannot destroy what Lu learned, and `lu forget` rewrites one small file | user |
| L6 | One ingest at a time, with an immediate acknowledgement and a report when it finishes | The ingest shares the model server with replies | user |
| L7 | Scanned PDFs are refused, not ingested | There is no OCR here and an empty document is worse than a refusal | user |

## The hardware constraint that shapes the design

The binding number is not embedding throughput. On the mini, `nomic-embed-text`
embeds in **25 ms** (`2026-09-10-mini-deployment-design.md:53`), so even the
400-chunk cap below costs well under two minutes of one-off work.

The binding number is **prefill: 45.8 tok/s into a 4096-token context window**
(`2026-09-10-mini-deployment-design.md`, Measurements; recorded again in
`2026-09-12-web-search-exploration.md`). Every token of retrieved passage is
read afresh on every reply — the persona prefix stays in the KV cache, injected
passages do not.

Current settings cannot work on that hardware:

| | chunk size | chunks retrieved | passage tokens | added prefill |
|---|---|---|---|---|
| As configured today (`chunk.js:3`, `index.js:72`) | 600 words | 5 | ~4,000 | ~90 s, and overruns the window |
| **Proposed for learned documents** | 200 words | 3 | ~800 | ~17 s |

**This is the decision most likely to need revisiting.** 200 words is roughly a
paragraph and a half: enough to carry a quotable passage, not enough to carry
much argument around it. The alternative is accepting slower replies whenever
retrieval fires. Both chunk size and retrieval count become configuration
(`LEARN_CHUNK_WORDS`, `CORPUS_TOP_K`) so this is tunable on the mini with a
restart rather than a deploy.

Note that this has never been exercised: `data/corpus/` does not exist and
`data/raw/` holds only `.gitkeep`, so `retrieve()` has always short-circuited
(`index.js:69`) and Lu has run persona-only in production. This feature is the
first thing that will ever put passages in his prompt. Expect the first learned
document to surface problems in the retrieval path that no amount of unit
testing will find.

## The trust surface

Retrieved chunks enter the system message as passages Lu "may quote from and
only these" (`responder.js:22`). Under L1, any member can put arbitrary text
there. A document containing instructions addressed to a model is, from Lu's
point of view, indistinguishable from source material.

What this design does about it:

- Learned chunks are tagged (`source.learned`) and kept in a separate store, so
  `lu sources` can show exactly what has been added and by whom, and
  `lu forget` can remove it.
- The curated corpus cannot be written to at runtime.

What it deliberately does not do: no content filtering, no model-based review
of what is being ingested. The mitigation is visibility and reversibility, not
prevention. **`lu forget` is available to anyone, same as `lu learn`** — so a
member can also remove a document someone else added. In a small private
server that symmetry is the right trade; it would not be in a large one.

## Modules

Each is small, takes its dependencies as arguments, and is testable without a
network or a model server.

### `src/corpus/fetch.js`

```
fetchPdf(url, { maxBytes, timeoutMs, fetchImpl, lookup }) → { bytes, finalUrl }
```

Throws a `LearnError` with a `code` for every refusal, so the caller maps codes
to fixed in-character lines rather than relaying error text to Discord.

Guards, in order:

1. **Scheme** — `https:` and `http:` only. `file:`, `data:`, `ftp:` rejected
   (`badScheme`).
2. **Address** — the hostname is resolved with `dns.lookup` and rejected if it
   is loopback, private (10/8, 172.16/12, 192.168/16), link-local
   (169.254/16, fe80::/10), or unique-local (fc00::/7) (`privateAddress`).
   Lu runs on the same host as Ollama; without this, `lu learn
   http://127.0.0.1:11434/...` points him at his own model server.
3. **Redirects** — followed manually, `redirect: 'manual'`, maximum 5 hops,
   with the address check repeated on every hop (`tooManyRedirects`). A
   public URL redirecting to a private one is the obvious way around guard 2.
4. **Size** — the body is read as a stream with a running byte count, aborted
   past `maxBytes` (`tooBig`). `Content-Length` is a claim, not a limit; the
   count is what enforces.
5. **Type** — `Content-Type` must be `application/pdf` or
   `application/octet-stream`, *and* the first five bytes must be `%PDF-`
   (`notAPdf`). The magic bytes are the real check; the header is a cheap
   early exit.
6. **Timeout** — one `AbortSignal.timeout(timeoutMs)` covering the whole
   fetch including redirects (`timedOut`).

Accepted and out of scope: **DNS rebinding.** Guard 2 resolves the name, then
`fetch` resolves it again independently; a hostile server can answer
differently the second time. Closing it means connecting to a checked IP with
an explicit `Host` header, which is a disproportionate amount of machinery for
a private server. Recorded here so nobody has to rediscover the hole.

### `src/corpus/pdf.js`

```
extractPdfText(bytes) → { text, title, author, pages }
```

Wraps `unpdf`'s `extractText`, merging pages with blank lines between them so
`chunkText`'s paragraph splitter has boundaries to work with. `title` and
`author` come from the PDF's own metadata when present.

Throws `LearnError('noText')` when the extracted text is under
`LEARN_MIN_CHARS` (default 500) — the scanned-PDF case (L7), and also what a
malformed or encrypted file looks like from here.

### `src/corpus/ingest.js` — refactored

`ingestFiles` currently reads files and embeds in one function. Split so the
embedding half is reusable from the runtime path:

```
ingestTexts({ docs, llm, embedModel, batchSize, chunkOptions }) → records
ingestFiles({ files, ... })  // reads the files, delegates to ingestTexts
```

`docs` are `{ text, title, author, learned? }`. This is the only change to
existing corpus code beyond the store, and `scripts/ingest.js` keeps working
unchanged.

### `src/corpus/store.js` — additions

- `saveCorpus` becomes atomic: write to `<name>.tmp`, then `rename`. It is now
  called at runtime, and a crash mid-write currently leaves a truncated
  `vectors.bin` that `loadCorpus` will happily read as garbage vectors.
- `mergeCorpora(a, b)` — concatenates chunks and vectors into one in-memory
  corpus. Throws if the dimensions disagree (a curated corpus embedded with a
  different model than the running one is a real possibility and silently
  wrong otherwise).
- `removeChunksBySource(records, title)` — filter plus reindex.

`search()` is unchanged, and stays ignorant of where a chunk came from.

### `src/corpus/library.js` — new

Holds both stores and owns every mutation. This is what `index.js` gets instead
of a bare corpus object, and what keeps `index.js` thin.

```
createLibrary({ corpusDir, learnedDir, llm, config }) → {
  search(vector, k),      // across the merged corpus
  sources(),              // learned documents: title, author, addedBy, at, chunks
  learn({ url, addedBy }),// fetch → extract → chunk → embed → append → reload
  forget(title),
  size,
}
```

- **Single-flight (L6):** a module-level flag; `learn` while one is running
  throws `LearnError('busy')` rather than queueing. Two concurrent ingests
  would also race on the same file.
- **Duplicates:** a URL already present in the learned store is refused
  (`alreadyKnown`) — compared on the final URL after redirects.
- **Chunk cap:** over `LEARN_MAX_CHUNKS` (default 400), refused
  (`tooLong`) *before* embedding, so nothing is spent on a document that will
  not be kept.
- After a successful append, the merged in-memory corpus is rebuilt, so the
  next reply can already retrieve from it without a restart.

Learned chunks carry:

```js
source: {
  title, author, chapter: null,
  learned: { url, addedBy: { id, name }, at }
}
```

Curated chunks have no `learned` key, which is how the two are told apart
without a second lookup.

### `src/corpus/commands.js` — new

Regexes and formatters, following `src/credits/commands.js` exactly, including
its anchoring discipline — `lu learn about marxism` is conversation and must
reach the model, not the command handler.

- `LEARN_RE` — `lu learn <url>` and nothing else after it. Discord's
  `<https://...>` angle brackets are stripped before parsing.
- `SOURCES_RE` — `lu sources`, anchored, nothing trailing.
- `FORGET_RE` — `lu forget <title>`; exact title match, case-insensitive; an
  ambiguous match refuses and lists the candidates rather than guessing.
- One fixed line per `LearnError` code, in Lu's lowercase deadpan register.
  Fixed strings, never model-generated and never carrying error text from a
  remote server, for the reason `CREDITS_DISABLED` exists: a user-facing value
  Lu has not been given is a value he must not invent.

The exact wording of every line is drafted at implementation time and shown
rendered for approval before it ships, as D21 required for credits.

### `src/conversation.js` — wiring

A `library` dependency (default `null`, so existing tests construct
unchanged). In `handleMessage`, a command block alongside the credits one:
answer and return, before the award — a command is not conversation, must not
enter the prompt, and must not pay its own asker.

`lu learn` differs from every existing command in being slow. It:

1. Posts an immediate acknowledgement.
2. Runs the ingest **outside** the per-channel reply queue, so Lu stays able to
   talk while he reads.
3. Posts a second message with the outcome: title, chunk count, or the refusal
   line.

Replies will be slower while an ingest runs — both are queued at the same
Ollama instance. Accepted rather than solved; the cap keeps the window short.

### `src/config.js` — new keys

| Key | Default | Meaning |
|---|---|---|
| `LEARN_ENABLED` | `true` | Off switch |
| `LEARN_MAX_BYTES` | `25000000` | Download cap |
| `LEARN_MAX_CHUNKS` | `400` | Roughly a medium book at 200 words/chunk |
| `LEARN_CHUNK_WORDS` | `200` | See the prefill table above |
| `LEARN_FETCH_TIMEOUT_SECONDS` | `60` | Whole fetch, redirects included |
| `LEARN_MIN_CHARS` | `500` | Below this, treated as a scanned PDF |
| `CORPUS_TOP_K` | `3` | Was hardcoded 5 at `index.js:72` |

Validated the way the existing keys are, with `.env.example` updated.

## Data flow

```
"lu learn https://x/y.pdf"
  → LEARN_RE matches, command block intercepts (no award, no prompt)
  → library.learn(): single-flight claim, duplicate check
  → fetchPdf: scheme, address, redirects, size, magic bytes, timeout
  → extractPdfText: text + metadata, or noText
  → chunkText at LEARN_CHUNK_WORDS → cap check → ingestTexts embeds in batches
  → appended to data/learned/ (atomic write) → merged corpus rebuilt
  → report posted
```

Failure at any step: nothing is written, the single-flight flag is released in
a `finally`, the matching fixed line is posted, and the reason goes to the
decision log so `lu explain` can reach it.

## Testing

Test-first throughout, and per the standing rule each new test is watched
failing for the right reason before its implementation exists, with the
mutation confirmed to have landed.

| File | Covers |
|---|---|
| `test/corpus-fetch.test.js` | Every guard, via an injected `fetchImpl` and `lookup` — private address, redirect to a private address, hop limit, oversized body with a lying `Content-Length`, wrong content type, right type but wrong magic bytes, timeout. No network. |
| `test/corpus-pdf.test.js` | A committed fixture PDF with known text; a second fixture with no text layer producing `noText`. Fixtures under `test/fixtures/`, generated and committed, not downloaded at test time. |
| `test/corpus-commands.test.js` | Regex gating and anchoring: `lu learn about marxism` is not a command, `lu learn <https://x.pdf>` is, `lu forget` on an ambiguous title refuses. |
| `test/corpus-library.test.js` | Append, merge, dimension mismatch, search spanning both stores, forget, duplicate refusal, chunk cap refusing before embedding, single-flight rejecting a concurrent call, and the flag released after a failure. Fake `llm.embed`. |
| `test/store.test.js` (extend) | Atomic write: a corpus is never left truncated. |
| `test/conversation.test.js` (extend) | Command answers and stops; no credit awarded; nothing enters history or the prompt; the slow path acknowledges before it reports. |

`node --test` is the whole suite (477 tests as of `12903f7`) and must stay
green.

## Deployment

- `npm install unpdf` has to run **on the mini**, which has no working git and
  broken Command Line Tools. `unpdf` is pure JS with no build step, so this is
  an ordinary install — but the mini's Node version has not been checked and
  `unpdf` needs ≥22. **Check that before merging**, not at deploy time.
- `data/learned/` is created at runtime and is not tracked. The rsync deploy
  recorded in `.agents/STATUS.md` uses `--files-from=<git ls-files>` with no
  `--delete`, so it is untouched by a deploy. It is also not backed up by
  anything; the tarball step in the STATUS.md deploy recipe does cover it.
- Nothing here changes the launchd service or the deploy shape.

## Out of scope

Named so they are decisions rather than omissions:

- **OCR.** Scanned PDFs are refused (L7).
- **Non-PDF URLs.** HTML pages are a different problem with a different
  extraction story; `2026-09-12-web-search-exploration.md` is the parked
  exploration for that and this design does not prejudge it.
- **Discord file attachments.** Links only. Attachments are a small addition
  later (the bytes arrive by a different route; everything downstream is
  shared) but they are not this.
- **Per-user rate limits or quotas.** Single-flight is the only throttle.
- **Deduplication by content.** Only the URL is compared, so the same document
  at two URLs is learned twice.
- **Re-chunking the curated corpus.** `LEARN_CHUNK_WORDS` applies to learned
  documents; `scripts/ingest.js` keeps its 600-word default until there is a
  curated corpus to care about.
