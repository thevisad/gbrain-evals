/**
 * world-v2 Batch API prose generator.
 *
 * Turns the Anchor Codec skeleton (world-v2.ts) into rich JSON pages using the
 * Anthropic Batch API — same pattern as amara-life-v2-gen.ts but for structured
 * entity pages instead of emails/slack/meetings.
 *
 * Each entity (person, company, meeting, concept) becomes one batch request.
 * Results are written as JSON files matching the world-v1 format so the
 * three-way-compare harness can load them with the same loadWorldV2() loader.
 *
 * Writes:
 *   eval/data/world-v2/<entity-type>/<slug>.json
 *   eval/data/world-v2/_batch/requests.jsonl
 *   eval/data/world-v2/_batch/results.jsonl
 *   eval/data/world-v2/_batch/batch-id.txt
 *   eval/data/world-v2/_ledger.json
 *
 * Usage:
 *   bun eval/generators/world-v2-gen.ts --dry-run
 *   bun eval/generators/world-v2-gen.ts              # submit + poll
 *   bun eval/generators/world-v2-gen.ts --check      # resume polling
 *   bun eval/generators/world-v2-gen.ts --max 20     # first 20 entities
 *   bun eval/generators/world-v2-gen.ts --force      # ignore cache
 */

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { buildWorldV2, type EntityFacts, type World } from './world-v2.ts';

// ─── Env + client ─────────────────────────────────────────────────────

function loadEnv(): void {
  const envPath = '.env.testing';
  if (!existsSync(envPath)) {
    throw new Error(`${envPath} not found. Create it with ANTHROPIC_API_KEY=sk-ant-...`);
  }
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ─── Constants ────────────────────────────────────────────────────────

// Opus: highest quality prose for the pitch-adjacent world-v2 corpus.
// Batch API = 50% cheaper than messages.create.
const MODEL = 'claude-opus-4-6';

// Batch API pricing (per 1M tokens, as of 2026-04):
//   Opus input:  $7.50 (batch) vs $15.00 (direct)
//   Opus output: $37.50 (batch) vs $75.00 (direct)
const PRICE_INPUT_PER_M  = 7.50;
const PRICE_OUTPUT_PER_M = 37.50;

const HARD_STOP_USD = 80;
const SCHEMA_VERSION = 1;

const MODEL_PARAMS = {
  max_tokens: 2500,
  temperature: 1.0,
};

const CORPUS_ROOT = 'eval/data/world-v2';
const CACHE_DIR   = join(CORPUS_ROOT, '_cache');
const BATCH_DIR   = join(CORPUS_ROOT, '_batch');

const MAX_BATCH_SIZE = 10_000;
const POLL_INTERVAL_MS = 30_000;

// ─── Cache ────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function canonicalJson(obj: unknown): string {
  const replacer = (_k: string, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v as object).sort().reduce((acc, k) => {
          (acc as Record<string, unknown>)[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {} as Record<string, unknown>)
      : v;
  return JSON.stringify(obj, replacer);
}

function cachePath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

function tryCache(key: string): string | null {
  const p = cachePath(key);
  if (!existsSync(p)) return null;
  const cached = JSON.parse(readFileSync(p, 'utf8')) as { body: string };
  return cached.body ?? null;
}

function saveCache(key: string, body: string): void {
  mkdirSync(dirname(cachePath(key)), { recursive: true });
  writeFileSync(cachePath(key), JSON.stringify({ key, body }, null, 2));
}

// ─── Prompt construction ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You write brain pages for the Anchor Codec universe — a fictional 3-year startup arc (2026–2028).
Anchor Codec builds deterministic data infrastructure: compression, authentication, and transmission in a single pass.
The world is fictional. All people, companies, and events are invented.
Write naturally and realistically, as if this were a real knowledge base used by the team.
Do NOT mention real companies, real investors, or real proprietary technology details.
Anchor's technology is described only as "deterministic data infrastructure" and "single-pass primitives" — never more specific.`;

function entityPrompt(entity: EntityFacts, world: World): string {
  let context = '';

  if (entity.type === 'person') {
    const company = world.companies.find(c => c.slug === entity.primary_affiliation);
    const secondaryCos = (entity.secondary_affiliations ?? [])
      .map(s => world.companies.find(c => c.slug === s))
      .filter(Boolean);
    context = `Person profile to write about:
  Name: ${entity.name}
  Slug: ${entity.slug}
  Role: ${entity.role}
  Title: ${entity.title ?? entity.role}
  Primary affiliation: [${company?.name ?? '?'}](${entity.primary_affiliation}) (${company?.industry ?? '?'})
${secondaryCos.length ? `  Other affiliations: ${secondaryCos.map(c => `[${c!.name}](${c!.slug})`).join(', ')}` : ''}
  Notable traits: ${entity.notable_traits.join(', ')}
${entity.background ? `  Background: ${entity.background}` : ''}
${entity.joined_anchor ? `  Joined Anchor: ${entity.joined_anchor}` : ''}`;

  } else if (entity.type === 'company') {
    const founders = (entity.founders ?? []).slice(0, 3).map(s => world.people.find(p => p.slug === s)).filter(Boolean);
    const investors = (entity.investors ?? []).slice(0, 3).map(s => world.people.find(p => p.slug === s)).filter(Boolean);
    const advisors = (entity.advisors ?? []).slice(0, 2).map(s => world.people.find(p => p.slug === s)).filter(Boolean);
    const employees = (entity.employees ?? []).slice(0, 5).map(s => world.people.find(p => p.slug === s)).filter(Boolean);
    context = `Company profile to write about:
  Name: ${entity.name}
  Slug: ${entity.slug}
  Category: ${entity.category}
  Industry: ${entity.industry}
${entity.description ? `  Description: ${entity.description}` : ''}
${entity.founded_year ? `  Founded: ${entity.founded_year}` : ''}
${founders.length ? `  Founders: ${founders.map(p => `[${p!.name}](${p!.slug})`).join(', ')}` : ''}
${investors.length ? `  Investors/LPs: ${investors.map(p => `[${p!.name}](${p!.slug})`).join(', ')}` : ''}
${advisors.length ? `  Advisors: ${advisors.map(p => `[${p!.name}](${p!.slug})`).join(', ')}` : ''}
${employees.length ? `  Key team: ${employees.map(p => `[${p!.name}](${p!.slug})`).join(', ')}` : ''}`;

  } else if (entity.type === 'meeting') {
    const attendees = entity.attendees.map(s => world.people.find(p => p.slug === s)).filter(Boolean);
    const company = entity.topic_company ? world.companies.find(c => c.slug === entity.topic_company) : null;
    context = `Meeting to write notes for:
  Name: ${entity.name}
  Slug: ${entity.slug}
  Type: ${entity.meeting_type}
  Date: ${entity.date}
  Attendees: ${attendees.map(p => `[${p!.name}](${p!.slug})`).join(', ')}
${company ? `  Topic company: [${company.name}](${company.slug}) (${company.industry})` : ''}
${entity.topic ? `  Topic/agenda: ${entity.topic}` : ''}`;

  } else {
    // concept
    const cos = entity.related_companies.map(s => world.companies.find(c => c.slug === s)).filter(Boolean);
    const peeps = (entity.related_people ?? []).slice(0, 2).map(s => world.people.find(p => p.slug === s)).filter(Boolean);
    context = `Concept to write a thesis page for:
  Name: ${entity.name}
  Slug: ${entity.slug}
  Brief: ${entity.description}
  Related companies: ${cos.map(c => `[${c!.name}](${c!.slug})`).join(', ')}
${peeps.length ? `  Related people: ${peeps.map(p => `[${p!.name}](${p!.slug})`).join(', ')}` : ''}`;
  }

  return `${context}

Write a brain page for this entity. Output JSON with this exact shape:
{
  "title": "Display title for the page",
  "compiled_truth": "Multi-paragraph current understanding. 250-500 words. NATURAL prose, not bullet lists. Reference other entities by markdown link [Name](slug) at least twice using the slugs given above. Vary writing style — sometimes terse, sometimes prose-heavy. Include a couple of natural typos (1-2% of words). Mention the entity by varying names (full name, short name, role). For companies, include details on what they do, recent moves, who's involved. For people, write a bio that mentions their company, history, what they're known for. For meetings, write attendee notes + key discussion points. For concepts, write a thesis with examples and why it matters for infrastructure companies.",
  "timeline": "5-10 dated bullet entries in the format: - **YYYY-MM-DD** | summary text. Mix of dates spanning 2026-2028. Realistic events: hires, raises, ships, talks, meetings. Reference other entities by [Name](slug) where natural."
}

Output ONLY the JSON object. No preamble, no code fences.`;
}

// ─── Batch request types ──────────────────────────────────────────────

interface BatchItem {
  custom_id: string;
  cache_key: string;
  entity: EntityFacts;
  prompt: string;
}

interface BatchRequestLine {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    temperature: number;
    system: string;
    messages: Array<{ role: string; content: string }>;
  };
}

function buildBatchItem(entity: EntityFacts, world: World): BatchItem {
  const prompt = entityPrompt(entity, world);
  const key = sha256(canonicalJson({
    schema_version: SCHEMA_VERSION,
    model_id: MODEL,
    model_params: MODEL_PARAMS,
    system_hash: sha256(SYSTEM_PROMPT),
    prompt_hash: sha256(prompt),
  }));
  return { custom_id: key, cache_key: key, entity, prompt };
}

function toBatchRequestLine(item: BatchItem): BatchRequestLine {
  return {
    custom_id: item.custom_id,
    params: {
      model: MODEL,
      max_tokens: MODEL_PARAMS.max_tokens,
      temperature: MODEL_PARAMS.temperature,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: item.prompt }],
    },
  };
}

function estimateCost(nItems: number): { low: number; high: number } {
  // Avg ~600 input (system + prompt) + 700 output tokens per entity page
  const inTok  = nItems * 600;
  const outTok = nItems * 700;
  const cost = (inTok * PRICE_INPUT_PER_M + outTok * PRICE_OUTPUT_PER_M) / 1_000_000;
  return { low: cost * 0.7, high: cost * 1.5 };
}

// ─── Batch API helpers ────────────────────────────────────────────────

function ensureDir(p: string): void { mkdirSync(p, { recursive: true }); }

async function submitBatch(client: Anthropic, batchItems: BatchItem[]): Promise<string> {
  ensureDir(BATCH_DIR);
  const lines = batchItems.map(item => JSON.stringify(toBatchRequestLine(item)));
  writeFileSync(join(BATCH_DIR, 'requests.jsonl'), lines.join('\n') + '\n');
  console.log(`  Submitting ${batchItems.length} requests to Batch API...`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await (client.beta as any).messages.batches.create({
    requests: batchItems.map(item => toBatchRequestLine(item)),
  });

  const batchId: string = batch.id;
  writeFileSync(join(BATCH_DIR, 'batch-id.txt'), batchId);
  console.log(`  Batch submitted: ${batchId}`);
  return batchId;
}

async function pollBatch(client: Anthropic, batchId: string): Promise<Map<string, string>> {
  console.log(`  Polling batch ${batchId}...`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batches = (client.beta as any).messages.batches;

  while (true) {
    const status = await batches.retrieve(batchId);
    const { processing_status, request_counts } = status;
    console.log(`  Status: ${processing_status} — ${JSON.stringify(request_counts)}`);
    if (processing_status === 'ended') break;
    if (processing_status === 'errored') {
      throw new Error(`Batch ${batchId} errored out. Check Anthropic console.`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  const results = new Map<string, string>();
  const resultLines: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoder: AsyncIterable<any> = await batches.results(batchId);
  for await (const result of decoder) {
    resultLines.push(JSON.stringify(result));
    if (result.result?.type === 'succeeded') {
      const content = result.result.message?.content;
      const text = Array.isArray(content) && content[0]?.type === 'text'
        ? content[0].text
        : '';
      results.set(result.custom_id, text);
    } else {
      console.warn(`  Item ${result.custom_id} failed: ${JSON.stringify(result.result)}`);
    }
  }
  writeFileSync(join(BATCH_DIR, 'results.jsonl'), resultLines.join('\n') + '\n');
  console.log(`  Batch done: ${results.size} successful results`);
  return results;
}

// ─── Output writer ────────────────────────────────────────────────────

function slugToFilePath(slug: string): string {
  // "people/seren-voss" → "eval/data/world-v2/people/seren-voss.json"
  // "companies/anchor"  → "eval/data/world-v2/companies/anchor.json"
  // "meetings/..."      → "eval/data/world-v2/meetings/....json"
  // "concepts/..."      → "eval/data/world-v2/concepts/....json"
  return join(CORPUS_ROOT, `${slug}.json`);
}

function writeEntityPage(entity: EntityFacts, rawJson: string): boolean {
  // Find JSON object in response (lenient parse)
  const start = rawJson.indexOf('{');
  const end   = rawJson.lastIndexOf('}');
  if (start === -1 || end === -1) {
    console.warn(`  No JSON found for ${entity.slug}`);
    return false;
  }
  let parsed: { title?: string; compiled_truth?: string; timeline?: string };
  try {
    parsed = JSON.parse(rawJson.slice(start, end + 1));
  } catch {
    console.warn(`  JSON parse failed for ${entity.slug}`);
    return false;
  }

  const page = {
    slug: entity.slug,
    type: entity.type,
    title: parsed.title ?? entity.slug,
    compiled_truth: parsed.compiled_truth ?? '',
    timeline: parsed.timeline ?? '',
    _facts: entity,
  };

  const outPath = slugToFilePath(entity.slug);
  ensureDir(dirname(outPath));
  writeFileSync(outPath, JSON.stringify(page, null, 2));
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const dryRun    = argv.includes('--dry-run');
  const force     = argv.includes('--force');
  const checkMode = argv.includes('--check');
  const maxIdx    = argv.indexOf('--max');
  const max       = maxIdx !== -1 ? parseInt(argv[maxIdx + 1] ?? '', 10) : Infinity;

  if (!dryRun) {
    loadEnv();
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set. Use --dry-run to preview.');
    }
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? 'dry-run' });
  const world = buildWorldV2(99);

  // ── Build entity list ──
  // Include ALL entities: 25 Anchor team + ~12 VC partners + 8 advisors + 8 peer founders
  //                       + ~20 companies + meetings + concepts
  const allEntities: EntityFacts[] = [
    ...world.people,
    ...world.companies,
    ...world.meetings,
    ...world.concepts,
  ].slice(0, max === Infinity ? undefined : max);

  console.log(`world-v2-gen: world built (seed=99)`);
  console.log(`  People:    ${world.people.length}`);
  console.log(`  Companies: ${world.companies.length}`);
  console.log(`  Meetings:  ${world.meetings.length}`);
  console.log(`  Concepts:  ${world.concepts.length}`);
  console.log(`  Total:     ${allEntities.length}`);
  console.log(`  dryRun=${dryRun} force=${force} max=${max === Infinity ? 'all' : max} check=${checkMode}`);

  // ── Build batch items (skip cached unless --force) ──
  const batchItems: BatchItem[] = [];
  const cachedBodies = new Map<string, string>();

  for (const entity of allEntities) {
    const item = buildBatchItem(entity, world);
    if (!force) {
      const cached = tryCache(item.cache_key);
      if (cached !== null) {
        cachedBodies.set(item.cache_key, cached);
        continue;
      }
    }
    // Also skip if output file already exists (idempotent re-runs)
    if (!force && existsSync(slugToFilePath(entity.slug))) {
      cachedBodies.set(item.cache_key, '__file_exists__');
      continue;
    }
    batchItems.push(item);
  }

  const totalItems = batchItems.length + cachedBodies.size;
  const { low, high } = estimateCost(batchItems.length);
  console.log(`\n  ${cachedBodies.size} cached/existing, ${batchItems.length} to generate (${totalItems} total)`);
  console.log(`  Estimated batch cost: $${low.toFixed(2)} – $${high.toFixed(2)}`);

  if (high > HARD_STOP_USD) {
    console.error(`  HARD_STOP_USD ($${HARD_STOP_USD}) would be exceeded at high estimate. Aborting.`);
    process.exit(1);
  }

  if (batchItems.length > MAX_BATCH_SIZE) {
    console.error(`  Batch too large: ${batchItems.length} > ${MAX_BATCH_SIZE}. Split not yet implemented.`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`\n  [dry-run] Would submit ${batchItems.length} requests. No API calls made.`);
    console.log(`  Distribution: ${JSON.stringify({
      people:    batchItems.filter(b => b.entity.type === 'person').length,
      companies: batchItems.filter(b => b.entity.type === 'company').length,
      meetings:  batchItems.filter(b => b.entity.type === 'meeting').length,
      concepts:  batchItems.filter(b => b.entity.type === 'concept').length,
    })}`);
    return;
  }

  // ── Submit or resume batch ──
  let batchResults: Map<string, string>;

  if (checkMode && existsSync(join(BATCH_DIR, 'batch-id.txt'))) {
    const batchId = readFileSync(join(BATCH_DIR, 'batch-id.txt'), 'utf8').trim();
    console.log(`\n  --check mode: resuming batch ${batchId}`);
    batchResults = await pollBatch(client, batchId);
  } else if (batchItems.length > 0) {
    const batchId = await submitBatch(client, batchItems);
    batchResults = await pollBatch(client, batchId);
  } else {
    batchResults = new Map();
    console.log(`  All items cached/existing — skipping batch submission.`);
  }

  // Cache fresh results
  for (const item of batchItems) {
    const text = batchResults.get(item.cache_key);
    if (text) saveCache(item.cache_key, text);
  }

  // ── Write entity pages ──
  const allBodies = new Map<string, string>([...cachedBodies, ...batchResults]);
  let written = 0, skipped = 0, failed = 0;

  for (const entity of allEntities) {
    const item = buildBatchItem(entity, world);
    const body = allBodies.get(item.cache_key);

    // Already-existing file (cached by file presence)
    if (body === '__file_exists__') {
      skipped++;
      continue;
    }

    if (!body) {
      console.warn(`  No body for ${entity.slug} — skipping`);
      failed++;
      continue;
    }

    const ok = writeEntityPage(entity, body);
    if (ok) written++;
    else failed++;
  }

  console.log(`\nDONE. ${written} pages written, ${skipped} skipped (existing), ${failed} failed`);
  console.log(`Output dir: ${CORPUS_ROOT}/`);
  console.log(`  Batch items generated: ${batchResults.size}`);
  console.log(`  Cache hits: ${cachedBodies.size}`);

  // Write ledger
  const ledger = {
    generated_at: new Date().toISOString(),
    model: MODEL,
    seed: 99,
    pricing: { input_per_m: PRICE_INPUT_PER_M, output_per_m: PRICE_OUTPUT_PER_M },
    total_entities: allEntities.length,
    batch_generated: batchResults.size,
    cache_hits: cachedBodies.size,
    written,
    skipped,
    failed,
  };
  ensureDir(CORPUS_ROOT);
  writeFileSync(join(CORPUS_ROOT, '_ledger.json'), JSON.stringify(ledger, null, 2));
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
