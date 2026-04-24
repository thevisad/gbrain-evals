# gbrain-evals

**BrainBench — the public benchmark for personal knowledge agent stacks.**

Scores four adapter configurations (gbrain, grep-only, vector RAG,
gbrain-without-graph) side-by-side on a 240-page fictional-life corpus.
Answers the question: *"does the knowledge graph layer do useful work, or
is gbrain just a thin wrapper over vector-grep-rrf-fusion retrieval?"*

Headline on v0.12.1: **gbrain P@5 49.1%, R@5 97.9%** — beats its own
graph-disabled variant by **+31.4 points P@5**, grep-only by 32 points,
vector by 38 points. The graph layer is load-bearing.

## Why a separate repo

Benchmark corpora (world-v1 + amara-life-v1 = ~4MB) shouldn't land in
every gbrain install. This repo is what you clone when you want to run
BrainBench against gbrain, not what you clone to use gbrain as a brain.

`gbrain-evals` depends on `gbrain` via the GitHub URL. When you `bun install`
here, gbrain gets pulled in as a library. Evals call into gbrain's core
modules (`pglite-engine`, `operations`, `link-extraction`, etc.) via the
`gbrain/*` subpath exports.

## 5-minute quickstart

```sh
# Clone + install (pulls gbrain as a library dep)
git clone https://github.com/garrytan/gbrain-evals.git
cd gbrain-evals
bun install

# Run the full 4-adapter benchmark (N=5, ~15 min, no API keys required)
bun run eval:run

# Fast iteration (N=1)
bun run eval:run:dev

# Per-link-type accuracy report
bun run eval:type-accuracy

# Browse the fictional corpus
bun run eval:world:view

# Full BrainBench v1 scorecard (all Cats, published tier N=10)
bun run eval:brainbench:published       # ~$200 Opus baseline
bun run eval:brainbench                 # N=5 iteration (~$100)
bun run eval:brainbench:smoke           # N=1 smoke (~$22)
```

## BrainBench Cat catalog

| Cat | What it tests | Threshold | Status |
|-----|--------------|-----------|--------|
| 1+2 | Retrieval (relational queries over 240-page rich-prose) | P@5 > 0.39, R@5 > 0.83 | shipping |
| 2 | Per-link-type accuracy on rich prose | type F1 per category | shipping |
| 3 | Identity resolution (aliases, handles, emails) | recall > 0.80 | shipping |
| 4 | Temporal queries (as-of, point, range, recency) | as-of recall > 0.80 | shipping |
| 5 | Source attribution / provenance (claim → source classification) | citation_accuracy > 0.90 | shipping (programmatic) |
| 6 | Auto-link precision under prose (at scale) | link_precision > 0.95 | shipping (baseline-only) |
| 7 | Performance / latency | p95 < 200ms per query | shipping |
| 8 | Skill behavior compliance (brain-first, back-link, citation, tier) | all > 0.90 | shipping (programmatic) |
| 9 | End-to-end workflows (5 flows × rubric) | 80% pass per workflow | shipping (programmatic) |
| 10 | Robustness / adversarial (22 hand-crafted cases) | 100% pass, no crash | shipping |
| 11 | Multi-modal ingest (PDF + audio + HTML) | text > 0.95, WER < 0.15 | shipping (opt-in fixtures) |
| 12 | MCP operation contract (trust boundary, input validation) | no silent corruption | shipping |

Cats 5, 8, 9 are "programmatic" — they need runtime inputs (claim catalog,
probe catalog, scenarios + agent state) and are invoked via their `runCatN`
harness API rather than as standalone CLI scripts.

## The fictional corpus: world-v1 + amara-life-v1

**world-v1** (committed, 2.0MB): 240 Opus-generated biographical pages.
80 people, 80 companies, 50 meetings, 30 concepts. Each page carries
`_facts` gold metadata that never crosses the adapter boundary (Day 9
sealed-qrels enforcement).

**amara-life-v1** (committed, 2.1MB): Amara Okafor's messy week in April
2026. 50 emails + 300 Slack messages across 4 channels + 20 calendar
events + 8 meeting transcripts + 40 first-person notes + 6 reference docs.
Planted perturbations: 10 contradictions, 5 stale facts, 5 paraphrased-
injection poison items, 3 implicit preferences.

Regenerate with `bun run eval:generate-amara-life` (requires
`ANTHROPIC_API_KEY`, ~$4 Opus, ~15 min, deterministic from seed=42).

## Repo layout

```
gbrain-evals/
├── eval/
│   ├── data/
│   │   ├── world-v1/                 240 committed biographical pages
│   │   ├── amara-life-v1/            Amara's fictional life (committed)
│   │   ├── gold/                     Sealed qrels + perturbation gold
│   │   └── multimodal/               PDF/audio/HTML fixtures (on-demand)
│   ├── schemas/                      Portable JSON Schema contracts
│   ├── generators/                   world.ts + amara-life.ts + Opus
│   ├── runner/                       12 Cat runners + adapters + judge
│   │   ├── adapters/                 grep-only, vector, vector-grep-rrf-fusion, claude-sonnet
│   │   ├── loaders/                  PDF + corpus loaders
│   │   ├── queries/                  Tier 5 fuzzy + 5.5 synthetic
│   │   ├── all.ts                    Master runner (p-limit(2) async fanout)
│   │   ├── cat{5,6,8,9,11}-*.ts      v1 Complete runners
│   │   ├── tool-bridge.ts            12 read + 3 dry_run tools
│   │   ├── judge.ts                  Haiku judge, structured evidence contract
│   │   ├── recorder.ts               6-artifact flight-recorder
│   │   └── llm-budget.ts             Shared Anthropic-call semaphore
│   └── cli/                          world-view, query-validate, query-new
├── test/eval/                        Unit tests (314 tests, 1354 expect calls)
└── docs/benchmarks/                  Committed scorecards per release
```

## Three contributor paths

### 1. Reproduce a published scorecard
```sh
git checkout <commit-sha-from-scorecard>
bun run eval:run
# Match within tolerance bands (deterministic adapters byte-match)
```

### 2. Submit a new adapter
1. Implement `eval/runner/adapters/<your-adapter>.ts` against the `Adapter`
   interface (`init(pages, config) → BrainState`, `query(q, state) → RankedDoc[]`).
2. Register it in `eval/runner/multi-adapter.ts`.
3. Run `bun run eval:run` — it scores side-by-side against the 4 references.
4. Open a PR with your scorecard in `docs/benchmarks/YYYY-MM-DD-<stack>.md`.

### 3. Extend a Cat
1. Add a new Cat runner at `eval/runner/catN-*.ts`.
2. Wire into `eval/runner/all.ts` CATEGORIES.
3. Add tests at `test/eval/catN.test.ts`.
4. Commit a baseline to `docs/benchmarks/`.

## Design doc + methodology

- `docs/benchmarks/TEMPLATE-brainbench-v1.md` — scorecard format (coming in v1 Complete ship)
- BrainBench v1 design doc: `~/.gstack/projects/garrytan-gbrain/garrytan-garrytan-gbrain-evals-design-20260418-081754.md` (original)
- 3-axis metric framework: Retrieval (Cat 1-4), Ingestion (Cat 2, 6, 11), Assistant/personalization (Cat 5, 8, 9)
- Anti-gaming: sealed qrels at the adapter boundary, N=3/5/10 tolerance bands,
  judge-version pinning, randomized query order per seeded run

## License

MIT. Fixtures (world-v1, amara-life-v1) are fully fictional and redistributable.

## Relationship to gbrain

`gbrain-evals` is a **consumer** of `gbrain`. The benchmark imports gbrain's
public surface via `gbrain/*` subpath exports:

- `gbrain/operations` — the 36 operations (tool-bridge exposes 12 read-only + 3 dry_run)
- `gbrain/pglite-engine` — in-memory Postgres for adapter state
- `gbrain/link-extraction` — extractor under test
- `gbrain/import-file`, `gbrain/embedding`, `gbrain/transcription` — ingest pipeline
- `gbrain/search/vector-grep-rrf-fusion` — vector-grep-rrf-fusion RAG implementation
- `gbrain/types`, `gbrain/config`, `gbrain/engine` — type contracts

Any adapter that implements the `Adapter` interface can be scored — gbrain
is one of many reference stacks, not the benchmark's subject.
