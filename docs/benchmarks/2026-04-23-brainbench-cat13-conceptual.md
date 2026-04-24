# BrainBench Cat 13 — Conceptual Recall baseline (v0.20.0)

**Date:** 2026-04-23
**gbrain commit:** `423eba6` (v0.20.0)
**Run:** `CAT13_PROBES=500 bun eval/runner/cat13-conceptual.ts`
**Probes:** 500 (seeded, deterministic)
**Metric:** nDCG@5 (graded gold: target=3, co-occurrence peer=1)
**Wall clock:** ~10.4 min (4 adapters sequential)

## Why this Cat exists

The BrainBench multi-adapter scorecard (Cats 1+2) runs 145 **relational** queries — "who works at X", "what did Bob invest in". That workload demands exact entity matching and typed-edge traversal, which is why `vector` lands dead last at P@5 10.8% despite using the same embedder as gbrain. Relational queries are structurally hostile to vector similarity.

"Vector retrieval is useless" is the wrong reading of that scorecard. The right reading is "the benchmark is measuring a workload where vectors are weakest." Cat 13 flips the workload to conceptual recall — paraphrase, synonym, fuzzy, semantic neighborhood — and measures every adapter on the 30 concept pages in `world-v1/`.

## Scorecard

| Adapter         | nDCG@5 | P@5 (graded ≥1) | P@1 (strict target) | Wall (s) |
|-----------------|--------|------------------|----------------------|----------|
| **vector** | **49.1%** | **25.3%** | **53.1%** | 119 |
| vector-grep-rrf-fusion  | 47.5% | 25.0% | 49.4% | 287 |
| gbrain    | 47.1% | 24.4% | 49.8% | 215 |
| grep-only    | 46.2% | 21.6% | 49.4% | 0 |

Vector wins the headline — the ordering from Cat 1+2 flips. Total spread is only 3 points, which says "all four adapters are competent at conceptual recall on this corpus"; the interesting signal is in the per-template breakdown below.

## Per-template nDCG@5 (the real story)

| Template                 | vector | vector-grep-rrf-fusion | gbrain | grep-only | #probes |
|--------------------------|-------------|----------------|--------------|--------------|---------|
| title-paraphrase         |  **76.4%**  | 71.2%          | 72.8%        | 71.5%        | 80      |
| title-variation          |  **75.2%**  | 66.8%          | 68.0%        | 70.6%        | 49      |
| description-paraphrase   |  **75.6%**  | 74.1%          | 74.2%        | 71.1%        | 19      |
| synonym                  |  63.8%      | **64.9%**      | 64.3%        |  44.7%       | 114     |
| synonym-fuzzy            |  **66.2%**  | 63.6%          | 63.6%        |  29.5%       | 39      |
| body-fuzzy               |  16.8%      | 17.1%          | 15.1%        | **33.3%**    | 156     |
| semantic-neighborhood    |  25.0%      | 24.4%          | 24.6%        | **29.7%**    | 53      |

### The `synonym-fuzzy` row is the whole case for vectors

| | nDCG@5 |
|---|---|
| vector | 66.2% |
| gbrain | 63.6% |
| vector-grep-rrf-fusion | 63.6% |
| grep-only | **29.5%** |

A query like **"that essay arguing unscalable founder work"** should resolve to `concepts/do-things-that-dont-scale`. Vector nails it at 66%; Grep-only drops 37 points because the literal string "do things that don't scale" never appears in the query. This is the canonical vector win and exactly what Cat 1+2 misses.

### The `body-fuzzy` row is the whole case against vectors

| | nDCG@5 |
|---|---|
| grep-only | **33.3%** |
| vector-grep-rrf-fusion | 17.1% |
| vector | 16.8% |
| gbrain | 15.1% |

When the probe literally quotes a phrase from the page body ("the framework I wrote about manual onboarding") keyword dominates — the phrase is a substring of the page, Grep-only finds it trivially, and vectors diffuse the signal across every page that talks about similar concepts. Caveat: these probes are slightly advantaged for Grep-only because the generator pulls key phrases *from* the target page body. A more adversarial version would rephrase those phrases into synonyms. Tracked as a v2 improvement.

### Graph layer is neutral here

`gbrain` (47.1%) ≈ `vector-grep-rrf-fusion` (47.5%). The +31-point graph advantage from Cat 1+2 disappears, because conceptual queries don't involve typed-edge traversal. This is a feature, not a bug: **the graph layer is precision tooling for relational queries, not a universal retrieval booster.** Cat 13 confirms it stays out of the way when it isn't the right tool.

## What this changes

1. **Vector retrieval earns its place in the benchmark.** The "vectors are useless" read of Cat 1+2 was a workload artifact. On conceptual queries, vectors are the single strongest adapter.
2. **Vector-Grep-RRF-Fusion fusion is the robustness story, not the precision story.** `vector-grep-rrf-fusion` is never top-ranked on any template, but it also never falls to Grep-only's `synonym-fuzzy` floor (29.5%) or vector's `body-fuzzy` floor (16.8%). Average-case wins the release notes; worst-case wins production.
3. **BrainBench Cat 1+2 + Cat 13 is a two-axis scorecard.** Anyone publishing a new personal-knowledge adapter should report both. Relational-only or conceptual-only is misleading; the workload mix in real agent use is both, constantly interleaved.

## Methodology

- **Corpus:** `eval/data/world-v1/concepts__*.json` (30 concept pages: agentic-workflows, unit-economics, PMF, founder-mode, etc.)
- **Probe generator:** deterministic, mulberry32 seed=42. Re-running produces the identical probe set.
- **Template mix per concept:** 5 title paraphrases + 4 title variations + 2 description paraphrases + 3-4 hand-authored synonyms × 4 templates each + body-phrase fuzzies + semantic-neighborhood (co-occurrence-seeded).
- **Graded gold:** target concept = 3. Concepts sharing ≥1 `_facts.related_companies` or `_facts.related_people` with the target = 1. This approximates a peer-group cluster.
- **Hand-authored synonym map:** 30 entries in `eval/runner/cat13-conceptual.ts` `SYNONYMS` covering each concept. These are the load-bearing fairness anchors — without them, synonym queries degenerate to title strings.
- **Sealed qrels:** `PublicPage` / `PublicQuery` at the adapter boundary. No adapter sees `_facts` or `gold`.
- **Adapters:** `grep-only` (inverted index + Grep-only), `vector` (text-embedding-3-large + cosine), `vector-grep-rrf-fusion` (full gbrain vector-grep-rrf-fusion with graph disabled), `gbrain` (full stack).
- **Reproduction:** `bun install && bun link gbrain && OPENAI_API_KEY=... CAT13_PROBES=500 bun eval/runner/cat13-conceptual.ts`

## Cost + runtime

- Vector: 500 queries × 1 embed = ~$0.01 at text-embedding-3-large rates
- Gbrain-after + vector-grep-rrf-fusion: same embedding cost + PGLite ingest overhead
- Total: ~$0.03 per 4-adapter run. No LLM calls, no judge.
- Cat 13 is effectively free to rerun on every PR that touches search / ranking.

## Known gaps to close in v2

1. `body-fuzzy` is unfair to vectors (probes use literal body phrases). Rephrase via synonym substitution.
2. Probes cap at 500 today. Scaling to 1000+ showed diminishing returns on template variation — would need a more diverse generator (e.g. Opus-authored queries) to cross that threshold meaningfully.
3. The synonym map is hand-authored per concept. An Opus-generated synonym layer would broaden coverage and remove any author-bias about "how people would phrase this."
4. Neighborhood co-occurrence is derived from shared `related_companies` / `related_people`. A stronger signal would be pairwise mutual information across meeting transcripts in the same corpus.
