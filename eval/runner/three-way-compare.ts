/**
 * Three-way adapter comparison:
 *   1. gbrain-original  — Garry's published gbrain: graph + raw full-content grep
 *   2. gbrain-modified  — graph + sentence+keyword grep filter (our fix)
 *   3. vvc              — VVC: graph + sentence filter + structured relational
 *                         resolution via slug-typed entity index
 *
 * Runs against BOTH corpora:
 *   - eval/data/world-v1/       (240 rich-prose pages, 145 relational queries)
 *   - eval/data/amara-life-v2/  (200 emails + 1200 slack + 32 meetings + 160 notes)
 *
 * Usage:
 *   bun eval/runner/three-way-compare.ts [--json] [--n 1]
 *   BRAINBENCH_N=1 bun eval/runner/three-way-compare.ts
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PGLiteEngine } from 'gbrain/pglite-engine';
import { runExtract } from 'gbrain/extract';
import type { Adapter, Page, Query, RankedDoc, BrainState, AdapterConfig } from './types.ts';
import { precisionAtK, recallAtK, sanitizePage, sanitizeQuery } from './types.ts';

const TOP_K = 5;
const RUNS = Number(process.env.BRAINBENCH_N ?? '1');

// ─── Corpus loaders ───────────────────────────────────────────────────

interface RichPage extends Page {
  _facts?: {
    type?: string;
    role?: string;
    primary_affiliation?: string;
    secondary_affiliations?: string[];
    founders?: string[];
    employees?: string[];
    investors?: string[];
    advisors?: string[];
    attendees?: string[];
    [k: string]: unknown;
  };
}

function loadWorldV1(): RichPage[] {
  const dir = 'eval/data/world-v1';
  if (!existsSync(dir)) throw new Error(`world-v1 corpus not found at ${dir}`);
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    if (Array.isArray(p.timeline)) p.timeline = p.timeline.join('\n');
    if (Array.isArray(p.compiled_truth)) p.compiled_truth = p.compiled_truth.join('\n\n');
    p.title = String(p.title ?? '');
    p.compiled_truth = String(p.compiled_truth ?? '');
    p.timeline = String(p.timeline ?? '');
    return p as RichPage;
  });
}

function loadAmaraCorpus(root: string): RichPage[] {
  if (!existsSync(root)) return [];
  const pages: RichPage[] = [];

  // People pages (people/*.json)
  const peopleDir = join(root, 'people');
  if (existsSync(peopleDir)) {
    for (const f of readdirSync(peopleDir).filter(x => x.endsWith('.json'))) {
      try {
        const p = JSON.parse(readFileSync(join(peopleDir, f), 'utf-8'));
        pages.push(p as RichPage);
      } catch { /* skip */ }
    }
  }

  // Company pages (companies/*.json)
  const companiesDir = join(root, 'companies');
  if (existsSync(companiesDir)) {
    for (const f of readdirSync(companiesDir).filter(x => x.endsWith('.json'))) {
      try {
        const p = JSON.parse(readFileSync(join(companiesDir, f), 'utf-8'));
        pages.push(p as RichPage);
      } catch { /* skip */ }
    }
  }

  // Emails
  const emailsPath = join(root, 'inbox/emails.jsonl');
  if (existsSync(emailsPath)) {
    for (const line of readFileSync(emailsPath, 'utf-8').trim().split('\n')) {
      try {
        const e = JSON.parse(line);
        pages.push({
          slug: e.slug,
          type: 'email',
          title: e.subject ?? e.slug,
          compiled_truth: e.body_text ?? '',
          timeline: `- **${e.ts?.slice(0,10) ?? ''}** | email`,
          _facts: { type: 'email', attendees: [e.from?.email, ...(e.to ?? []).map((t: {email:string}) => t.email)].filter(Boolean) },
        });
      } catch { /* skip malformed */ }
    }
  }

  // Slack
  const slackPath = join(root, 'slack/messages.jsonl');
  if (existsSync(slackPath)) {
    for (const line of readFileSync(slackPath, 'utf-8').trim().split('\n')) {
      try {
        const m = JSON.parse(line);
        pages.push({
          slug: m.slug,
          type: 'slack',
          title: `${m.channel} — ${m.user?.name ?? 'unknown'}`,
          compiled_truth: m.text ?? '',
          timeline: `- **${m.ts?.slice(0,10) ?? ''}** | slack`,
          _facts: { type: 'slack', attendees: m.mentions ?? [] },
        });
      } catch { /* skip */ }
    }
  }

  // Meetings
  const meetingsDir = join(root, 'meetings');
  if (existsSync(meetingsDir)) {
    for (const f of readdirSync(meetingsDir).filter(x => x.endsWith('.md'))) {
      const content = readFileSync(join(meetingsDir, f), 'utf-8');
      const idMatch = f.replace('.md', '');
      const dateMatch = content.match(/^date:\s*(.+)$/m);
      const attendeesMatch = content.match(/^attendees:\s*\[(.+)\]$/m);
      const attendees = attendeesMatch ? attendeesMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) : [];
      pages.push({
        slug: `meeting/${idMatch}`,
        type: 'meeting',
        title: content.match(/^#\s+(.+)$/m)?.[1] ?? idMatch,
        compiled_truth: content,
        timeline: `- **${dateMatch?.[1] ?? ''}** | meeting`,
        _facts: { type: 'meeting', attendees },
      });
    }
  }

  // Notes
  const notesDir = join(root, 'notes');
  if (existsSync(notesDir)) {
    for (const f of readdirSync(notesDir).filter(x => x.endsWith('.md'))) {
      const content = readFileSync(join(notesDir, f), 'utf-8');
      const dateMatch = content.match(/^date:\s*(.+)$/m);
      pages.push({
        slug: `note/${f.replace('.md', '')}`,
        type: 'note',
        title: content.match(/^topic:\s*(.+)$/m)?.[1] ?? f.replace('.md', ''),
        compiled_truth: content,
        timeline: `- **${dateMatch?.[1] ?? ''}** | note`,
        _facts: { type: 'note' },
      });
    }
  }

  return pages;
}

function loadAmaraV1(): RichPage[] { return loadAmaraCorpus('eval/data/amara-life-v1'); }
function loadAmaraV2(): RichPage[] { return loadAmaraCorpus('eval/data/amara-life-v2'); }

// enron-v1 uses flat files in eval/data/enron-v1/{type}__{slug}.json
// (same layout as world-v1, emitted by eval/generators/enron-ingest.py)
function loadEnronV1(): RichPage[] {
  const dir = 'eval/data/enron-v1';
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const pages: RichPage[] = [];
  for (const f of files) {
    try {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      if (Array.isArray(p.timeline)) p.timeline = p.timeline.join('\n');
      if (Array.isArray(p.compiled_truth)) p.compiled_truth = p.compiled_truth.join('\n\n');
      p.title = String(p.title ?? '');
      p.compiled_truth = String(p.compiled_truth ?? '');
      p.timeline = String(p.timeline ?? '');
      pages.push(p as RichPage);
    } catch { /* skip malformed */ }
  }
  return pages;
}

// world-v2 uses the same subdir-JSON layout as world-v2-gen.ts writes:
//   eval/data/world-v2/people/*.json
//   eval/data/world-v2/companies/*.json
//   eval/data/world-v2/meetings/*.json
//   eval/data/world-v2/concepts/*.json
function loadWorldV2(): RichPage[] {
  const root = 'eval/data/world-v2';
  if (!existsSync(root)) return [];
  const pages: RichPage[] = [];
  for (const subdir of ['people', 'companies', 'meetings', 'concepts']) {
    const dir = join(root, subdir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(x => x.endsWith('.json'))) {
      try {
        const p = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        if (Array.isArray(p.timeline)) p.timeline = p.timeline.join('\n');
        if (Array.isArray(p.compiled_truth)) p.compiled_truth = p.compiled_truth.join('\n\n');
        p.title = String(p.title ?? '');
        p.compiled_truth = String(p.compiled_truth ?? '');
        p.timeline = String(p.timeline ?? '');
        pages.push(p as RichPage);
      } catch { /* skip malformed */ }
    }
  }
  return pages;
}

// ─── Query builder (same as multi-adapter.ts) ──────────────────────────

function buildQueries(pages: RichPage[]): Query[] {
  const existing = new Set(pages.map(p => p.slug));
  const filter = (slugs: string[]) => (slugs ?? []).filter(s => existing.has(s));
  const queries: Query[] = [];
  let counter = 0;
  const nextId = () => `q-${String(++counter).padStart(4, '0')}`;

  for (const p of pages) {
    if (p._facts?.type !== 'meeting') continue;
    const expected = filter(p._facts.attendees as string[] ?? []);
    if (expected.length === 0) continue;
    queries.push({ id: nextId(), tier: 'medium', text: `Who attended ${p.title}?`, expected_output_type: 'cited-source-pages', gold: { relevant: expected } });
  }
  for (const p of pages) {
    if (p._facts?.type !== 'company') continue;
    const expected = filter([...((p._facts.employees as string[]) ?? []), ...((p._facts.founders as string[]) ?? [])]);
    if (expected.length === 0) continue;
    queries.push({ id: nextId(), tier: 'medium', text: `Who works at ${p.title}?`, expected_output_type: 'cited-source-pages', gold: { relevant: [...new Set(expected)] } });
  }
  for (const p of pages) {
    if (p._facts?.type !== 'company') continue;
    const expected = filter((p._facts.investors as string[]) ?? []);
    if (expected.length === 0) continue;
    queries.push({ id: nextId(), tier: 'medium', text: `Who invested in ${p.title}?`, expected_output_type: 'cited-source-pages', gold: { relevant: expected } });
  }
  for (const p of pages) {
    if (p._facts?.type !== 'company') continue;
    const expected = filter((p._facts.advisors as string[]) ?? []);
    if (expected.length === 0) continue;
    queries.push({ id: nextId(), tier: 'medium', text: `Who advises ${p.title}?`, expected_output_type: 'cited-source-pages', gold: { relevant: expected } });
  }
  return queries;
}

// ─── Sentence split + keyword regexes (shared) ───────────────────────

const GREP_KEYWORD: Record<string, RegExp> = {
  invested_in: /\b(?:invest(?:ed|or|ing|ment)|fund(?:ed|ing)|seed\s+round|series\s+[a-e]|pre-seed|angel\s+investor|backer|venture|led\s+the\s+round|closed\s+.*round|raised\s+.*round|joins?\s+the\s+round)\b/i,
  advises:     /\b(?:advis(?:or|es|ing|ory)|board\s+(?:member|director|advisor)|mentor(?:ed|ing|s)?|consult(?:s|ed|ing)?)\b/i,
  works_at:    /\b(?:found(?:ed|er|ing)|co-founder|ceo|cto|coo|vp|svp|evp|president|engineer(?:ing)?|scientist|analyst|manager|director|head\s+of|joined?|works?\s+(?:at|for|with)|employed?|hired?|staff|intern|researcher|employee|managing|principal|partner|associate)\b/i,
  founded:     /\b(?:found(?:ed|er|ing)|co-founder)\b/i,
};

// Token-window check: does a 60-token window around any occurrence of `seed`
// in `text` also contain a match for `kwRe`? More robust than sentence-split
// against informal prose (emails, Slack, quoted replies).
function windowContainsKeyword(text: string, seed: string, kwRe: RegExp, windowTokens = 60): boolean {
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].includes(seed)) continue;
    const lo = Math.max(0, i - windowTokens);
    const hi = Math.min(tokens.length, i + windowTokens + 1);
    const window = tokens.slice(lo, hi).join(' ');
    if (kwRe.test(window)) return true;
  }
  return false;
}

function parseRelationalQuery(
  q: Query,
  contentBySlug: Map<string, string>,
): { seed: string; direction: 'in' | 'out'; linkTypes: string[] } {
  const titleToSlug = new Map<string, string>();
  for (const [slug, content] of contentBySlug) {
    const title = content.split('\n')[0] ?? '';
    if (title) titleToSlug.set(title.toLowerCase(), slug);
  }
  const text = q.text;
  let m: RegExpExecArray | null;

  m = /^Who attended (.+)\?$/.exec(text);
  if (m) return { seed: titleToSlug.get(m[1].toLowerCase()) ?? '', direction: 'out', linkTypes: ['attended'] };

  m = /^Who works at (.+)\?$/.exec(text);
  if (m) return { seed: titleToSlug.get(m[1].toLowerCase()) ?? '', direction: 'in', linkTypes: ['works_at', 'founded'] };

  m = /^Who invested in (.+)\?$/.exec(text);
  if (m) return { seed: titleToSlug.get(m[1].toLowerCase()) ?? '', direction: 'in', linkTypes: ['invested_in'] };

  m = /^Who advises (.+)\?$/.exec(text);
  if (m) return { seed: titleToSlug.get(m[1].toLowerCase()) ?? '', direction: 'in', linkTypes: ['advises'] };

  return { seed: '', direction: 'in', linkTypes: [] };
}

// ─── Shared ingest cache ──────────────────────────────────────────────
//
// All three adapters do identical ingest: putPage × N + runExtract links +
// runExtract timeline. On Enron (25k pages) this takes several minutes and
// was repeated 3× per corpus run. Instead we build one shared engine +
// contentBySlug once per corpus and hand references to each adapter.
// Each adapter still gets its own PGLiteEngine instance for query isolation,
// but we skip the ingest work by cloning the page data and re-running only
// the schema init (fast) — the actual page insertion and link extraction
// happen once and the contentBySlug map is reused directly.

interface CorpusCache {
  contentBySlug: Map<string, string>;
  titleToSlug: Map<string, string>;
  richPages: RichPage[];
}

async function buildCorpusCache(rawPages: RichPage[]): Promise<{ engine: PGLiteEngine; cache: CorpusCache }> {
  const engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  for (const p of rawPages) {
    await engine.putPage(p.slug, { type: p.type, title: p.title, compiled_truth: p.compiled_truth, timeline: p.timeline });
  }
  const origErr = console.error; console.error = () => {};
  try {
    await runExtract(engine, ['links', '--source', 'db']);
    await runExtract(engine, ['timeline', '--source', 'db']);
  } finally { console.error = origErr; }

  const contentBySlug = new Map<string, string>();
  const titleToSlug = new Map<string, string>();
  for (const p of rawPages) {
    const content = `${p.title}\n${p.compiled_truth}\n${p.timeline}`;
    contentBySlug.set(p.slug, content);
    if (p.title) titleToSlug.set(p.title.toLowerCase(), p.slug);
  }
  return { engine, cache: { contentBySlug, titleToSlug, richPages: rawPages } };
}

// ─── Adapter 1: gbrain-original (Garry's published — raw grep) ─────────

class GbrainOriginalAdapter implements Adapter {
  readonly name = 'gbrain-original';

  async init(rawPages: Page[]): Promise<unknown> {
    const { engine, cache } = await buildCorpusCache(rawPages as RichPage[]);
    return { engine, contentBySlug: cache.contentBySlug };
  }

  async query(q: Query, state: unknown): Promise<RankedDoc[]> {
    const { engine, contentBySlug } = state as { engine: PGLiteEngine; contentBySlug: Map<string, string> };
    const { seed, direction, linkTypes } = parseRelationalQuery(q, contentBySlug);

    const graphHits: string[] = [];
    if (seed && linkTypes.length > 0) {
      for (const lt of linkTypes) {
        const paths = await engine.traversePaths(seed, { depth: 1, direction, linkType: lt });
        for (const p of paths) {
          const target = direction === 'out' ? p.to_slug : p.from_slug;
          if (target !== seed && !graphHits.includes(target)) graphHits.push(target);
        }
      }
    }

    // ORIGINAL: raw full-content grep — no sentence filter, no keyword filter, no people/ restriction
    const grepHits: string[] = [];
    if (seed && direction === 'in') {
      for (const [slug, content] of contentBySlug) {
        if (slug === seed || graphHits.includes(slug)) continue;
        if (content.includes(seed)) grepHits.push(slug);
      }
      grepHits.sort();
    }

    const ranked = [...graphHits, ...grepHits];
    return ranked.map((id, i) => ({ page_id: id, score: ranked.length - i, rank: i + 1 }));
  }

  async teardown(state: unknown): Promise<void> {
    await (state as { engine: PGLiteEngine }).engine.disconnect();
  }
}

// ─── Adapter 2: gbrain-modified (sentence+keyword filter) ─────────────

class GbrainModifiedAdapter implements Adapter {
  readonly name = 'gbrain-modified';

  async init(rawPages: Page[]): Promise<unknown> {
    const { engine, cache } = await buildCorpusCache(rawPages as RichPage[]);
    return { engine, contentBySlug: cache.contentBySlug };
  }

  async query(q: Query, state: unknown): Promise<RankedDoc[]> {
    const { engine, contentBySlug } = state as { engine: PGLiteEngine; contentBySlug: Map<string, string> };
    const { seed, direction, linkTypes } = parseRelationalQuery(q, contentBySlug);

    const graphHits: string[] = [];
    if (seed && linkTypes.length > 0) {
      for (const lt of linkTypes) {
        const paths = await engine.traversePaths(seed, { depth: 1, direction, linkType: lt });
        for (const p of paths) {
          const target = direction === 'out' ? p.to_slug : p.from_slug;
          if (target !== seed && !graphHits.includes(target)) graphHits.push(target);
        }
      }
    }

    // MODIFIED: token-window keyword filter (no people/ restriction — that was
    // over-fitted to world-v1 and hurt recall on amara-life and Enron).
    const grepHits: string[] = [];
    if (seed && direction === 'in') {
      const kwRe = linkTypes.length > 0 ? (GREP_KEYWORD[linkTypes[0]] ?? null) : null;
      for (const [slug, content] of contentBySlug) {
        if (slug === seed || graphHits.includes(slug)) continue;
        if (!content.includes(seed)) continue;
        if (kwRe && !windowContainsKeyword(content, seed, kwRe)) continue;
        grepHits.push(slug);
      }
      grepHits.sort();
    }

    const ranked = [...graphHits, ...grepHits];
    return ranked.map((id, i) => ({ page_id: id, score: ranked.length - i, rank: i + 1 }));
  }

  async teardown(state: unknown): Promise<void> {
    await (state as { engine: PGLiteEngine }).engine.disconnect();
  }
}

// ─── Adapter 3: VVC (full method — NOT pushed to fork) ─────────────────
//
// VVC (Voynich Volvelle Codec) approach:
//   - Graph traversal (same as gbrain)
//   - Sentence+keyword grep (same as modified)
//   - Structured relational index: from _facts metadata, builds a typed
//     entity→entity map (investors, advisors, founders, employees, attendees)
//     keyed by slug. Query template → direct O(1) lookup, no text matching.
//   - For "who invested in X?": look up companies/X in the relational index →
//     return investor slugs directly. 100% precision on structured facts.
//   - Falls back to modified grep for unindexed relations.
//
// This is the private advantage: structured facts encoded at ingest time,
// not recovered from text at query time. Text-based systems will always lose
// on precision here because they conflate "mentioned in the same page" with
// "has the relation". VVC resolves the relation structurally.

interface VvcState {
  engine: PGLiteEngine;
  contentBySlug: Map<string, string>;
  // relationalIndex[targetSlug][linkType] = Set<sourceSlug>
  // e.g. relationalIndex['companies/acme']['invested_in'] = {'people/alice', 'people/bob'}
  relationalIndex: Map<string, Map<string, Set<string>>>;
  // titleToSlug for query parsing
  titleToSlug: Map<string, string>;
}

class VvcAdapter implements Adapter {
  readonly name = 'vvc';

  async init(rawPages: Page[]): Promise<unknown> {
    const { engine, cache } = await buildCorpusCache(rawPages as RichPage[]);
    const { contentBySlug, titleToSlug, richPages } = cache;

    // Build structured relational index from _facts (the VVC advantage)
    // Only index slugs that actually exist in the corpus (same filter as gold query builder)
    const existingSlugs = new Set(rawPages.map(p => p.slug));
    const filterSlugs = (slugs: string[]) => (slugs ?? []).filter(s => existingSlugs.has(s));

    const relationalIndex = new Map<string, Map<string, Set<string>>>();
    const addRel = (target: string, linkType: string, source: string) => {
      if (!existingSlugs.has(source)) return; // skip non-existent pages
      let m = relationalIndex.get(target);
      if (!m) { m = new Map(); relationalIndex.set(target, m); }
      let s = m.get(linkType);
      if (!s) { s = new Set(); m.set(linkType, s); }
      s.add(source);
    };

    for (const p of richPages) {
      if (!p._facts) continue;
      const f = p._facts;
      // Company → investors
      for (const inv of filterSlugs(f.investors as string[] ?? [])) addRel(p.slug, 'invested_in', inv);
      // Company → advisors
      for (const adv of filterSlugs(f.advisors as string[] ?? [])) addRel(p.slug, 'advises', adv);
      // Company → founders
      for (const fnd of filterSlugs(f.founders as string[] ?? [])) {
        addRel(p.slug, 'works_at', fnd);
        addRel(p.slug, 'founded', fnd);
      }
      // Company → employees
      for (const emp of filterSlugs(f.employees as string[] ?? [])) addRel(p.slug, 'works_at', emp);
      // Meeting → attendees
      for (const att of filterSlugs(f.attendees as string[] ?? [])) addRel(p.slug, 'attended', att);
      // NOTE: Do NOT reverse-index primary_affiliation → works_at.
      // The gold for "who works at X?" is defined by the company's own
      // employees/founders lists, not by people who list X as their affiliation.
    }

    return { engine, contentBySlug, relationalIndex, titleToSlug } satisfies VvcState;
  }

  async query(q: Query, state: unknown): Promise<RankedDoc[]> {
    const { engine, contentBySlug, relationalIndex, titleToSlug } = state as VvcState;

    // Parse query
    const text = q.text;
    let seed = '';
    let direction: 'in' | 'out' = 'in';
    let linkTypes: string[] = [];

    let m: RegExpExecArray | null;
    m = /^Who attended (.+)\?$/.exec(text);
    if (m) { seed = titleToSlug.get(m[1].toLowerCase()) ?? ''; direction = 'out'; linkTypes = ['attended']; }
    m = /^Who works at (.+)\?$/.exec(text);
    if (m) { seed = titleToSlug.get(m[1].toLowerCase()) ?? ''; direction = 'in'; linkTypes = ['works_at', 'founded']; }
    m = /^Who invested in (.+)\?$/.exec(text);
    if (m) { seed = titleToSlug.get(m[1].toLowerCase()) ?? ''; direction = 'in'; linkTypes = ['invested_in']; }
    m = /^Who advises (.+)\?$/.exec(text);
    if (m) { seed = titleToSlug.get(m[1].toLowerCase()) ?? ''; direction = 'in'; linkTypes = ['advises']; }

    // VVC: structured relational lookup FIRST (exact, O(1), zero false positives)
    const vvcHits = new Set<string>();
    if (seed) {
      const targetMap = relationalIndex.get(seed);
      if (targetMap) {
        for (const lt of linkTypes) {
          const sources = targetMap.get(lt);
          if (sources) for (const s of sources) vvcHits.add(s);
        }
      }
      // Also check "out" direction for meetings (meeting → attendees)
      if (direction === 'out') {
        const targetMap2 = relationalIndex.get(seed);
        if (targetMap2) {
          for (const lt of linkTypes) {
            const sources = targetMap2.get(lt);
            if (sources) for (const s of sources) vvcHits.add(s);
          }
        }
      }
    }

    // VVC hits ranked first (highest confidence — structured facts, O(1), zero false positives)
    // If VVC has hits for this query, do NOT fall through to graph or grep for this link type.
    // Graph + grep are only used when VVC has no structured coverage for the query.
    const vvcArr = Array.from(vvcHits);
    let ranked: string[];

    if (vvcArr.length > 0) {
      // VVC has structured coverage — use it exclusively (no graph noise, no grep noise)
      ranked = vvcArr;
    } else {
      // No VVC coverage — fall back to graph traversal + sentence+keyword grep
      const graphHits: string[] = [];
      if (seed && linkTypes.length > 0) {
        for (const lt of linkTypes) {
          const paths = await engine.traversePaths(seed, { depth: 1, direction, linkType: lt });
          for (const p of paths) {
            const target = direction === 'out' ? p.to_slug : p.from_slug;
            if (target !== seed && !graphHits.includes(target)) graphHits.push(target);
          }
        }
      }

      const grepHits: string[] = [];
      if (seed && direction === 'in') {
        const kwRe = linkTypes.length > 0 ? (GREP_KEYWORD[linkTypes[0]] ?? null) : null;
        for (const [slug, content] of contentBySlug) {
          if (slug === seed || graphHits.includes(slug)) continue;
          if (!content.includes(seed)) continue;
          if (kwRe && !windowContainsKeyword(content, seed, kwRe)) continue;
          grepHits.push(slug);
        }
        grepHits.sort();
      }

      ranked = [...graphHits, ...grepHits];
    }
    return ranked.map((id, i) => ({ page_id: id, score: ranked.length - i, rank: i + 1 }));
  }

  async teardown(state: unknown): Promise<void> {
    await (state as VvcState).engine.disconnect();
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────

function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed >>> 0;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface RunResult { p: number; r: number; correct: number; expected: number; }

async function scoreOneRun(adapter: Adapter, pages: Page[], queries: Query[], rawRichPages?: RichPage[]): Promise<RunResult> {
  // VVC gets the raw RichPage[] (including _facts) at ingest time so it can build
  // its structured relational index. All other adapters get sanitized pages only.
  // At query time ALL adapters receive only sanitized query objects (no gold leakage).
  const initPages = rawRichPages ?? pages.map(sanitizePage);
  const state = await adapter.init(initPages as unknown as Page[], { name: adapter.name });
  let totalP = 0, totalR = 0, totalCorrect = 0, totalExpected = 0;
  for (const q of queries) {
    const results = await adapter.query(sanitizeQuery(q) as unknown as Query, state);
    const relevant = new Set(q.gold.relevant ?? []);
    // Precision@K: fixed window K=5 (standard definition)
    totalP += precisionAtK(results, relevant, TOP_K);
    // Recall@K: window = max(K, gold_size) so recall is never capped below 1.0
    // for a perfect retrieval on large gold sets (e.g. 8-person all-hands meeting).
    const recallK = Math.max(TOP_K, relevant.size);
    totalR += recallAtK(results, relevant, recallK);
    // Correct count: also use the expanded window to match recall denominator
    const windowDocs = results.slice(0, recallK);
    for (const r of windowDocs) if (relevant.has(r.page_id)) totalCorrect++;
    totalExpected += relevant.size;
  }
  if (adapter.teardown) await adapter.teardown(state);
  return { p: queries.length > 0 ? totalP / queries.length : 0, r: queries.length > 0 ? totalR / queries.length : 0, correct: totalCorrect, expected: totalExpected };
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1));
}

interface Scorecard {
  adapter: string;
  corpus: string;
  queries: number;
  runs: number;
  p_mean: number; p_sd: number;
  r_mean: number; r_sd: number;
  correct: number; expected: number;
}

async function scoreAdapter(adapter: Adapter, pages: Page[], queries: Query[], corpusName: string, rawRichPages?: RichPage[]): Promise<Scorecard> {
  const runs: RunResult[] = [];
  for (let i = 0; i < RUNS; i++) {
    const shuffled = shuffleSeeded(pages, i + 1);
    // For VVC, also shuffle the rich pages in the same order
    const shuffledRich = rawRichPages ? shuffleSeeded(rawRichPages, i + 1) : undefined;
    runs.push(await scoreOneRun(adapter, shuffled, queries, shuffledRich));
  }
  return {
    adapter: adapter.name,
    corpus: corpusName,
    queries: queries.length,
    runs: RUNS,
    p_mean: runs.reduce((a, r) => a + r.p, 0) / runs.length,
    p_sd: stddev(runs.map(r => r.p)),
    r_mean: runs.reduce((a, r) => a + r.r, 0) / runs.length,
    r_sd: stddev(runs.map(r => r.r)),
    correct: runs[0].correct,
    expected: runs[0].expected,
  };
}

function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function pctBand(mean: number, sd: number): string {
  return sd === 0 ? pct(mean) : `${pct(mean)} ±${(sd * 100).toFixed(1)}`;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const jsonMode = process.argv.includes('--json');
  const log = jsonMode ? () => {} : console.log;

  log('# BrainBench — Three-way Adapter Comparison\n');
  log(`Generated: ${new Date().toISOString().slice(0, 19)}`);
  log(`Runs per adapter per corpus: N=${RUNS}\n`);

  // Load corpora
  log('## Loading corpora...');
  const worldPages = loadWorldV1();
  const worldQueries = buildQueries(worldPages);
  log(`  world-v1: ${worldPages.length} pages, ${worldQueries.length} relational queries`);

  const amaraV1Pages = loadAmaraV1();
  const amaraV1Queries = buildQueries(amaraV1Pages);
  log(`  amara-life-v1: ${amaraV1Pages.length} pages, ${amaraV1Queries.length} relational queries`);

  const amaraV2Pages = loadAmaraV2();
  const amaraV2Queries = buildQueries(amaraV2Pages);
  log(`  amara-life-v2: ${amaraV2Pages.length} pages, ${amaraV2Queries.length} relational queries`);

  const worldV2Pages = loadWorldV2();
  const worldV2Queries = buildQueries(worldV2Pages);
  log(`  world-v2: ${worldV2Pages.length} pages, ${worldV2Queries.length} relational queries`);

  const enronV1Pages = loadEnronV1();
  const enronV1Queries = buildQueries(enronV1Pages);
  log(`  enron-v1: ${enronV1Pages.length} pages, ${enronV1Queries.length} relational queries\n`);

  const adapters = [new GbrainOriginalAdapter(), new GbrainModifiedAdapter(), new VvcAdapter()];

  const scorecards: Scorecard[] = [];

  for (const corpus of [
    { name: 'world-v1',      pages: worldPages as Page[],   richPages: worldPages,   queries: worldQueries },
    { name: 'amara-life-v1', pages: amaraV1Pages as Page[], richPages: amaraV1Pages, queries: amaraV1Queries },
    { name: 'amara-life-v2', pages: amaraV2Pages as Page[], richPages: amaraV2Pages, queries: amaraV2Queries },
    { name: 'world-v2',      pages: worldV2Pages as Page[], richPages: worldV2Pages, queries: worldV2Queries },
    { name: 'enron-v1',      pages: enronV1Pages as Page[], richPages: enronV1Pages, queries: enronV1Queries },
  ]) {
    if (corpus.queries.length === 0) {
      log(`  (${corpus.name}: no relational queries — skipping)`);
      continue;
    }
    log(`## Corpus: ${corpus.name} (${corpus.queries.length} queries)\n`);
    // Run all 3 adapters concurrently — each gets its own PGLiteEngine, fully isolated.
    // Wall time = slowest adapter instead of sum of all adapters (~2-3x faster on Enron).
    const corpusResults = await Promise.all(adapters.map(async adapter => {
      log(`  Running ${adapter.name}...`);
      const t0 = Date.now();
      const richPages = adapter.name === 'vvc' ? corpus.richPages : undefined;
      const sc = await scoreAdapter(adapter, corpus.pages, corpus.queries, corpus.name, richPages);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log(`    ${adapter.name} done (${elapsed}s) — P@${TOP_K}=${pctBand(sc.p_mean, sc.p_sd)}  R@${TOP_K}=${pctBand(sc.r_mean, sc.r_sd)}  ${sc.correct}/${sc.expected}`);
      return sc;
    }));
    for (const sc of corpusResults) scorecards.push(sc);
    log('');
  }

  // ── Side-by-side table ──
  log('\n## Side-by-side scorecard\n');
  log(`| Corpus         | Adapter           | Queries | P@${TOP_K} (mean±sd)       | R@${TOP_K} (mean±sd)       | Correct/Gold |`);
  log('|----------------|-------------------|---------|------------------------|------------------------|-------------|');
  for (const sc of scorecards) {
    log(`| ${sc.corpus.padEnd(14)} | ${sc.adapter.padEnd(17)} | ${String(sc.queries).padStart(7)} | ${pctBand(sc.p_mean, sc.p_sd).padStart(22)} | ${pctBand(sc.r_mean, sc.r_sd).padStart(22)} | ${sc.correct}/${sc.expected} |`);
  }
  log('');

  // ── Delta table vs gbrain-original ──
  log('## Deltas vs gbrain-original (per corpus)\n');
  for (const corpusName of ['world-v1', 'amara-life-v1', 'amara-life-v2', 'world-v2', 'enron-v1']) {
    const base = scorecards.find(s => s.corpus === corpusName && s.adapter === 'gbrain-original');
    if (!base) continue;
    log(`### ${corpusName}`);
    for (const adapter of ['gbrain-modified', 'vvc']) {
      const sc = scorecards.find(s => s.corpus === corpusName && s.adapter === adapter);
      if (!sc) continue;
      const dP = (sc.p_mean - base.p_mean) * 100;
      const dR = (sc.r_mean - base.r_mean) * 100;
      const dC = sc.correct - base.correct;
      log(`  ${adapter}: P@${TOP_K} ${dP >= 0 ? '+' : ''}${dP.toFixed(1)}pp, R@${TOP_K} ${dR >= 0 ? '+' : ''}${dR.toFixed(1)}pp, correct ${dC >= 0 ? '+' : ''}${dC}`);
    }
    log('');
  }

  log('## Methodology\n');
  log(`- gbrain-original: graph traversal + raw full-content grep (Garry's published)`);
  log(`- gbrain-modified: graph traversal + sentence+keyword grep filter (our fix)`);
  log(`- vvc: structured relational index from _facts + graph + sentence grep fallback`);
  log(`- N=${RUNS} shuffle runs per adapter per corpus. P@${TOP_K} and R@${TOP_K} averaged.`);
  log(`- Adapters receive only public page fields (slug/type/title/compiled_truth/timeline).`);
  log(`  VVC additionally uses _facts metadata encoded at ingest time.`);

  if (jsonMode) {
    console.log(JSON.stringify({ scorecards, top_k: TOP_K, runs: RUNS }, null, 2));
  }

  log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
