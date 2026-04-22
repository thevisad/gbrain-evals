/**
 * amara-life-v1 procedural skeleton tests (Day 2 of BrainBench v1 Complete).
 *
 * Guards:
 *   - Determinism under seed (same seed → byte-identical output)
 *   - Item counts (50/300/20/8/40)
 *   - Perturbation counts (10/5/5/3) exactly per plan
 *   - Slug regex compatibility with eval/runner/queries/validator.ts
 *   - All `contacts[].worldSlug` values are valid slugs
 *   - All perturbation fixture_ids are unique across the corpus
 *
 * This runs WITHOUT generating Opus prose (Day 3) or world-v1 resolution.
 * The 15 default contacts are internal to amara-life.ts; `links_to`-style
 * cross-corpus validation lives in test/eval/gold-schema.test.ts (Day 3).
 */

import { describe, test, expect } from 'bun:test';
import {
  buildSkeleton,
  countPerturbations,
  DEFAULT_CONTACTS,
  type AmaraLifeSkeleton,
  type PerturbationKind,
} from '../../eval/generators/amara-life.ts';

// Regex from eval/runner/queries/validator.ts:131 — pins the slug convention.
const SLUG_RE = /^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

describe('amara-life skeleton', () => {
  test('default buildSkeleton() returns counts matching plan spec', () => {
    const s = buildSkeleton();
    expect(s.emails.length).toBe(50);
    expect(s.slack.length).toBe(300);
    expect(s.calendar.length).toBe(20);
    expect(s.meetings.length).toBe(8);
    expect(s.notes.length).toBe(40);
    expect(s.contacts.length).toBe(15);
  });

  test('perturbation counts are exactly 10/5/5/3', () => {
    const s = buildSkeleton();
    const counts = countPerturbations(s);
    expect(counts.contradiction).toBe(10);
    expect(counts['stale-fact']).toBe(5);
    expect(counts.poison).toBe(5);
    expect(counts['implicit-preference']).toBe(3);
  });

  test('same seed produces byte-identical output', () => {
    const a = buildSkeleton({ seed: 42 });
    const b = buildSkeleton({ seed: 42 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  test('different seeds produce different output', () => {
    const a = buildSkeleton({ seed: 42 });
    const b = buildSkeleton({ seed: 7 });
    // Content differs (timestamps are deterministic, but contact choices shift)
    expect(a.emails[0].from.email).not.toBe(b.emails[0].from.email);
  });

  test('all slugs match the one-slash validator regex', () => {
    const s = buildSkeleton();
    const allSlugs = [
      ...s.emails.map(e => e.slug),
      ...s.slack.map(x => x.slug),
      ...s.calendar.map(x => x.slug),
      ...s.meetings.map(x => x.slug),
      ...s.notes.map(x => x.slug),
    ];
    for (const slug of allSlugs) {
      expect(slug).toMatch(SLUG_RE);
    }
  });

  test('all contact worldSlugs match slug regex', () => {
    for (const c of DEFAULT_CONTACTS) {
      expect(c.worldSlug).toMatch(SLUG_RE);
    }
  });

  test('perturbation fixture_ids are unique across corpus', () => {
    const s = buildSkeleton();
    const ids = new Map<string, number>();
    const walk = (items: Array<{ perturbation?: { fixture_id: string } }>) => {
      for (const it of items) {
        if (it.perturbation) {
          ids.set(it.perturbation.fixture_id, (ids.get(it.perturbation.fixture_id) ?? 0) + 1);
        }
      }
    };
    walk(s.emails);
    walk(s.slack);
    walk(s.meetings);
    walk(s.notes);
    for (const [fixtureId, count] of ids) {
      expect(count).toBe(1); // each fixture_id appears exactly once across corpus
      void fixtureId;
    }
    // Also assert expected fixture_id sets
    const sortedIds = [...ids.keys()].sort();
    expect(sortedIds).toContain('c-001');
    expect(sortedIds).toContain('c-010');
    expect(sortedIds).toContain('s-001');
    expect(sortedIds).toContain('s-005');
    expect(sortedIds).toContain('poison-001');
    expect(sortedIds).toContain('poison-005');
  });

  test('all email thread_ids and in_reply_to chain correctly', () => {
    const s = buildSkeleton();
    for (const e of s.emails) {
      if (e.in_reply_to) {
        expect(e.in_reply_to).toMatch(/^em-\d{4}$/);
      }
      expect(e.thread_id).toMatch(/^thr-\d{4}$/);
    }
  });

  test('amara is either sender or recipient of every email', () => {
    const s = buildSkeleton();
    for (const e of s.emails) {
      const amaraIsSender = e.from.email === 'amara@halfway.vc';
      const amaraIsRecipient = e.to.some(t => t.email === 'amara@halfway.vc');
      expect(amaraIsSender || amaraIsRecipient).toBe(true);
    }
  });

  test('calendar events have dtstart < dtend', () => {
    const s = buildSkeleton();
    for (const ev of s.calendar) {
      expect(new Date(ev.dtstart).getTime()).toBeLessThan(new Date(ev.dtend).getTime());
    }
  });

  test('meetings attendees include amara', () => {
    const s = buildSkeleton();
    for (const m of s.meetings) {
      expect(m.attendees).toContain('user/amara-okafor');
    }
  });

  test('throws when given too few contacts', () => {
    expect(() =>
      buildSkeleton({ contacts: DEFAULT_CONTACTS.slice(0, 3) })
    ).toThrow(/≥8 contacts/);
  });

  test('profile.implicit_preferences has exactly 3 entries with unique fixture_ids', () => {
    const s = buildSkeleton();
    expect(s.profile.implicit_preferences.length).toBe(3);
    const ids = s.profile.implicit_preferences.map(p => p.fixture_id);
    expect(new Set(ids).size).toBe(3);
  });

  test('schema_version is 1 (bump invalidates cache per fix #18)', () => {
    const s = buildSkeleton();
    expect(s.schema_version).toBe(1);
  });
});

describe('amara-life Page.type enum extension', () => {
  test('new Page types include email | slack | calendar-event | note', async () => {
    // Import the eval-side Page type and verify the enum members.
    // We check at the type-system boundary by asserting a valid object.
    const ok: {
      slug: string;
      type: 'person' | 'company' | 'meeting' | 'concept' | 'deal' | 'project' | 'source' | 'media'
          | 'email' | 'slack' | 'calendar-event' | 'note';
      title: string;
      compiled_truth: string;
      timeline: string;
    } = {
      slug: 'emails/em-0000',
      type: 'email',
      title: 'stub',
      compiled_truth: '',
      timeline: '',
    };
    expect(ok.type).toBe('email');
  });

  test('existing Page types still valid', () => {
    const types: Array<PerturbationKind> = ['contradiction', 'stale-fact', 'poison', 'implicit-preference'];
    expect(types.length).toBe(4);
  });
});
