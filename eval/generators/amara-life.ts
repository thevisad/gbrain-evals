/**
 * amara-life-v1 procedural skeleton (Day 2 of BrainBench v1 Complete plan).
 *
 * Produces deterministic fact/reference scaffolding for Amara Okafor's messy
 * week in April 2026:
 *   - 50 emails   (threads across inbox)
 *   - 300 slack   (messages across 4 channels; ~30 threads)
 *   - 20 calendar (VEVENT-shaped)
 *   -  8 meetings (transcripts)
 *   - 40 notes    (first-person journal)
 *
 * This file emits STRUCTURED FACTS ONLY — no prose. Day 3 feeds this
 * skeleton to Opus (via amara-life-gen.ts) which expands each item with
 * natural-language body/transcript/note text.
 *
 * Perturbations (the messy-synthetic-life thesis) are planted at
 * deterministic positions so the gold files can reference them by fixture_id:
 *   - 10 contradictions (same fact stated two ways in two sources)
 *   -  5 stale facts    (true at date A, superseded by date B)
 *   -  5 poison items   (adversarial prompt injection / obviously false)
 *   -  3 implicit preferences (inferable from patterns, never stated)
 *
 * Slug convention (matches eval/runner/queries/validator.ts:131 regex):
 *   emails/em-NNNN, slack/sl-NNNN, cal/evt-NNNN, meeting/mtg-NNNN,
 *   doc/<name>, note/<date>-<topic>
 *
 * Determinism: seeded LCG (Lehmer / MINSTD). Same `seed` → byte-identical
 * output. Regeneration is free; no LLM calls in this file.
 */

// ─── Types ───────────────────────────────────────────────────────────

export type PerturbationKind =
  | 'contradiction'
  | 'stale-fact'
  | 'poison'
  | 'implicit-preference';

export interface AmaraContact {
  /** World-v1 slug for the entity (e.g. 'people/mina-kapoor-47'). */
  worldSlug: string;
  name: string;
  email: string;
  slackHandle: string;
  relation: 'cofounder' | 'investor' | 'advisor' | 'peer' | 'mentor' | 'founder';
}

export interface EmailSkeleton {
  slug: string;        // emails/em-0001
  id: string;          // em-0001
  ts: string;          // ISO 8601
  from: { name: string; email: string };
  to: Array<{ name: string; email: string }>;
  subject: string;
  thread_id: string;
  in_reply_to: string | null;
  perturbation?: { kind: PerturbationKind; fixture_id: string };
}

export interface SlackSkeleton {
  slug: string;        // slack/sl-0001
  id: string;          // sl-0001
  ts: string;
  channel: string;     // '#halfway-partners' etc.
  user: { name: string; handle: string };
  thread_ts: string | null;
  mentions: string[];  // worldSlugs the message references (drives auto-linking)
  perturbation?: { kind: PerturbationKind; fixture_id: string };
}

export interface CalendarSkeleton {
  slug: string;        // cal/evt-0001
  uid: string;
  dtstart: string;     // ISO
  dtend: string;
  summary: string;
  attendees: Array<{ name: string; email: string }>;
  location?: string;
}

export interface MeetingSkeleton {
  slug: string;        // meeting/mtg-0001
  id: string;
  date: string;        // YYYY-MM-DD
  attendees: string[]; // world slugs
  source: 'circleback' | 'granola' | 'manual';
  linked_calendar?: string; // cal/evt-NNNN
  perturbation?: { kind: PerturbationKind; fixture_id: string };
}

export interface NoteSkeleton {
  slug: string;        // note/2026-03-14-orange-mode
  id: string;
  date: string;
  topic_hint: string;  // short phrase; Day 3 expands to full prose
  mentions: string[];  // world slugs + amara-life slugs
  perturbation?: { kind: PerturbationKind; fixture_id: string };
}

export interface AmaraLifeSkeleton {
  version: 1;
  schema_version: 1;
  generated_at: string;
  seed: number;
  profile: {
    slug: 'user/amara-okafor';
    name: 'Amara Okafor';
    role: 'Partner';
    firm: 'Halfway Capital';
    role_detail: string;
    // Implicit preferences (never stated in body text; inferable from patterns).
    implicit_preferences: Array<{
      fixture_id: string;
      label: string;
      surface_hint: string;
    }>;
  };
  contacts: AmaraContact[];
  emails: EmailSkeleton[];
  slack: SlackSkeleton[];
  calendar: CalendarSkeleton[];
  meetings: MeetingSkeleton[];
  notes: NoteSkeleton[];
}

// ─── Seeded PRNG (Mulberry32) ────────────────────────────────────────

// Chose Mulberry32 over Lehmer MINSTD: JS `%` on 32-bit products goes
// negative, and Lehmer needs Schrage's method or BigInt to stay in range.
// Mulberry32 is single-Math.imul-per-step, no overflow, seeds cleanly.
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, xs: T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

// ─── Contact network ──────────────────────────────────────────────────

/**
 * Default contact network used when `buildSkeleton` is called without an
 * explicit contacts[] (e.g., tests). Day 3's amara-life-gen.ts replaces this
 * with contacts resolved from eval/data/world-v1/ entities.
 */
export const DEFAULT_CONTACTS: AmaraContact[] = [
  // 1 cofounder
  { worldSlug: 'people/mina-kapoor',      name: 'Mina Kapoor',      email: 'mina@threshold-ventures.com', slackHandle: 'mina',    relation: 'cofounder' },
  // 2 investors
  { worldSlug: 'people/priya-patel',      name: 'Priya Patel',      email: 'priya@sequoia.com',            slackHandle: 'priya',   relation: 'investor' },
  { worldSlug: 'people/marcus-reid',      name: 'Marcus Reid',      email: 'mreid@a16z.com',               slackHandle: 'marcus',  relation: 'investor' },
  // 3 advisors
  { worldSlug: 'people/sarah-chen',       name: 'Sarah Chen',       email: 'sarah@chen.dev',               slackHandle: 'sarah',   relation: 'advisor' },
  { worldSlug: 'people/jordan-park',      name: 'Jordan Park',      email: 'jordan@novamind.ai',           slackHandle: 'jordan',  relation: 'founder' },
  { worldSlug: 'people/hannah-liu',       name: 'Hannah Liu',       email: 'hannah@datastream.io',         slackHandle: 'hannah',  relation: 'advisor' },
  // 6 peers
  { worldSlug: 'people/diego-alvarez',    name: 'Diego Alvarez',    email: 'diego@tartan.vc',              slackHandle: 'diego',   relation: 'peer' },
  { worldSlug: 'people/elena-rossi',      name: 'Elena Rossi',      email: 'elena@crossbeam.capital',      slackHandle: 'elena',   relation: 'peer' },
  { worldSlug: 'people/kofi-mensah',      name: 'Kofi Mensah',      email: 'kofi@beacon.vc',               slackHandle: 'kofi',    relation: 'peer' },
  { worldSlug: 'people/ravi-gupta',       name: 'Ravi Gupta',       email: 'ravi@founders-fund.com',       slackHandle: 'ravi',    relation: 'peer' },
  { worldSlug: 'people/lena-park',        name: 'Lena Park',        email: 'lena@initialized.com',         slackHandle: 'lena',    relation: 'peer' },
  { worldSlug: 'people/tomoko-sato',      name: 'Tomoko Sato',      email: 'tomoko@khosla.com',            slackHandle: 'tomoko',  relation: 'peer' },
  // 3 mentors
  { worldSlug: 'people/bill-hart',        name: 'Bill Hart',        email: 'bill@hart-ventures.com',       slackHandle: 'bill',    relation: 'mentor' },
  { worldSlug: 'people/nadia-freeman',    name: 'Nadia Freeman',    email: 'nadia@unionsq.vc',             slackHandle: 'nadia',   relation: 'mentor' },
  { worldSlug: 'people/anna-petrov',      name: 'Anna Petrov',      email: 'anna@petrov-capital.com',      slackHandle: 'anna',    relation: 'mentor' },
];

// ─── Fixed perturbation positions ────────────────────────────────────

// Indices chosen to spread across the corpus; fixed to make gold file authoring reproducible.
const CONTRADICTION_EMAIL_INDICES = [4, 11, 19];     // 3 contradictions in emails
const CONTRADICTION_MEETING_INDICES = [1, 2, 5, 6];  // 4 in meetings
const CONTRADICTION_NOTE_INDICES = [8, 17, 31];      // 3 in notes; total 10
const STALE_FACT_EMAIL_INDICES = [7, 22];            // 2
const STALE_FACT_NOTE_INDICES = [5, 19, 35];         // 3; total 5
const POISON_EMAIL_INDICES = [29, 33, 44];           // 3
const POISON_SLACK_INDICES = [178, 245];             // 2; total 5

// ─── Skeleton builder ────────────────────────────────────────────────

export interface BuildSkeletonOpts {
  seed?: number;
  contacts?: AmaraContact[];
  /** Fixed week-start date. Week runs Mon 2026-04-13 through Sun 2026-04-19. */
  weekStartIso?: string;
}

export function buildSkeleton(opts: BuildSkeletonOpts = {}): AmaraLifeSkeleton {
  const seed = opts.seed ?? 42;
  const contacts = opts.contacts ?? DEFAULT_CONTACTS;
  const weekStart = new Date(opts.weekStartIso ?? '2026-04-13T09:00:00-07:00');
  const rng = createRng(seed);

  if (contacts.length < 8) {
    throw new Error(`amara-life skeleton needs ≥8 contacts; got ${contacts.length}`);
  }

  // ── Profile + implicit preferences ──
  const profile = {
    slug: 'user/amara-okafor' as const,
    name: 'Amara Okafor' as const,
    role: 'Partner' as const,
    firm: 'Halfway Capital' as const,
    role_detail: 'Seed/Series A, focus on climate + AI infra',
    implicit_preferences: [
      {
        fixture_id: 'pref-001',
        label: 'hates-morning-meetings',
        surface_hint: 'Amara reschedules 7-8am slots to 10am+ in 3+ sources; never states it directly',
      },
      {
        fixture_id: 'pref-002',
        label: 'distrusts-founders-raising-too-fast',
        surface_hint: 'Skeptical commentary on 3 founders who raised Series B within 10 months of Series A',
      },
      {
        fixture_id: 'pref-003',
        label: 'strong-preference-climate-deals',
        surface_hint: 'Asks deeper due-diligence questions on climate deals than on other categories',
      },
    ],
  };

  const amaraSelf = { name: 'Amara Okafor', email: 'amara@halfway.vc' };

  // ── Emails ──
  const emails: EmailSkeleton[] = [];
  for (let i = 0; i < 50; i++) {
    const counterparty = pick(rng, contacts);
    const ts = new Date(weekStart.getTime() + i * 3.5 * 3600 * 1000); // spread ~3.5h apart
    const isIncoming = rng() < 0.55;
    const id = `em-${pad(i, 4)}`;
    const thread_id = `thr-${pad(Math.floor(i / 2), 4)}`;
    const in_reply_to = i > 0 && i % 2 === 1 ? `em-${pad(i - 1, 4)}` : null;

    let perturbation: EmailSkeleton['perturbation'] | undefined;
    const cIdx = CONTRADICTION_EMAIL_INDICES.indexOf(i);
    const sIdx = STALE_FACT_EMAIL_INDICES.indexOf(i);
    const pIdx = POISON_EMAIL_INDICES.indexOf(i);
    if (cIdx !== -1) perturbation = { kind: 'contradiction', fixture_id: `c-${pad(cIdx + 1, 3)}` };
    else if (sIdx !== -1) perturbation = { kind: 'stale-fact', fixture_id: `s-${pad(sIdx + 1, 3)}` };
    else if (pIdx !== -1) perturbation = { kind: 'poison', fixture_id: `poison-${pad(pIdx + 1, 3)}` };

    emails.push({
      slug: `emails/${id}`,
      id,
      ts: ts.toISOString(),
      from: isIncoming ? { name: counterparty.name, email: counterparty.email } : amaraSelf,
      to: isIncoming ? [amaraSelf] : [{ name: counterparty.name, email: counterparty.email }],
      subject: `Thread ${thread_id} re ${counterparty.name.split(' ')[0]}`,
      thread_id,
      in_reply_to,
      perturbation,
    });
  }

  // ── Slack (300 messages across 4 channels, thread-grouped) ──
  const channels = ['#halfway-partners', '#deal-flow', '#ops', '#random'];
  const slack: SlackSkeleton[] = [];
  for (let i = 0; i < 300; i++) {
    const channel = channels[i % channels.length];
    const user = i % 3 === 0
      ? { name: 'Amara Okafor', handle: 'amara' }
      : (() => {
          const c = pick(rng, contacts);
          return { name: c.name, handle: c.slackHandle };
        })();
    const ts = new Date(weekStart.getTime() + i * 20 * 60 * 1000).toISOString();
    const thread_ts = i % 10 === 0 ? null : new Date(weekStart.getTime() + Math.floor(i / 10) * 200 * 60 * 1000).toISOString();

    let perturbation: SlackSkeleton['perturbation'] | undefined;
    const pIdx = POISON_SLACK_INDICES.indexOf(i);
    if (pIdx !== -1) perturbation = { kind: 'poison', fixture_id: `poison-${pad(pIdx + 4, 3)}` };

    const mentionsCount = rng() < 0.3 ? 1 : 0;
    const mentions = mentionsCount > 0 ? [pick(rng, contacts).worldSlug] : [];

    slack.push({
      slug: `slack/sl-${pad(i, 4)}`,
      id: `sl-${pad(i, 4)}`,
      ts,
      channel,
      user,
      thread_ts,
      mentions,
      perturbation,
    });
  }

  // ── Calendar (20 events across the week) ──
  const calendar: CalendarSkeleton[] = [];
  for (let i = 0; i < 20; i++) {
    const c = pick(rng, contacts);
    const dayOffset = Math.floor(i / 4);
    const hourOffset = 9 + (i % 4) * 2;
    const dtstart = new Date(weekStart.getTime() + dayOffset * 86400000 + hourOffset * 3600000);
    const dtend = new Date(dtstart.getTime() + 30 * 60 * 1000);
    calendar.push({
      slug: `cal/evt-${pad(i, 4)}`,
      uid: `evt-${pad(i, 4)}@halfway.vc`,
      dtstart: dtstart.toISOString(),
      dtend: dtend.toISOString(),
      summary: `${c.name.split(' ')[0]} sync`,
      attendees: [amaraSelf, { name: c.name, email: c.email }],
      location: rng() < 0.3 ? 'Halfway HQ' : undefined,
    });
  }

  // ── Meetings (8 transcripts, linked to calendar events) ──
  const meetings: MeetingSkeleton[] = [];
  for (let i = 0; i < 8; i++) {
    const c = pick(rng, contacts);
    const date = new Date(weekStart.getTime() + Math.floor(i * 0.875) * 86400000);
    const id = `mtg-${pad(i, 4)}`;

    let perturbation: MeetingSkeleton['perturbation'] | undefined;
    const cIdx = CONTRADICTION_MEETING_INDICES.indexOf(i);
    if (cIdx !== -1) {
      // Meeting contradictions are c-004..c-007 (email took c-001..c-003, notes take c-008..c-010).
      perturbation = { kind: 'contradiction', fixture_id: `c-${pad(cIdx + 4, 3)}` };
    }

    meetings.push({
      slug: `meeting/${id}`,
      id,
      date: date.toISOString().slice(0, 10),
      attendees: ['user/amara-okafor', c.worldSlug],
      source: i % 2 === 0 ? 'circleback' : 'granola',
      linked_calendar: i < 20 ? `cal/evt-${pad(i * 2, 4)}` : undefined,
      perturbation,
    });
  }

  // ── Notes (40 first-person entries) ──
  const notes: NoteSkeleton[] = [];
  const topicHints = [
    'orange-mode', 'climate-thesis', 'novamind-followup', 'next-quarter-plan',
    'jordan-diligence', 'market-report-reactions', 'threshold-terms', 'sourcing-queue',
    'board-prep', 'team-1-1s', 'morning-reflection', 'weekly-review',
  ];
  for (let i = 0; i < 40; i++) {
    const date = new Date(weekStart.getTime() - i * 86400000 * 2); // backwards in time, ~80 days
    const topic = topicHints[i % topicHints.length];
    const mentions = i % 3 === 0 ? [pick(rng, contacts).worldSlug] : [];

    let perturbation: NoteSkeleton['perturbation'] | undefined;
    const cIdx = CONTRADICTION_NOTE_INDICES.indexOf(i);
    const sIdx = STALE_FACT_NOTE_INDICES.indexOf(i);
    if (cIdx !== -1) {
      perturbation = { kind: 'contradiction', fixture_id: `c-${pad(cIdx + 8, 3)}` };
    } else if (sIdx !== -1) {
      perturbation = { kind: 'stale-fact', fixture_id: `s-${pad(sIdx + 3, 3)}` };
    }

    notes.push({
      slug: `note/${date.toISOString().slice(0, 10)}-${topic}`,
      id: `note-${pad(i, 4)}`,
      date: date.toISOString().slice(0, 10),
      topic_hint: topic,
      mentions,
      perturbation,
    });
  }

  return {
    version: 1,
    schema_version: 1,
    generated_at: new Date('2026-04-19T00:00:00Z').toISOString(),
    seed,
    profile,
    contacts,
    emails,
    slack,
    calendar,
    meetings,
    notes,
  };
}

// ─── Perturbation summary ────────────────────────────────────────────

export function countPerturbations(
  skeleton: AmaraLifeSkeleton,
): Record<PerturbationKind, number> {
  const counts: Record<PerturbationKind, number> = {
    'contradiction': 0,
    'stale-fact': 0,
    'poison': 0,
    'implicit-preference': skeleton.profile.implicit_preferences.length,
  };
  const walk = (items: Array<{ perturbation?: { kind: PerturbationKind } }>) => {
    for (const it of items) if (it.perturbation) counts[it.perturbation.kind]++;
  };
  walk(skeleton.emails);
  walk(skeleton.slack);
  walk(skeleton.meetings);
  walk(skeleton.notes);
  return counts;
}

// ─── CLI smoke ────────────────────────────────────────────────────────

if (import.meta.main) {
  const skeleton = buildSkeleton();
  console.log(JSON.stringify({
    counts: {
      emails: skeleton.emails.length,
      slack: skeleton.slack.length,
      calendar: skeleton.calendar.length,
      meetings: skeleton.meetings.length,
      notes: skeleton.notes.length,
      contacts: skeleton.contacts.length,
    },
    perturbations: countPerturbations(skeleton),
    sample_slugs: {
      first_email: skeleton.emails[0].slug,
      first_slack: skeleton.slack[0].slug,
      first_cal: skeleton.calendar[0].slug,
      first_meeting: skeleton.meetings[0].slug,
      first_note: skeleton.notes[0].slug,
    },
  }, null, 2));
}
