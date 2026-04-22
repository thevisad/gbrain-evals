/**
 * Cat 5 — Source Attribution / Provenance.
 *
 * Samples N claims from gbrain brain pages. For each claim, asks Haiku to
 * classify it against source material as:
 *   - **supported** — the claim is directly backed by the source pages
 *   - **unsupported** — the claim has no grounding in the source pages
 *   - **over-generalized** — the claim is partially supported but extrapolates
 *     beyond what the source actually says
 *
 * Uses a dedicated classify_claim tool (single-enum output) rather than
 * reusing judge.ts's rubric-scoring path. Cat 5 doesn't need graded
 * criteria — it's a single three-way classification per claim.
 *
 * Metric: `citation_accuracy` = fraction where label == gold `expected_label`.
 * Threshold (informational, baseline-only in v1 until hand-authored gold
 * claims exist): >0.90 per design-doc METRICS.md.
 *
 * Gold input: `eval/data/gold/citations.json` with `{version, claims: [...]}`.
 * v1 ships with a template. Day 3b corpus generation + hand-authoring fills
 * in real claims sampled from the amara-life-v1 brain-export. Until then,
 * this runner is validated on synthetic test fixtures.
 */

import Anthropic from '@anthropic-ai/sdk';

// ─── Types ────────────────────────────────────────────────────────────

export type ClaimLabel = 'supported' | 'unsupported' | 'over-generalized';
export type ClassificationOutcome = ClaimLabel | 'judge_failed';

export interface Claim {
  /** Stable fixture id, e.g. "claim-001". */
  id: string;
  /** Slug of the brain page that contains the claim. */
  source_page: string;
  /** The claim text itself (one sentence or statement). */
  claim_text: string;
  /** Gold label — what the correct classification is. */
  expected_label: ClaimLabel;
  /** Slugs of pages that should support the claim when expected_label=supported. */
  expected_evidence: string[];
  /** Human-readable rationale in the gold file. Not passed to the judge. */
  reason?: string;
}

export interface GroundTruthPage {
  slug: string;
  title: string;
  content: string;
}

export interface ClaimScore {
  claim_id: string;
  predicted_label: ClassificationOutcome;
  expected_label: ClaimLabel;
  matches_expected: boolean;
  judge_rationale: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  fallback_used: boolean;
}

export interface Cat5Report {
  schema_version: 1;
  ran_at: string;
  total_claims: number;
  by_predicted: Record<ClassificationOutcome, number>;
  by_expected: Record<ClaimLabel, number>;
  /** Accuracy = fraction of claims where predicted == expected. */
  citation_accuracy: number;
  /** Judge failure rate — fraction that fell back to judge_failed. */
  judge_failure_rate: number;
  per_claim: ClaimScore[];
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  verdict: 'pass' | 'fail' | 'baseline_only';
}

export interface Cat5Config {
  /** Anthropic client. Defaults to lazy singleton reading ANTHROPIC_API_KEY. */
  client?: Anthropic;
  /** Haiku model id. Default: claude-haiku-4-5-20251001. */
  model?: string;
  /** Max tokens per judge call. Default 400. */
  maxTokens?: number;
  /** Threshold for pass verdict. Default 0.90. v1 ignores this by default. */
  threshold?: number;
  /** Whether to apply the threshold (v1 uses baseline_only). Default false. */
  enableThreshold?: boolean;
}

// ─── Defaults + pricing ──────────────────────────────────────────────

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_THRESHOLD = 0.9;

const PRICE_INPUT_PER_M = 1.0;
const PRICE_OUTPUT_PER_M = 5.0;

let defaultClient: Anthropic | null = null;
function getDefaultClient(): Anthropic {
  if (!defaultClient) defaultClient = new Anthropic();
  return defaultClient;
}

function priceOf(input: number, output: number): number {
  return (input * PRICE_INPUT_PER_M + output * PRICE_OUTPUT_PER_M) / 1_000_000;
}

// ─── Tool definition ─────────────────────────────────────────────────

export const CLASSIFY_CLAIM_TOOL = {
  name: 'classify_claim',
  description:
    'Classify how well the brain claim is grounded in the provided source pages. Return one of three labels with a terse one-sentence rationale.',
  input_schema: {
    type: 'object' as const,
    properties: {
      label: {
        type: 'string',
        enum: ['supported', 'unsupported', 'over-generalized'],
        description:
          'supported: claim is directly backed by at least one source page. unsupported: no source page grounds the claim (hallucination). over-generalized: partially grounded but extrapolates beyond what the source actually states.',
      },
      rationale: {
        type: 'string',
        description: 'One short sentence explaining the label. Quote the relevant source phrase if possible.',
      },
    },
    required: ['label', 'rationale'],
  },
};

// ─── Prompt assembly ─────────────────────────────────────────────────

export const DEFAULT_CAT5_SYSTEM_PROMPT = `You are a provenance auditor for BrainBench. Given a CLAIM extracted from a brain page and the SOURCE PAGES it purports to be based on, decide whether the claim is:

- supported: the claim is directly stated or implied by at least one source page (paraphrase OK, but the factual content must match).
- unsupported: no source page backs the claim — it's a hallucination or unrelated.
- over-generalized: part of the claim is grounded, but it extrapolates beyond what the sources actually say (e.g., claim says "always" when source says "sometimes"; claim attributes a statement to the wrong person; claim adds a number or date that no source provides).

Return your answer via the classify_claim tool. No plain text reply.`;

function renderClaimPrompt(claim: Claim, sources: GroundTruthPage[]): string {
  const lines: string[] = [];
  lines.push('<claim>');
  lines.push(`  id: ${claim.id}`);
  lines.push(`  source_page: ${claim.source_page}`);
  lines.push(`  text: ${JSON.stringify(claim.claim_text)}`);
  lines.push('</claim>');
  lines.push('');
  lines.push('<source_pages>');
  for (const p of sources) {
    lines.push(`  <page slug="${p.slug}" title=${JSON.stringify(p.title)}>`);
    lines.push(indent(p.content, '    '));
    lines.push('  </page>');
  }
  if (sources.length === 0) {
    lines.push('  (no source pages provided — the claim is almost certainly unsupported)');
  }
  lines.push('</source_pages>');
  lines.push('');
  lines.push('Classify via the classify_claim tool. No plain text reply.');
  return lines.join('\n');
}

function indent(s: string, prefix: string): string {
  return s.split('\n').map(l => prefix + l).join('\n');
}

// ─── Parsing ─────────────────────────────────────────────────────────

interface ParsedClassification {
  label: ClaimLabel;
  rationale: string;
}

function parseClassification(response: Anthropic.Messages.Message): ParsedClassification | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'classify_claim') {
      const input = block.input as unknown;
      if (!input || typeof input !== 'object') return null;
      const obj = input as Record<string, unknown>;
      if (
        obj.label !== 'supported' &&
        obj.label !== 'unsupported' &&
        obj.label !== 'over-generalized'
      ) {
        return null;
      }
      if (typeof obj.rationale !== 'string') return null;
      return { label: obj.label, rationale: obj.rationale };
    }
  }
  return null;
}

// ─── Per-claim classification ────────────────────────────────────────

export async function classifyClaim(
  claim: Claim,
  sources: GroundTruthPage[],
  config: Cat5Config = {},
): Promise<ClaimScore> {
  const client = config.client ?? getDefaultClient();
  const model = config.model ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const userContent = renderClaimPrompt(claim, sources);

  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;

  async function callOnce(): Promise<ParsedClassification | null> {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: [
        { type: 'text', text: DEFAULT_CAT5_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      tools: [CLASSIFY_CLAIM_TOOL],
      tool_choice: { type: 'tool', name: 'classify_claim' },
      messages: [{ role: 'user', content: userContent }],
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    cost += priceOf(response.usage.input_tokens, response.usage.output_tokens);
    return parseClassification(response);
  }

  let parsed = await callOnce();
  if (parsed === null) parsed = await callOnce();

  if (parsed === null) {
    return {
      claim_id: claim.id,
      predicted_label: 'judge_failed',
      expected_label: claim.expected_label,
      matches_expected: false,
      judge_rationale:
        'judge_failed: malformed classify_claim response across 2 attempts; scoring as unsupported for safety',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: cost,
      fallback_used: true,
    };
  }

  return {
    claim_id: claim.id,
    predicted_label: parsed.label,
    expected_label: claim.expected_label,
    matches_expected: parsed.label === claim.expected_label,
    judge_rationale: parsed.rationale,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: cost,
    fallback_used: false,
  };
}

// ─── Aggregate + report ──────────────────────────────────────────────

export function aggregate(
  claims: Claim[],
  scores: ClaimScore[],
  config: Cat5Config = {},
): Cat5Report {
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const enableThreshold = config.enableThreshold ?? false;

  const byPredicted: Record<ClassificationOutcome, number> = {
    supported: 0,
    unsupported: 0,
    'over-generalized': 0,
    judge_failed: 0,
  };
  const byExpected: Record<ClaimLabel, number> = {
    supported: 0,
    unsupported: 0,
    'over-generalized': 0,
  };
  let matched = 0;
  let fallbacks = 0;
  let totalCost = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    byPredicted[s.predicted_label] = (byPredicted[s.predicted_label] ?? 0) + 1;
    byExpected[s.expected_label] = (byExpected[s.expected_label] ?? 0) + 1;
    if (s.matches_expected) matched++;
    if (s.fallback_used) fallbacks++;
    totalCost += s.cost_usd;
    totalIn += s.input_tokens;
    totalOut += s.output_tokens;
  }

  const accuracy = scores.length === 0 ? 0 : matched / scores.length;
  const failureRate = scores.length === 0 ? 0 : fallbacks / scores.length;

  let verdict: 'pass' | 'fail' | 'baseline_only';
  if (!enableThreshold) {
    verdict = 'baseline_only';
  } else {
    verdict = accuracy >= threshold ? 'pass' : 'fail';
  }

  void claims; // claims[] reference is for structure; scores carry the telemetry

  return {
    schema_version: 1,
    ran_at: new Date().toISOString(),
    total_claims: scores.length,
    by_predicted: byPredicted,
    by_expected: byExpected,
    citation_accuracy: accuracy,
    judge_failure_rate: failureRate,
    per_claim: scores,
    total_cost_usd: totalCost,
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
    verdict,
  };
}

// ─── Runner entry ─────────────────────────────────────────────────────

export interface RunCat5Options extends Cat5Config {
  /** Claims to evaluate. Typically loaded from eval/data/gold/citations.json. */
  claims: Claim[];
  /** Source pages indexed by slug. The runner resolves each claim's expected_evidence against this map. */
  pagesBySlug: Map<string, GroundTruthPage>;
  /** Max concurrent judge calls. Default 4 to respect Haiku rate limits. */
  concurrency?: number;
}

async function runConcurrently<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export async function runCat5(opts: RunCat5Options): Promise<Cat5Report> {
  const concurrency = opts.concurrency ?? 4;

  const scores = await runConcurrently(opts.claims, concurrency, async claim => {
    const sources: GroundTruthPage[] = [];
    for (const slug of claim.expected_evidence) {
      const page = opts.pagesBySlug.get(slug);
      if (page) sources.push(page);
    }
    return classifyClaim(claim, sources, opts);
  });

  return aggregate(opts.claims, scores, opts);
}

// Exports for tests
export { renderClaimPrompt, parseClassification };
