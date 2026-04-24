# BrainBench v0.20.0 baseline — multi-adapter scorecard

**Date:** 2026-04-23
**gbrain commit:** `423eba6` (garrytan/gbrain-evals branch, v0.20.0)
**gbrain-evals commit:** `f26bc0d` (init after extraction)
**Run:** `BRAINBENCH_N=1 bun eval/runner/multi-adapter.ts`
**N:** 1 (smoke — first v0.20 baseline)
**Wall clock:** ~2.7 min on an M3 laptop
**API cost:** ~$0 (embeddings cached; no agent loop, no judge)

## Why this run exists

First BrainBench run after the v0.20 extraction split gbrain and gbrain-evals into sibling repos. Primary purpose: **confirm the harness still works end-to-end against a locally-linked gbrain v0.20.0**, and establish a tolerance anchor for future regressions.

v0.16 → v0.20 shipped ops / infra (gbrain dream, multi-source brains, RLS, migration hardening, check-resolvable, eval-repo split). Nothing in that range touched the retrieval pipeline, extractor, or ranking — so we expect the scorecard to match the v0.12.1 historical reference (`gbrain-evals/docs/benchmarks/2026-04-19-brainbench-multi-adapter.md`) within noise.

## Side-by-side scorecard

| Adapter             | Runs | Queries | P@5 (mean) | R@5 (mean) | Correct in top-5 |
|---------------------|------|---------|------------|------------|------------------|
| **gbrain-after**    |    1 |     145 |  **49.1%** |  **97.9%** |  **248 / 261**   |
| hybrid-nograph      |    1 |     145 |      17.9% |      65.3% |      130 / 261   |
| ripgrep-bm25        |    1 |     145 |      17.1% |      62.4% |      124 / 261   |
| vector-only         |    1 |     145 |      10.8% |      40.7% |       78 / 261   |

## Deltas vs gbrain-after

| Adapter           | Δ P@5        | Δ R@5        | Δ correct-in-top-5 |
|-------------------|--------------|--------------|---------------------|
| hybrid-nograph    | −31.2 pts    | −32.6 pts    | −118                |
| ripgrep-bm25      | −32.0 pts    | −35.5 pts    | −124                |
| vector-only       | −38.4 pts    | −57.2 pts    | −170                |

## vs v0.12.1 reference (2026-04-19 scorecard)

| Adapter             | v0.12.1 P@5 | v0.20.0 P@5 | Δ         |
|---------------------|-------------|-------------|-----------|
| gbrain-after        | 49.1%       | 49.1%       | **0.0**   |
| hybrid-nograph      | 17.8%       | 17.9%       | +0.1      |
| ripgrep-bm25        | 17.1%       | 17.1%       | 0.0       |
| vector-only         | 10.7%       | 10.8%       | +0.1      |

Flat, as expected. All four adapters land within ±0.1 pts of the v0.12.1 reference — no retrieval regression across the releases (v0.16 / 0.17 / 0.18.0 / 0.18.1 / 0.18.2 / 0.19.0 / 0.20.0) that sit between them.

## Config card

- **Adapters:** `gbrain-after` (PGLite + graph + hybrid), `hybrid-nograph` (gbrain with graph disabled), `ripgrep-bm25` (classic IR baseline), `vector-only` (cosine with the same embedder as gbrain)
- **Corpus:** `eval/data/world-v1/` — 240 rich-prose fictional pages (80 people, 80 companies, 50 meetings, 30 concepts), Opus-generated, committed to the repo, regeneratable from seed
- **Gold:** 145 relational queries derived from `_facts` metadata; sealed at the adapter boundary via `PublicPage` / `PublicQuery`
- **Top-K:** 5
- **Runtime:** Bun 1.3.13, `pglite@0.4.3` in-memory, `postgres@3.4.9`, `pgvector@0.2.1`
- **Embedding model:** `text-embedding-3-large` (OpenAI)
- **Determinism:** stddev = 0.0 on all four adapters at N=1 (single-run, page-order shuffled once; runs of N=5+ will surface any tie-break flakiness)

## Methodology

- Each adapter reingests raw pages into an isolated PGLite instance.
- No gold data is visible to adapters — `_facts` is stripped at the boundary.
- Metrics are macro-averaged P@5 and R@5 across all 145 queries.
- `gbrain-after` ingest includes the auto-link post-hook and reconciliation; `hybrid-nograph` disables it via `GBRAIN_DISABLE_AUTO_LINK=1` to isolate the graph-layer contribution.
- Reproduction: clone `gbrain-evals`, `bun install && bun link gbrain` (points at a local gbrain checkout), `OPENAI_API_KEY=... bun run eval:run:dev`.

## What this does NOT cover

Full BrainBench v1 Complete includes 10/12 Cats. This scorecard runs only the multi-adapter layer (Cats 1 + 2: retrieval precision / recall at K). The other Cats — identity resolution, temporal queries, performance, adversarial robustness, MCP contract, skill compliance (agent adapter), end-to-end workflows, multi-modal — are wired up (`bun run eval:brainbench:smoke` drives them all) but not run here because (a) agent-loop Cats require ~$22 of LLM calls and (b) the `gbrain-after` adapter was the question this run was asked to answer.

Next time: run `bun run eval:brainbench:smoke` if you want the full Cat coverage, or `eval:brainbench:published` (N=10, ~$215) for a release-grade baseline with tolerance bands.
