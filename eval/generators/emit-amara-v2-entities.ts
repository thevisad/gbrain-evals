/**
 * Emit people/ and companies/ pages for amara-life-v2 corpus.
 * Pure deterministic — no LLM, no batch. Reads DEFAULT_CONTACTS_V2
 * from the skeleton and writes JSON pages to eval/data/amara-life-v2/.
 */

import { DEFAULT_CONTACTS_V2 } from './amara-life-v2.ts';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = 'eval/data/amara-life-v2';
const peopleDir = join(ROOT, 'people');
const companiesDir = join(ROOT, 'companies');
if (!existsSync(peopleDir)) mkdirSync(peopleDir, { recursive: true });
if (!existsSync(companiesDir)) mkdirSync(companiesDir, { recursive: true });

const COMPANY_BY_DOMAIN: Record<string, { slug: string; name: string }> = {
  'threshold-ventures.com': { slug: 'companies/threshold-ventures',    name: 'Threshold Ventures' },
  'sequoia.com':            { slug: 'companies/sequoia',               name: 'Sequoia Capital' },
  'a16z.com':               { slug: 'companies/a16z',                  name: 'Andreessen Horowitz' },
  'benchmark.com':          { slug: 'companies/benchmark',             name: 'Benchmark' },
  'chen.dev':               { slug: 'companies/independent',           name: 'Independent' },
  'novamind.ai':            { slug: 'companies/novamind',              name: 'Novamind AI' },
  'datastream.io':          { slug: 'companies/datastream',            name: 'Datastream' },
  'osheikh.com':            { slug: 'companies/independent',           name: 'Independent' },
  'tartan.vc':              { slug: 'companies/tartan-vc',             name: 'Tartan VC' },
  'crossbeam.capital':      { slug: 'companies/crossbeam-capital',     name: 'Crossbeam Capital' },
  'beacon.vc':              { slug: 'companies/beacon-vc',             name: 'Beacon VC' },
  'founders-fund.com':      { slug: 'companies/founders-fund',         name: 'Founders Fund' },
  'initialized.com':        { slug: 'companies/initialized',           name: 'Initialized Capital' },
  'khosla.com':             { slug: 'companies/khosla-ventures',       name: 'Khosla Ventures' },
  'accel.com':              { slug: 'companies/accel',                 name: 'Accel' },
  'hart-ventures.com':      { slug: 'companies/hart-ventures',         name: 'Hart Ventures' },
  'unionsq.vc':             { slug: 'companies/union-square-ventures', name: 'Union Square Ventures' },
  'petrov-capital.com':     { slug: 'companies/petrov-capital',        name: 'Petrov Capital' },
  'greenpulse.io':          { slug: 'companies/greenpulse',            name: 'GreenPulse' },
  'carbonledger.co':        { slug: 'companies/carbon-ledger',         name: 'Carbon Ledger' },
  'halfway.vc':             { slug: 'companies/halfway-capital',       name: 'Halfway Capital' },
};

// ── Build company map ──────────────────────────────────────────────────

interface CompanyRecord {
  name: string;
  founders: string[];
  employees: string[];
  investors: string[];
  advisors: string[];
}

const companiesMap = new Map<string, CompanyRecord>();

function getOrCreate(slug: string, name: string): CompanyRecord {
  if (!companiesMap.has(slug)) {
    companiesMap.set(slug, { name, founders: [], employees: [], investors: [], advisors: [] });
  }
  return companiesMap.get(slug)!;
}

// Halfway Capital is the anchor company
const halfway = getOrCreate('companies/halfway-capital', 'Halfway Capital');

for (const c of DEFAULT_CONTACTS_V2) {
  const domain = c.email.split('@')[1];
  const co = COMPANY_BY_DOMAIN[domain];

  if (c.relation === 'cofounder') {
    halfway.founders.push(c.worldSlug);
  } else if (c.relation === 'investor') {
    halfway.investors.push(c.worldSlug);
  } else if (c.relation === 'advisor') {
    halfway.advisors.push(c.worldSlug);
  } else if (c.relation === 'founder' && co && co.slug !== 'companies/independent') {
    const portfolioCo = getOrCreate(co.slug, co.name);
    portfolioCo.founders.push(c.worldSlug);
  } else if (c.relation === 'peer' && co && co.slug !== 'companies/independent') {
    const peerCo = getOrCreate(co.slug, co.name);
    peerCo.employees.push(c.worldSlug);
  } else if (c.relation === 'mentor' && co && co.slug !== 'companies/independent') {
    const mentorCo = getOrCreate(co.slug, co.name);
    mentorCo.employees.push(c.worldSlug);
  }
}

// ── Emit people pages ──────────────────────────────────────────────────

let pCount = 0;

// Amara herself
const amaraPage = {
  slug: 'people/amara-okafor',
  type: 'person' as const,
  title: 'Amara Okafor',
  compiled_truth: 'Amara Okafor is a Partner at Halfway Capital, focused on seed/Series A climate and AI infra investments.',
  timeline: '- **2025-04-14** | profile',
  _facts: {
    type: 'person',
    slug: 'people/amara-okafor',
    name: 'Amara Okafor',
    email: 'amara@halfway.vc',
    primary_affiliation: 'companies/halfway-capital',
  },
};
writeFileSync(join(peopleDir, 'amara-okafor.json'), JSON.stringify(amaraPage, null, 2));
pCount++;

for (const c of DEFAULT_CONTACTS_V2) {
  const domain = c.email.split('@')[1];
  const co = COMPANY_BY_DOMAIN[domain] ?? { slug: '', name: '' };
  const slug = c.worldSlug;
  const shortSlug = slug.replace('people/', '');

  const roleDesc =
    c.relation === 'cofounder' ? 'a co-founder at Halfway Capital' :
    c.relation === 'investor'  ? 'an investor in Halfway Capital\'s portfolio companies' :
    c.relation === 'advisor'   ? 'an advisor to Halfway Capital' :
    c.relation === 'mentor'    ? 'a mentor to Amara Okafor' :
    c.relation === 'founder'   ? 'a portfolio founder' :
    'a peer VC';

  const lines = [c.name + ' is ' + roleDesc + '.', 'Email: ' + c.email + '.'];
  if (co.name && co.name !== 'Independent') lines.push(c.name + ' works at ' + co.name + '.');
  lines.push('Slack: @' + c.slackHandle + '.');

  const page = {
    slug,
    type: 'person' as const,
    title: c.name,
    compiled_truth: lines.join(' '),
    timeline: '- **2025-04-14** | contact added',
    _facts: {
      type: 'person',
      slug,
      name: c.name,
      email: c.email,
      slack_handle: c.slackHandle,
      relation_to_amara: c.relation,
      primary_affiliation: (co.slug && co.slug !== 'companies/independent') ? co.slug : null,
    },
  };
  writeFileSync(join(peopleDir, shortSlug + '.json'), JSON.stringify(page, null, 2));
  pCount++;
}

// ── Emit company pages ─────────────────────────────────────────────────

let cCount = 0;
for (const [slug, co] of companiesMap) {
  const shortSlug = slug.replace('companies/', '');
  const lines: string[] = [];
  lines.push(co.name + (slug === 'companies/halfway-capital' ? ' is a venture capital firm where Amara Okafor is a Partner.' : ' is a venture capital firm.'));
  if (co.founders.length) lines.push('Founders: ' + co.founders.map(s => s.replace('people/', '')).join(', ') + '.');
  if (co.investors.length) lines.push('Investors: ' + co.investors.map(s => s.replace('people/', '')).join(', ') + '.');
  if (co.advisors.length) lines.push('Advisors: ' + co.advisors.map(s => s.replace('people/', '')).join(', ') + '.');
  if (co.employees.length) lines.push('Employees: ' + co.employees.map(s => s.replace('people/', '')).join(', ') + '.');

  const page = {
    slug,
    type: 'company' as const,
    title: co.name,
    compiled_truth: lines.join(' '),
    timeline: '- **2025-04-14** | company indexed',
    _facts: {
      type: 'company',
      slug,
      name: co.name,
      founders: co.founders,
      employees: co.employees,
      investors: co.investors,
      advisors: co.advisors,
    },
  };
  writeFileSync(join(companiesDir, shortSlug + '.json'), JSON.stringify(page, null, 2));
  cCount++;
}

console.log(`Wrote ${pCount} people pages → ${peopleDir}`);
console.log(`Wrote ${cCount} company pages → ${companiesDir}`);
console.log('Done.');
