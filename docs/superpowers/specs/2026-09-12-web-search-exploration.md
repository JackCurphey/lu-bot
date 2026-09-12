# Giving Lu web search — parked exploration

**Status: PARKED, 2026-09-12. Not approved, not specified, not built.**

This is a record of a brainstorming session, not a design document. No code was
written. Decisions below were made by the user during the session and are
sound as far as they go, but the session stopped before a provider was chosen
and before any spec existed. Anyone picking this up should treat the decisions
as a starting position to re-confirm, not as a contract.

## The idea

Let someone in a Discord channel ask Lu a question and have him search the
internet for the answer.

## What the hardware permits — the finding that shaped everything

The binding constraint is not RAM, and not the model. It is **prompt prefill
throughput on the 2018 Intel Mac mini**.

Measured on the target machine (`docs/superpowers/specs/2026-09-10-mini-deployment-design.md`,
"Measurements"): `qwen3:4b-instruct` generates at 9.7 tok/s and prefills at
**45.8 tok/s**, in 2.5GB of an available ~9.2GiB. Context window as loaded is
4096 tokens.

Prefill is the cost of *reading* input. At ~46 tok/s, every 1,000 tokens added
to a prompt costs roughly **22 seconds** before Lu says anything. Stage 1's
replies land at 13–15s on a 600–1,300 token prompt, and only because the
persona prefix stays in the KV cache and is not re-read. Search results are
new text on every request, so they pay the full rate:

| Injected into the prompt | Added latency | Resulting reply time |
|---|---|---|
| ~300 tokens (a short cited answer) | ~7s | ~20s |
| ~800 tokens (several result snippets) | ~17s | ~30s |
| ~3,000 tokens (raw text of three pages) | ~65s | exceeds the 4096 window anyway |

**The consequence: Lu cannot read and summarise web pages himself.** That
design — fetch pages, summarise locally, then answer — would cost a minute or
more of prefill per query and would not fit in the context window. The reading
and compressing has to happen off the mini, which is why the provider choice
below is constrained to APIs that return a short pre-written answer rather than
links or raw snippets.

Two corrections to assumptions, worth keeping:

1. **4096 is a config default, not a hardware ceiling.** It is what `ollama ps`
   reports for the loaded model, and there is RAM headroom. `num_ctx` can
   likely be raised; the cost is KV cache memory and more prefill time, not a
   wall. This was not measured. The same question blocks `DF9` in
   `.agents/deferrals.md`.
2. **Search and the corpus compete for one budget.** Both feed the same
   retrieved-passage slot in the system prompt (`chooseChunks()` at
   `src/index.js:74` → `buildMessages()` at `src/responder.js:22`). On a 4096
   window you cannot have five corpus chunks and web results. Which wins is a
   design decision, not something to discover live.

On upgrading: an Apple-silicon mini would pull exactly the lever that hurts
(prefill throughput) and would allow a much larger `num_ctx`. No figures are
quoted here because none were measured. The benchmark method in the mini
deployment design is re-runnable on any candidate machine, including the two
measurement traps recorded there (a warm KV cache reporting ~4,600 tok/s
prefill instead of the true ~46; and embedding latency measured over SSH being
mostly SSH — a 45x error). If the compression happens in the cloud, the
current mini is adequate at ~20s per reply, so the upgrade is not required for
this feature.

## Decisions taken in the session

| # | Decision | Reasoning |
|---|---|---|
| 1 | **Explicit `lu search <query>` only.** No automatic detection in the first build, but designed so a trigger can be added later. | Delivers the capability with none of the false-positive risk. The existing addressee judge has a measured 6/20 false-YES rate (`.agents/STATUS.md`, open item 1); a search judge at that rate would search the web on over a third of the occasions it should not. Command-only also reveals whether anyone actually uses the feature before paying for detection. |
| 2 | **Reply shape: the sourced answer as plain text, followed by one line of Lu reacting to it.** | Avoids choosing between "accurate but not Lu" and "Lu but possibly wrong about a fact someone asked for". Anything he invents lands in the reaction line next to the real answer, where it reads as character rather than as fact — which makes the existing fabrication check meaningful instead of fighting it. Relates directly to open item 2 in `.agents/STATUS.md` (Lu invents Mao attributions with no corpus loaded). |
| 3 | **Access: open to everyone in the allowed channels**, with a per-user cooldown, a global daily cap, and a `SEARCH_ENABLED` kill switch. | Free tiers are small and a shared channel will find the joke in repeating the command. All three limits are pure logic — cheap to test, no LLM involved. Set conservatively at first, loosen once real usage is visible. |
| 4 | **Failure and cap-hit reuse stage 1's headache signal** (`uh oh... i have a headache`). | Failure stays in character; no new failure vocabulary needed. |
| 5 | **Command spells `lu search`**, matching `lu explain` from stage 1 rather than old Lu's `!lu` prefix. | Consistency with the shipped convention. Folded in as a decision, not user-confirmed. |
| 6 | **Thread an abort signal through the search call from the start.** | `DF8` in `.agents/deferrals.md` records that retrieval receives no abort signal and can outlive the reply timeout. A network call inherits that bug for free otherwise, and it is cheaper to do right than to retrofit. Folded in as a decision, not user-confirmed. |

**Not decided — this is where the session stopped.** The provider. The
recommendation on the table was Exa, behind a swappable interface selected by
env var, following the `fetchImpl` injection seam already used in
`src/llm.js`. The user parked the idea before answering.

## One claim that was corrected mid-session

An earlier framing said the plain-text half of the reply keeps "facts
unmodified". **That was too strong.** The synthesized answer these APIs return
is written by the *provider's* LLM, not lifted from the source page. The
accurate and narrower claim: the factual half is not laundered through Lu's
4B model, and it arrives with a link the reader can check. The provider's model
can still be wrong. This is a better position than local summarisation, not a
guarantee of truth — and it means the citation link is load-bearing, not
decoration.

## Provider research — 2026-09-12

Verified against vendor documentation during the session. **Read the caveats
below before relying on any of it; some of it is second-hand, and pricing and
terms move.**

Hard requirement: returns a short synthesized written answer with source
citations, over plain REST from Node's global `fetch` (no SDK).

### Candidates that qualify

| Provider | Free tier | Cost after | Citations | Main risk |
|---|---|---|---|---|
| **Exa `/answer`** | $20 signup credit + $10/month recurring | $5/1,000 (cheaper than its plain search at $7/1,000) | Structured array: title/url/date/author | ToS requires crediting the original publisher |
| **Tavily** | 1,000 credits/month, no card | $0.008/credit (basic search 1 credit, advanced 2) | Separate `results` array to cite from | ToS reportedly says results "may not be transferred, assigned, shared, or otherwise made available to any third party" — ambiguous for a public bot |
| **Kagi FastGPT** | **None** | $15/1,000 (1.5¢/query; cached responses free) | `references` array | No free tier, and real money at any traffic. Cleanest and most concretely documented API of the three (verified endpoint, auth header, response shape) |

The session's recommendation was **Exa**: its free tier recurs monthly rather
than being a one-off, synthesis costs less than its plain search, and its
structured citations map directly onto decision 2's reply shape where the link
is a distinct part of the message. Its ToS obligation (credit the publisher) is
something that design satisfies by construction.

### Ruled out, with reasons

- **Serper, SerpApi** — do not synthesize. Their "answer box" is Google's own
  scraped featured snippet, not written prose. Fails the hard requirement.
- **Brave Search** — has a genuine synthesized-answer product (AI Grounding
  with citations), but it sits on a paid Answers plan ($4/1,000 requests + $5/
  million tokens) *in addition to* the base Search plan ($5/1,000), with no
  free tier for synthesis.
- **Anthropic web search tool, OpenAI web search** — both return synthesized,
  properly cited text, but only as part of a full paid model turn. That
  relocates the LLM cost to a vendor rather than removing it, which defeats the
  point given the hardware constraint above.
- **Perplexity Sonar** — returns a synthesized message plus a citations array,
  but has no free tier and two-part pricing (per-request $5–$12 by search depth,
  *plus* token costs). Also mid-migration: the docs flag "Sonar Chat Completions
  is now Agent API", so the endpoint name may be stale.
- **SearxNG (self-hosted)** — **confirmed it cannot do this.** No shipped
  server-side synthesis. The only relevant work is an unmerged draft PR (#4506,
  still draft as of March 2026) which would require supplying your own
  OpenRouter key and model — i.e. SearxNG becoming a router to an LLM you still
  pay for, not free synthesis.

### What was NOT verified — read this before trusting the table

- **Verbatim ToS clauses for Exa, Brave, Perplexity and Kagi.** The actual
  pages returned a 404, a 403 and an unparseable PDF. Those terms reached this
  document via search-engine summarization of secondary sources — a step
  removed from the primary text. **Someone must open and read the real current
  terms before this faces a server.** This matters most for Tavily, whose
  "internal business purposes" and no-third-party-sharing wording reads like
  standard anti-resale language but was not resolved.
- **Latency.** No first-party benchmark exists for any of these
  synthesized-answer endpoints. Third-party figures for Tavily ranged from
  ~180ms to ~2s average with 3.5s p95 across three blogs — a 10x disagreement.
  Budget for the slow case; the ~20s reply estimate above assumes 1–3s here.
- **Whether Tavily's `include_answer` synthesis is free on the free tier.** The
  pricing page did not state it either way.
- **You.com Answer API** was a plausible fourth candidate ($5/1,000, synthesis
  not upcharged, claims citations verified against source text) but its docs
  reference page 404'd, so its response schema, auth model and terms are all
  unverified. Worth re-checking if the three above fall through.

## If someone picks this up

1. Re-confirm decisions 1–4 with the user; treat 5 and 6 as proposals.
2. Read the actual terms of service for whichever provider is chosen. This is
   the largest unresolved risk and it is a reading task, not an engineering one.
3. Decide the corpus-versus-search context budget (correction 2 above), and
   measure whether `num_ctx` can be raised on the mini. That
   measurement also unblocks `DF9`.
4. Only then write a spec. This document is not one.

## Session provenance

Brainstorming session 2026-09-12, architectural path. Reached "design
approaches agreed, provider undecided" and stopped at the user's request.
Repo state at the time: branch `feat/old-lu-stage1` at commit `24e63f6`,
unmerged and unpushed, deployed and running on the mini. Nothing in this
exploration touched code.
