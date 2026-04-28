/**
 * amara-life-v2 procedural skeleton.
 *
 * Full-year (April 2025 – April 2026) extension of amara-life-v1. 4x scale:
 *   - 200 emails
 *   - 1200 Slack messages  (4 channels, ~120 threads)
 *   -  80 calendar events
 *   -  32 meeting transcripts
 *   - 160 notes
 *   -  24 docs (templated, no LLM)
 *
 * Perturbations (scaled proportionally from v1):
 *   - 40 contradictions (vs 10 in v1)
 *   - 20 stale facts    (vs  5 in v1)
 *   - 20 poison items   (vs  5 in v1)
 *   -  5 implicit preferences (vs 3 in v1)
 *
 * Contact network expanded to 20 contacts (was 15).
 *
 * Determinism: Mulberry32 PRNG, seed=84 (distinct from v1 seed=42).
 * Same slug conventions as v1 but output root is eval/data/amara-life-v2/.
 */

// ─── Types (re-exported from v1 where compatible) ─────────────────────

export type PerturbationKind =
  | 'contradiction'
  | 'stale-fact'
  | 'poison'
  | 'implicit-preference';

export interface AmaraContact {
  worldSlug: string;
  name: string;
  email: string;
  slackHandle: string;
  relation: 'cofounder' | 'investor' | 'advisor' | 'peer' | 'mentor' | 'founder';
}

export interface EmailSkeleton {
  slug: string;
  id: string;
  ts: string;
  from: { name: string; email: string };
  to: Array<{ name: string; email: string }>;
  subject: string;
  thread_id: string;
  in_reply_to: string | null;
  perturbation?: { kind: PerturbationKind; fixture_id: string };
}

export interface SlackSkeleton {
  slug: string;
  id: string;
  ts: string;
  channel: string;
  user: { name: string; handle: string };
  thread_ts: string | null;
  mentions: string[];
  perturbation?: { kind: PerturbationKind; fixture_id: string };
}

export interface CalendarSkeleton {
  slug: string;
  uid: string;
  dtstart: string;
  dtend: string;
  summary: string;
  attendees: Array<{ name: string; email: string }>;
  location?: string;
}

export interface MeetingSkeleton {
  slug: string;
  id: string;
  date: string;
  attendees: string[];
  source: 'circleback' | 'granola' | 'manual';
  linked_calendar?: string;
  perturbation?: { kind: PerturbationKind; fixture_id: string };
}

export interface NoteSkeleton {
  slug: string;
  id: string;
  date: string;
  topic_hint: string;
  mentions: string[];
  perturbation?: { kind: PerturbationKind; fixture_id: string };
}

export interface AmaraLifeSkeletonV2 {
  version: 2;
  schema_version: 2;
  generated_at: string;
  seed: number;
  profile: {
    slug: 'user/amara-okafor';
    name: 'Amara Okafor';
    role: 'Partner';
    firm: 'Halfway Capital';
    role_detail: string;
    year_start: string;
    year_end: string;
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

// ─── Contact network (20 contacts) ──────────────────────────────────

export const DEFAULT_CONTACTS_V2: AmaraContact[] = [
  // 1 cofounder
  { worldSlug: 'people/mina-kapoor',      name: 'Mina Kapoor',      email: 'mina@threshold-ventures.com', slackHandle: 'mina',    relation: 'cofounder' },
  // 3 investors
  { worldSlug: 'people/priya-patel',      name: 'Priya Patel',      email: 'priya@sequoia.com',            slackHandle: 'priya',   relation: 'investor' },
  { worldSlug: 'people/marcus-reid',      name: 'Marcus Reid',      email: 'mreid@a16z.com',               slackHandle: 'marcus',  relation: 'investor' },
  { worldSlug: 'people/leo-vance',        name: 'Leo Vance',        email: 'lvance@benchmark.com',         slackHandle: 'leo',     relation: 'investor' },
  // 4 advisors
  { worldSlug: 'people/sarah-chen',       name: 'Sarah Chen',       email: 'sarah@chen.dev',               slackHandle: 'sarah',   relation: 'advisor' },
  { worldSlug: 'people/jordan-park',      name: 'Jordan Park',      email: 'jordan@novamind.ai',           slackHandle: 'jordan',  relation: 'founder' },
  { worldSlug: 'people/hannah-liu',       name: 'Hannah Liu',       email: 'hannah@datastream.io',         slackHandle: 'hannah',  relation: 'advisor' },
  { worldSlug: 'people/omar-sheikh',      name: 'Omar Sheikh',      email: 'omar@osheikh.com',             slackHandle: 'omar',    relation: 'advisor' },
  // 7 peers
  { worldSlug: 'people/diego-alvarez',    name: 'Diego Alvarez',    email: 'diego@tartan.vc',              slackHandle: 'diego',   relation: 'peer' },
  { worldSlug: 'people/elena-rossi',      name: 'Elena Rossi',      email: 'elena@crossbeam.capital',      slackHandle: 'elena',   relation: 'peer' },
  { worldSlug: 'people/kofi-mensah',      name: 'Kofi Mensah',      email: 'kofi@beacon.vc',               slackHandle: 'kofi',    relation: 'peer' },
  { worldSlug: 'people/ravi-gupta',       name: 'Ravi Gupta',       email: 'ravi@founders-fund.com',       slackHandle: 'ravi',    relation: 'peer' },
  { worldSlug: 'people/lena-park',        name: 'Lena Park',        email: 'lena@initialized.com',         slackHandle: 'lena',    relation: 'peer' },
  { worldSlug: 'people/tomoko-sato',      name: 'Tomoko Sato',      email: 'tomoko@khosla.com',            slackHandle: 'tomoko',  relation: 'peer' },
  { worldSlug: 'people/felix-adler',      name: 'Felix Adler',      email: 'felix@accel.com',              slackHandle: 'felix',   relation: 'peer' },
  // 3 mentors
  { worldSlug: 'people/bill-hart',        name: 'Bill Hart',        email: 'bill@hart-ventures.com',       slackHandle: 'bill',    relation: 'mentor' },
  { worldSlug: 'people/nadia-freeman',    name: 'Nadia Freeman',    email: 'nadia@unionsq.vc',             slackHandle: 'nadia',   relation: 'mentor' },
  { worldSlug: 'people/anna-petrov',      name: 'Anna Petrov',      email: 'anna@petrov-capital.com',      slackHandle: 'anna',    relation: 'mentor' },
  // 2 portfolio founders
  { worldSlug: 'people/dev-shankar',      name: 'Dev Shankar',      email: 'dev@greenpulse.io',            slackHandle: 'dev',     relation: 'founder' },
  { worldSlug: 'people/chloe-ng',         name: 'Chloe Ng',         email: 'chloe@carbonledger.co',        slackHandle: 'chloe',   relation: 'founder' },
];

// ─── Perturbation position arrays (scaled 4x from v1) ────────────────

// 40 contradictions spread across emails (12), meetings (14), notes (14)
const CONTRADICTION_EMAIL_INDICES    = [4, 11, 19, 28, 36, 44, 52, 60, 74, 90, 110, 132];
const CONTRADICTION_MEETING_INDICES  = [1, 2, 5, 6, 8, 10, 13, 16, 18, 20, 22, 24, 26, 28];
const CONTRADICTION_NOTE_INDICES     = [8, 17, 31, 42, 55, 68, 82, 95, 108, 121, 134, 145, 155, 158];

// 20 stale facts across emails (8) and notes (12)
const STALE_FACT_EMAIL_INDICES  = [7, 22, 38, 55, 72, 88, 104, 120];
const STALE_FACT_NOTE_INDICES   = [5, 19, 35, 50, 65, 80, 95, 110, 125, 140, 150, 157];

// 20 poison items across emails (12) and slack (8)
const POISON_EMAIL_INDICES = [29, 33, 44, 58, 70, 85, 100, 115, 130, 145, 162, 178];
const POISON_SLACK_INDICES = [178, 245, 350, 500, 650, 800, 950, 1100];

// ─── Skeleton builder ─────────────────────────────────────────────────

export interface BuildSkeletonV2Opts {
  seed?: number;
  contacts?: AmaraContact[];
  /** Year start: first day of the 365-day window. Default: 2025-04-14. */
  yearStartIso?: string;
}

export function buildSkeletonV2(opts: BuildSkeletonV2Opts = {}): AmaraLifeSkeletonV2 {
  const seed = opts.seed ?? 84;
  const contacts = opts.contacts ?? DEFAULT_CONTACTS_V2;
  // Full-year window: April 14 2025 → April 13 2026
  const yearStart = new Date(opts.yearStartIso ?? '2025-04-14T09:00:00-07:00');
  const yearMs = 365 * 24 * 3600 * 1000;
  const rng = createRng(seed);

  if (contacts.length < 10) {
    throw new Error(`amara-life-v2 skeleton needs ≥10 contacts; got ${contacts.length}`);
  }

  const amaraSelf = { name: 'Amara Okafor', email: 'amara@halfway.vc' };

  // ── Profile ──
  const profile = {
    slug: 'user/amara-okafor' as const,
    name: 'Amara Okafor' as const,
    role: 'Partner' as const,
    firm: 'Halfway Capital' as const,
    role_detail: 'Seed/Series A, focus on climate + AI infra',
    year_start: yearStart.toISOString().slice(0, 10),
    year_end: new Date(yearStart.getTime() + yearMs - 86400000).toISOString().slice(0, 10),
    implicit_preferences: [
      {
        fixture_id: 'pref-001',
        label: 'hates-morning-meetings',
        surface_hint: 'Amara reschedules 7-8am slots to 10am+ across 8+ sources; never states it directly',
      },
      {
        fixture_id: 'pref-002',
        label: 'distrusts-founders-raising-too-fast',
        surface_hint: 'Skeptical commentary on 5+ founders who raised follow-on within 10 months',
      },
      {
        fixture_id: 'pref-003',
        label: 'strong-preference-climate-deals',
        surface_hint: 'Asks deeper due-diligence questions on climate deals than on other categories',
      },
      {
        fixture_id: 'pref-004',
        label: 'prefers-async-over-calls',
        surface_hint: 'Sends detailed Slack/email explanations rather than scheduling calls, except for deal closings',
      },
      {
        fixture_id: 'pref-005',
        label: 'tracks-founder-consistency',
        surface_hint: 'Repeatedly cross-checks what founders told her months earlier against current claims',
      },
    ],
  };

  // ── Emails (200) ──
  const emails: EmailSkeleton[] = [];
  for (let i = 0; i < 200; i++) {
    const counterparty = pick(rng, contacts);
    // Spread ~44h apart across the year
    const ts = new Date(yearStart.getTime() + i * 44 * 3600 * 1000);
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

  // ── Slack (1200 messages across 4 channels) ──
  const channels = ['#halfway-partners', '#deal-flow', '#ops', '#random'];
  const slack: SlackSkeleton[] = [];
  for (let i = 0; i < 1200; i++) {
    const channel = channels[i % channels.length];
    const user = i % 3 === 0
      ? { name: 'Amara Okafor', handle: 'amara' }
      : (() => {
          const c = pick(rng, contacts);
          return { name: c.name, handle: c.slackHandle };
        })();
    // Spread ~26min apart across the year
    const ts = new Date(yearStart.getTime() + i * 26 * 60 * 1000).toISOString();
    const thread_ts = i % 10 === 0 ? null : new Date(yearStart.getTime() + Math.floor(i / 10) * 260 * 60 * 1000).toISOString();

    let perturbation: SlackSkeleton['perturbation'] | undefined;
    const pIdx = POISON_SLACK_INDICES.indexOf(i);
    if (pIdx !== -1) perturbation = { kind: 'poison', fixture_id: `poison-${pad(pIdx + 13, 3)}` };

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

  // ── Calendar (80 events across the year) ──
  const calendar: CalendarSkeleton[] = [];
  for (let i = 0; i < 80; i++) {
    const c = pick(rng, contacts);
    // Spread ~4.5 days apart
    const dayOffset = Math.floor(i * 4.5);
    const hourOffset = 9 + (i % 4) * 2;
    const dtstart = new Date(yearStart.getTime() + dayOffset * 86400000 + hourOffset * 3600000);
    const dtend = new Date(dtstart.getTime() + 45 * 60 * 1000);
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

  // ── Meetings (32 transcripts) ──
  const meetings: MeetingSkeleton[] = [];
  for (let i = 0; i < 32; i++) {
    const c = pick(rng, contacts);
    const dayOffset = Math.floor(i * (365 / 32));
    const date = new Date(yearStart.getTime() + dayOffset * 86400000);
    const id = `mtg-${pad(i, 4)}`;

    let perturbation: MeetingSkeleton['perturbation'] | undefined;
    const cIdx = CONTRADICTION_MEETING_INDICES.indexOf(i);
    if (cIdx !== -1) {
      // c-013..c-026 (email took c-001..c-012, notes take c-027..c-040)
      perturbation = { kind: 'contradiction', fixture_id: `c-${pad(cIdx + 13, 3)}` };
    }

    meetings.push({
      slug: `meeting/${id}`,
      id,
      date: date.toISOString().slice(0, 10),
      attendees: ['user/amara-okafor', c.worldSlug],
      source: i % 3 === 0 ? 'circleback' : i % 3 === 1 ? 'granola' : 'manual',
      linked_calendar: i < 80 ? `cal/evt-${pad(i * 2, 4)}` : undefined,
      perturbation,
    });
  }

  // ── Notes (160 first-person entries) ──
  const notes: NoteSkeleton[] = [];
  const topicHints = [
    'orange-mode', 'climate-thesis', 'novamind-followup', 'next-quarter-plan',
    'jordan-diligence', 'market-report-reactions', 'threshold-terms', 'sourcing-queue',
    'board-prep', 'team-1-1s', 'morning-reflection', 'weekly-review',
    'greenpulse-dd', 'carbonledger-update', 'portfolio-check-in', 'lp-relations',
    'investment-memo', 'sector-thesis', 'competitive-landscape', 'founder-call-notes',
  ];
  for (let i = 0; i < 160; i++) {
    // Notes span the full year backwards from the end, ~2 days apart
    const date = new Date(yearStart.getTime() + yearMs - i * 2.28 * 86400000);
    const topic = topicHints[i % topicHints.length];
    const mentions = i % 3 === 0 ? [pick(rng, contacts).worldSlug] : [];

    let perturbation: NoteSkeleton['perturbation'] | undefined;
    const cIdx = CONTRADICTION_NOTE_INDICES.indexOf(i);
    const sIdx = STALE_FACT_NOTE_INDICES.indexOf(i);
    if (cIdx !== -1) {
      perturbation = { kind: 'contradiction', fixture_id: `c-${pad(cIdx + 27, 3)}` };
    } else if (sIdx !== -1) {
      perturbation = { kind: 'stale-fact', fixture_id: `s-${pad(sIdx + 9, 3)}` };
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
    version: 2,
    schema_version: 2,
    generated_at: new Date().toISOString(),
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

// ─── Perturbation summary ─────────────────────────────────────────────

export function countPerturbationsV2(
  skeleton: AmaraLifeSkeletonV2,
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
  const skeleton = buildSkeletonV2();
  console.log(JSON.stringify({
    counts: {
      emails: skeleton.emails.length,
      slack: skeleton.slack.length,
      calendar: skeleton.calendar.length,
      meetings: skeleton.meetings.length,
      notes: skeleton.notes.length,
      contacts: skeleton.contacts.length,
    },
    year_window: { start: skeleton.profile.year_start, end: skeleton.profile.year_end },
    perturbations: countPerturbationsV2(skeleton),
    sample_slugs: {
      first_email: skeleton.emails[0].slug,
      last_email: skeleton.emails[skeleton.emails.length - 1].slug,
      first_slack: skeleton.slack[0].slug,
      first_meeting: skeleton.meetings[0].slug,
      last_note: skeleton.notes[skeleton.notes.length - 1].slug,
    },
  }, null, 2));
}
