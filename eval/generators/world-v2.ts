/**
 * World-v2 skeleton: Anchor Codec universe.
 *
 * A fictional 3-year arc (2026–2028) centered on Anchor, a seed-stage
 * data infrastructure startup building deterministic compression +
 * authenticity primitives. The world includes:
 *
 *   - Anchor itself (the focal company, ~25 employees at peak)
 *   - 8 portfolio/peer startups in adjacent spaces
 *   - 6 VC firms (seed through Series A players)
 *   - 3 strategic acquirers / large tech partners
 *   - ~60 people: Anchor team (founder + early hires), investors, advisors, peers
 *   - ~50 meetings: 1:1s, board meetings, investor calls, hiring panels, customer calls
 *   - 20 concepts: infrastructure, developer tools, go-to-market, platform strategy
 *
 * Design constraints:
 *   - No real people, no real proprietary technology details
 *   - Anchor's technology described only as "deterministic data infrastructure"
 *     and "compression + authenticity in a single pass" — never more specific
 *   - World is coherent and cross-referenced (people reference companies, meetings
 *     reference attendees, etc.)
 *   - Deterministic given seed (default 99)
 *   - Suitable as a pitch-adjacent narrative: Anchor is winning, hiring fast,
 *     getting investor attention, closing customers, expanding internationally
 */

export type EntityType = 'person' | 'company' | 'meeting' | 'concept';

export interface PersonFacts {
  type: 'person';
  slug: string;
  name: string;
  role: 'founder' | 'partner' | 'engineer' | 'advisor' | 'employee';
  title?: string;
  primary_affiliation: string;
  secondary_affiliations?: string[];
  notable_traits: string[];
  background?: string;
  joined_anchor?: string; // ISO date, for Anchor employees
}

export interface CompanyFacts {
  type: 'company';
  slug: string;
  name: string;
  category: 'startup' | 'vc' | 'acquirer' | 'mature';
  industry: string;
  description?: string;
  founded_year?: number;
  founders?: string[];
  employees?: string[];
  investors?: string[];
  advisors?: string[];
}

export interface MeetingFacts {
  type: 'meeting';
  slug: string;
  name: string;
  meeting_type: 'one_on_one' | 'board_meeting' | 'investor_call' | 'hiring_panel' | 'customer_call' | 'all_hands' | 'offsite';
  date: string;
  attendees: string[];
  topic_company?: string;
  topic?: string;
}

export interface ConceptFacts {
  type: 'concept';
  slug: string;
  name: string;
  description: string;
  related_companies: string[];
  related_people?: string[];
}

export type EntityFacts = PersonFacts | CompanyFacts | MeetingFacts | ConceptFacts;

export interface World {
  people: PersonFacts[];
  companies: CompanyFacts[];
  meetings: MeetingFacts[];
  concepts: ConceptFacts[];
}

// ─── Deterministic RNG ─────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function pickN<T>(arr: T[], n: number, rand: () => number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  }
  return out;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─── Name pools ────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Maya', 'Jordan', 'Alex', 'Casey', 'Riley', 'Morgan', 'Drew', 'Quinn', 'Blake', 'Skyler',
  'Avery', 'Emery', 'Finley', 'Harper', 'Indigo', 'Jasper', 'Keaton', 'Logan', 'Monroe', 'Nova',
  'Oakley', 'Piper', 'Reese', 'Sage', 'Tatum', 'Uri', 'Vale', 'Wren', 'Xen', 'Yael',
  'Zara', 'Ari', 'Bex', 'Cal', 'Dev', 'Eli', 'Fenn', 'Gil', 'Halo', 'Imo',
  'Jin', 'Kael', 'Lev', 'Miro', 'Nash', 'Ora', 'Paz', 'Ren', 'Sol', 'Tal',
];

const LAST_NAMES = [
  'Nakamura', 'Osei', 'Ferreira', 'Lindqvist', 'Bakker', 'Moreau', 'Hashimoto', 'Okonkwo', 'Papadopoulos', 'Svensson',
  'Khalil', 'Nguyen', 'Castillo', 'Bergmann', 'Suzuki', 'Adeyemi', 'Petrov', 'Ramirez', 'Johansson', 'Kimura',
  'Santos', 'Hoffman', 'Tanaka', 'Andersen', 'Mensah', 'Leclerc', 'Yamamoto', 'Abebe', 'Nowak', 'Fernandez',
];

// ─── Anchor team composition (canonical, named) ────────────────────────

// These are the fixed Anchor employees — fictional, consistent across all pages.
// Founder + 24 hires spread over 2026-2028.
export const ANCHOR_TEAM: Array<{
  name: string; title: string; role: PersonFacts['role']; joined: string; traits: string[]; background: string;
}> = [
  // Founder
  { name: 'Seren Voss',       title: 'Founder & CEO',              role: 'founder',   joined: '2026-01-15', traits: ['first-principles thinker', 'systems builder', 'long-term thinker'],    background: 'Former research engineer; spent 8 years reverse-engineering data encoding systems before founding Anchor' },
  // Seed hires (2026 Q1-Q2)
  { name: 'Dani Osei',        title: 'CTO',                        role: 'employee',  joined: '2026-02-01', traits: ['technical depth', 'fast-shipping'],               background: 'Former infrastructure lead at a distributed systems company; co-designed a widely-used open-source serialization library' },
  { name: 'Miro Bergmann',    title: 'Head of Product',            role: 'employee',  joined: '2026-03-15', traits: ['product-obsessed', 'design taste'],               background: 'Former PM at two developer-tools companies; led launch of an API product used by 10K+ developers' },
  { name: 'Tal Kimura',       title: 'Head of Engineering',        role: 'employee',  joined: '2026-04-01', traits: ['recruiting strength', 'collaborative'],           background: 'Built and scaled an 18-person engineering team at a Series B infrastructure startup' },
  { name: 'Nova Mensah',      title: 'Staff Engineer',             role: 'employee',  joined: '2026-04-15', traits: ['analytical', 'technical depth'],                  background: 'Compiler and runtime engineer; 6 years at two major cloud vendors' },
  { name: 'Paz Santos',       title: 'Head of Sales',              role: 'employee',  joined: '2026-05-01', traits: ['GTM-heavy', 'distribution-focused'],             background: 'First sales hire at two successful B2B companies; closed Anchor\'s first three enterprise deals' },
  // Series A hires (2026 Q3 - 2027 Q1)
  { name: 'Ari Leclerc',      title: 'Senior Engineer',            role: 'employee',  joined: '2026-07-01', traits: ['fast-shipping', 'analytical'],                    background: 'Backend systems engineer; specialized in protocol design and wire format optimization' },
  { name: 'Kael Petrov',      title: 'Senior Engineer',            role: 'employee',  joined: '2026-07-15', traits: ['technical depth', 'fast-shipping'],               background: 'Distributed systems engineer with experience in high-throughput data pipelines' },
  { name: 'Wren Johansson',   title: 'Developer Relations Lead',   role: 'employee',  joined: '2026-08-01', traits: ['storyteller', 'distribution-focused'],           background: 'Built DevRel programs at two open-source infrastructure companies; grew one community to 50K members' },
  { name: 'Fenn Adeyemi',     title: 'Senior Product Manager',     role: 'employee',  joined: '2026-08-15', traits: ['product-obsessed', 'collaborative'],             background: 'Led product for data pipelines and observability tools at a Series B SaaS company' },
  { name: 'Imo Hashimoto',    title: 'Infrastructure Engineer',    role: 'employee',  joined: '2026-09-01', traits: ['analytical', 'systems builder'],                  background: 'Cloud infrastructure and reliability engineering; 5 years at a major CDN provider' },
  { name: 'Blake Nowak',      title: 'Enterprise Account Executive', role: 'employee', joined: '2026-09-15', traits: ['GTM-heavy', 'storyteller'],                     background: 'Enterprise sales at two infrastructure companies; consistently top-quartile quota attainment' },
  { name: 'Emery Castillo',   title: 'Head of Marketing',          role: 'employee',  joined: '2026-10-01', traits: ['distribution-focused', 'storyteller'],           background: 'Led marketing for developer-tools and API companies through Series A and B growth phases' },
  { name: 'Sol Ramirez',      title: 'Senior Engineer',            role: 'employee',  joined: '2026-11-01', traits: ['fast-shipping', 'technical depth'],               background: 'Security and cryptography engineer; contributed to multiple open-source cryptographic libraries' },
  { name: 'Yael Fernandez',   title: 'Operations Lead',            role: 'employee',  joined: '2026-11-15', traits: ['systems builder', 'collaborative'],               background: 'Operations and finance at two high-growth startups through Series A-B; built Anchor\'s financial infrastructure' },
  // Growth hires (2027)
  { name: 'Sage Tanaka',      title: 'Senior Engineer',            role: 'employee',  joined: '2027-01-15', traits: ['technical depth', 'analytical'],                  background: 'Data systems and compression research background; joined from a storage infrastructure company' },
  { name: 'Finley Okonkwo',   title: 'Product Designer',           role: 'employee',  joined: '2027-02-01', traits: ['design taste', 'product-obsessed'],             background: 'Product design for developer tools and APIs; designed onboarding flows adopted by enterprise customers' },
  { name: 'Halo Svensson',    title: 'Enterprise Account Executive', role: 'employee', joined: '2027-02-15', traits: ['GTM-heavy', 'distribution-focused'],             background: 'Enterprise SaaS sales with focus on data and infrastructure categories; joined from a Series C company' },
  { name: 'Tatum Nguyen',     title: 'Data Engineer',              role: 'employee',  joined: '2027-03-01', traits: ['analytical', 'fast-shipping'],                    background: 'Analytics and data engineering; helped migrate three companies to structured-data pipelines' },
  { name: 'Reese Abebe',      title: 'Head of Partnerships',       role: 'employee',  joined: '2027-04-01', traits: ['distribution-focused', 'collaborative'],         background: 'Business development and partnerships at infrastructure and cloud companies; built integration ecosystems' },
  { name: 'Logan Lindqvist',  title: 'Senior Engineer',            role: 'employee',  joined: '2027-05-01', traits: ['systems builder', 'technical depth'],             background: 'Protocol and networking engineer; previous experience in satellite and edge computing systems' },
  { name: 'Avery Khalil',     title: 'Customer Success Lead',      role: 'employee',  joined: '2027-06-01', traits: ['collaborative', 'product-obsessed'],             background: 'Customer success and solutions engineering at two developer-tools companies; drove expansion ARR' },
  { name: 'Monroe Bakker',    title: 'Senior Engineer',            role: 'employee',  joined: '2027-07-01', traits: ['analytical', 'fast-shipping'],                    background: 'Compilers and tooling engineer; contributed to open-source build systems and package managers' },
  { name: 'Indigo Ferreira',  title: 'Head of Security',           role: 'employee',  joined: '2027-08-01', traits: ['technical depth', 'first-principles thinker'],   background: 'Applied cryptography and security engineering; advised three infrastructure companies on post-quantum PKI migration' },
  { name: 'Jasper Moreau',    title: 'VP Engineering',             role: 'employee',  joined: '2027-09-01', traits: ['recruiting strength', 'systems builder'],        background: 'Engineering leadership at two infrastructure companies through Series B and C; scaled teams from 8 to 40 engineers' },
];

// ─── VC firms (fictional, YC-adjacent tier) ───────────────────────────

const VC_FIRMS = [
  { name: 'Meridian Ventures',  slug: 'companies/meridian-ventures',  description: 'Pre-seed and seed fund focused on developer infrastructure and data systems' },
  { name: 'Crestline Capital',  slug: 'companies/crestline-capital',  description: 'Series A specialist in B2B SaaS and infrastructure; 60-company portfolio' },
  { name: 'Foundry Partners',   slug: 'companies/foundry-partners',   description: 'Early-stage generalist fund with strong infrastructure track record' },
  { name: 'Lacework Fund',      slug: 'companies/lacework-fund',      description: 'Seed fund with focus on security and compliance infrastructure' },
  { name: 'Prism Ventures',     slug: 'companies/prism-ventures',     description: 'Series A/B fund investing in AI infrastructure and data primitives' },
  { name: 'Thornfield Capital', slug: 'companies/thornfield-capital', description: 'Multi-stage fund with deep enterprise SaaS and API company expertise' },
];

// ─── Peer startups (adjacent, non-competing) ──────────────────────────

const PEER_STARTUPS = [
  { name: 'Vellum Systems',  slug: 'companies/vellum-systems',  industry: 'AI infrastructure',       description: 'LLM deployment and fine-tuning infrastructure for enterprise teams' },
  { name: 'Lattice Data',    slug: 'companies/lattice-data',    industry: 'data infrastructure',     description: 'Structured data lake and query engine for enterprise analytics' },
  { name: 'Prism Protocol',  slug: 'companies/prism-protocol',  industry: 'developer tools',         description: 'API schema validation and contract testing platform' },
  { name: 'Keel Networks',   slug: 'companies/keel-networks',   industry: 'cybersecurity',           description: 'Zero-trust network access and identity infrastructure' },
  { name: 'Forge Build',     slug: 'companies/forge-build',     industry: 'developer tools',         description: 'Incremental build system for polyglot monorepos' },
  { name: 'Umbra Storage',   slug: 'companies/umbra-storage',   industry: 'data infrastructure',     description: 'Object storage with built-in versioning and provenance tracking' },
  { name: 'Nexus Relay',     slug: 'companies/nexus-relay',     industry: 'AI infrastructure',       description: 'Managed inference routing and caching layer for foundation models' },
  { name: 'Quasar Labs',     slug: 'companies/quasar-labs',     industry: 'cybersecurity',           description: 'Post-quantum cryptography migration tooling and key management' },
];

// ─── Strategic partners / acquirers ────────────────────────────────────

const STRATEGIC_PARTNERS = [
  { name: 'Vertex Cloud',   slug: 'companies/vertex-cloud',   industry: 'cloud infrastructure', description: 'Major cloud provider with 18% enterprise market share; Anchor integration announced 2027' },
  { name: 'Helios Corp',    slug: 'companies/helios-corp',    industry: 'enterprise SaaS',      description: 'Enterprise data platform with 4,000 customers; evaluating Anchor for native compression layer' },
  { name: 'Orbit Systems',  slug: 'companies/orbit-systems',  industry: 'logistics',            description: 'Supply chain visibility platform; Anchor\'s first six-figure contract signed 2026-Q4' },
];

// ─── Concept pool (Anchor-relevant) ────────────────────────────────────

const ANCHOR_CONCEPTS = [
  { name: 'developer-led growth',        desc: 'Bottom-up adoption via individual developers before enterprise sales motion kicks in' },
  { name: 'single-pass primitives',      desc: 'Infrastructure that collapses multiple sequential operations into one atomic step, eliminating handoff errors' },
  { name: 'structured data advantage',   desc: 'Schema-aware systems achieving order-of-magnitude gains over generic-byte approaches on structured payloads' },
  { name: 'provenance at the edge',      desc: 'Embedding authenticity metadata at encoding time rather than post-hoc, preventing verification gaps' },
  { name: 'post-quantum migration',      desc: 'The 2024-2030 window for enterprises to migrate PKI infrastructure to NIST-approved PQC standards' },
  { name: 'horizontal API strategy',     desc: 'One API that applies to every structured data vertical rather than building vertical-specific products' },
  { name: 'enterprise land-and-expand',  desc: 'Entering enterprises via a single team or project, then expanding to org-wide adoption through proven ROI' },
  { name: 'infrastructure as a moat',    desc: 'Deep integration into data pipelines creates switching costs that compound with customer tenure' },
  { name: 'open-core distribution',      desc: 'Free open-source core driving adoption; enterprise features and support as the revenue layer' },
  { name: 'AI content provenance',       desc: 'The emerging regulatory and market requirement to embed origin metadata in AI-generated content' },
  { name: 'seed to Series A graduation', desc: 'The metrics and narrative arc that converts seed-stage traction into a fundable Series A story' },
  { name: 'hiring for density',          desc: 'Preferring fewer, more senior hires over larger headcount to maintain velocity without coordination overhead' },
  { name: 'customer concentration risk', desc: 'Risk of depending on one or two customers for the majority of ARR in early-stage companies' },
  { name: 'compression as compute',      desc: 'Reframing compression not as storage savings but as a reduction in transmission and processing costs' },
  { name: 'compliance-driven adoption',  desc: 'Regulatory mandates (C2PA, PQC, GDPR) creating forced adoption of provenance and authenticity infrastructure' },
  { name: 'remote-first engineering',    desc: 'Anchor\'s hiring policy: async-first, documentation-heavy, distributed team across three time zones' },
  { name: 'platform shift timing',       desc: 'The art of entering a market at the moment a platform transition makes incumbents vulnerable' },
  { name: 'founder mode',                desc: 'Maintaining deep involvement in product and engineering decisions as CEO beyond typical founder transition points' },
  { name: 'unit economics discipline',   desc: 'Keeping burn minimal and CAC/LTV ratios healthy through the seed stage to preserve runway for Series A' },
  { name: 'category creation',           desc: 'Defining a new market category rather than competing in an existing one — the bet Anchor is making with authenticated compression' },
];

// ─── World builder ─────────────────────────────────────────────────────

export function buildWorldV2(seed: number = 99): World {
  const rand = mulberry32(seed);

  // ── Companies ──

  const anchor: CompanyFacts = {
    type: 'company',
    slug: 'companies/anchor',
    name: 'Anchor Codec',
    category: 'startup',
    industry: 'data infrastructure',
    description: 'Deterministic data infrastructure — compression, authentication, and transmission in a single pass',
    founded_year: 2026,
    founders: [],
    employees: [],
    investors: [],
    advisors: [],
  };

  const vcs: CompanyFacts[] = VC_FIRMS.map(v => ({
    type: 'company' as const,
    slug: v.slug,
    name: v.name,
    category: 'vc' as const,
    industry: 'venture capital',
    description: v.description,
    employees: [],
    investors: [],
    advisors: [],
  }));

  const peers: CompanyFacts[] = PEER_STARTUPS.map(p => ({
    type: 'company' as const,
    slug: p.slug,
    name: p.name,
    category: 'startup' as const,
    industry: p.industry,
    description: p.description,
    founded_year: 2024 + Math.floor(rand() * 3),
    founders: [],
    employees: [],
    investors: [],
    advisors: [],
  }));

  const strategics: CompanyFacts[] = STRATEGIC_PARTNERS.map(s => ({
    type: 'company' as const,
    slug: s.slug,
    name: s.name,
    category: 'acquirer' as const,
    industry: s.industry,
    description: s.description,
  }));

  const allCompanies = [anchor, ...vcs, ...peers, ...strategics];

  // ── People: Anchor team ──

  const people: PersonFacts[] = [];
  const anchorSlugs: string[] = [];

  for (const member of ANCHOR_TEAM) {
    const slug = `people/${slugify(member.name)}`;
    const person: PersonFacts = {
      type: 'person',
      slug,
      name: member.name,
      role: member.role,
      title: member.title,
      primary_affiliation: 'companies/anchor',
      notable_traits: member.traits,
      background: member.background,
      joined_anchor: member.joined,
    };
    people.push(person);
    anchorSlugs.push(slug);
    if (member.role === 'founder') {
      anchor.founders!.push(slug);
    } else {
      anchor.employees!.push(slug);
    }
  }

  // ── People: VC partners (2 per firm) ──

  const vcPartnerNames = [
    ['Ora Yamamoto', 'Gil Papadopoulos'],
    ['Bex Andersen', 'Cal Suzuki'],
    ['Dev Osei', 'Eli Nakamura'],
    ['Ren Khalil', 'Uri Ramirez'],
    ['Piper Bergmann', 'Nash Moreau'],
    ['Zara Lindqvist', 'Xen Castillo'],
  ];

  const vcPartnerSlugs: string[] = [];
  for (let i = 0; i < VC_FIRMS.length; i++) {
    const vc = VC_FIRMS[i];
    const vcCo = vcs[i];
    for (const name of vcPartnerNames[i]) {
      const slug = `people/${slugify(name)}`;
      // Pick 2-4 portfolio companies this partner is active in
      const investments = pickN([anchor.slug, ...peers.map(p => p.slug)], 2 + Math.floor(rand() * 3), rand);
      const partner: PersonFacts = {
        type: 'person',
        slug,
        name,
        role: 'partner',
        title: `Partner, ${vc.name}`,
        primary_affiliation: vc.slug,
        secondary_affiliations: investments,
        notable_traits: pickN(['analytical', 'distribution-focused', 'long-term thinker', 'GTM-heavy', 'sharp pattern matcher', 'storyteller'], 2, rand),
        background: `Partner at ${vc.name}; focuses on ${pickN(['infrastructure', 'developer tools', 'data systems', 'security', 'AI applications'], 1, rand)[0]} investments`,
      };
      people.push(partner);
      vcPartnerSlugs.push(slug);
      if (!vcCo.employees) vcCo.employees = [];
      vcCo.employees.push(slug);
      // Mark them as investors in Anchor
      for (const inv of investments) {
        const co = allCompanies.find(c => c.slug === inv);
        if (co && co.investors) co.investors.push(slug);
        else if (co) co.investors = [slug];
      }
    }
  }

  // Anchor's lead investor is always Ora Yamamoto (Meridian Ventures)
  if (!anchor.investors!.includes('people/ora-yamamoto')) {
    anchor.investors!.unshift('people/ora-yamamoto');
  }

  // ── People: advisors (8 advisors to Anchor) ──

  const advisorData = [
    { name: 'Skyler Okonkwo',  title: 'Independent Advisor', traits: ['distribution-focused', 'GTM-heavy'],           bg: 'Former CRO at two infrastructure companies; helped two companies from $2M to $20M ARR' },
    { name: 'Riley Moreau',    title: 'Technical Advisor',   traits: ['technical depth', 'first-principles thinker'],  bg: 'Founding engineer at a widely-used open-source data compression project; academic background in information theory' },
    { name: 'Casey Tanaka',    title: 'GTM Advisor',         traits: ['storyteller', 'distribution-focused'],         bg: 'Enterprise sales leader at three infrastructure companies; wrote the GTM playbook Anchor is executing' },
    { name: 'Morgan Svensson', title: 'Product Advisor',     traits: ['product-obsessed', 'design taste'],            bg: 'Former CPO at two developer-tools unicorns; advises Anchor on product strategy and roadmap sequencing' },
    { name: 'Alex Petrov',     title: 'Security Advisor',    traits: ['analytical', 'technical depth'],               bg: 'Former NSA and private sector applied cryptography; advises on post-quantum migration and compliance framing' },
    { name: 'Harper Nguyen',   title: 'Market Advisor',      traits: ['sharp pattern matcher', 'long-term thinker'],  bg: 'Former analyst who mapped the structured-data infrastructure market; has been following Anchor since pre-seed' },
    { name: 'Keaton Bakker',   title: 'Enterprise Advisor',  traits: ['GTM-heavy', 'recruiting strength'],            bg: 'Former VP Enterprise at a major cloud data platform; opened Anchor\'s first Fortune 500 conversation' },
    { name: 'Avery Johansson', title: 'Ops Advisor',         traits: ['systems builder', 'collaborative'],            bg: 'COO at two high-growth SaaS companies; helped Anchor design its financial and operational infrastructure' },
  ];

  const advisorSlugs: string[] = [];
  for (const a of advisorData) {
    const slug = `people/${slugify(a.name)}`;
    const advisorPerson: PersonFacts = {
      type: 'person',
      slug,
      name: a.name,
      role: 'advisor',
      title: a.title,
      primary_affiliation: 'companies/anchor',
      notable_traits: a.traits,
      background: a.bg,
    };
    people.push(advisorPerson);
    advisorSlugs.push(slug);
    anchor.advisors!.push(slug);
  }

  // ── People: peer founders (1 per peer startup) ──

  const peerFounderNames = [
    'Lev Fernandez', 'Miro Yamamoto', 'Ora Hashimoto', 'Jin Castillo',
    'Bex Leclerc', 'Nova Ramirez', 'Tatum Andersen', 'Sol Mensah',
  ];

  for (let i = 0; i < PEER_STARTUPS.length; i++) {
    const name = peerFounderNames[i];
    const slug = `people/${slugify(name)}`;
    const peerCo = peers[i];
    const peerFounder: PersonFacts = {
      type: 'person',
      slug,
      name,
      role: 'founder',
      title: `Founder & CEO, ${peerCo.name}`,
      primary_affiliation: peerCo.slug,
      notable_traits: pickN(['product-obsessed', 'technical depth', 'fast-shipping', 'analytical', 'storyteller', 'long-term thinker'], 2, rand),
      background: `Founded ${peerCo.name} in ${peerCo.founded_year}; previously at infrastructure and developer-tools companies`,
    };
    people.push(peerFounder);
    if (!peerCo.founders) peerCo.founders = [];
    peerCo.founders.push(slug);
  }

  // ── Meetings ──

  const meetings: MeetingFacts[] = [];

  // Anchor board / investor meetings (quarterly, 2026-2028)
  const boardQuarters = [
    { date: '2026-04-15', q: 'Q1 2026', topic: 'Seed round close + first customer pipeline' },
    { date: '2026-07-15', q: 'Q2 2026', topic: 'First enterprise LOI signed + hiring plan' },
    { date: '2026-10-15', q: 'Q3 2026', topic: 'Series A preparation + ARR target' },
    { date: '2027-01-15', q: 'Q4 2026', topic: 'Series A close + international expansion' },
    { date: '2027-04-15', q: 'Q1 2027', topic: 'Enterprise pipeline + team growth to 20' },
    { date: '2027-07-15', q: 'Q2 2027', topic: 'Second enterprise contract + cloud partnership' },
    { date: '2027-10-15', q: 'Q3 2027', topic: 'Series B preparation + ARR review' },
    { date: '2028-01-15', q: 'Q4 2027', topic: 'Series B kick-off + APAC expansion' },
  ];

  for (let i = 0; i < boardQuarters.length; i++) {
    const bq = boardQuarters[i];
    const boardAttendees = [
      'people/seren-voss',
      'people/ora-yamamoto',          // lead investor always present
      'people/bex-andersen',          // Crestline partner joins after Series A
      ...(i >= 3 ? ['people/piper-bergmann'] : []),  // Prism joins Series A
      'people/dani-osei',
    ].filter((s, idx, arr) => arr.indexOf(s) === idx);

    meetings.push({
      type: 'meeting',
      slug: `meetings/anchor-board-${bq.date.slice(0, 7)}-${i}`,
      name: `Anchor Board Meeting ${bq.q}`,
      meeting_type: 'board_meeting',
      date: bq.date,
      attendees: boardAttendees,
      topic_company: 'companies/anchor',
      topic: bq.topic,
    });
  }

  // 1:1s between Seren and each investor/advisor (12 meetings)
  const oneOnOnePairs: Array<[string, string, string]> = [
    ['people/seren-voss', 'people/ora-yamamoto',  '2026-03-10'],
    ['people/seren-voss', 'people/bex-andersen',  '2026-08-22'],
    ['people/seren-voss', 'people/skyler-okonkwo', '2026-05-14'],
    ['people/seren-voss', 'people/riley-moreau',  '2026-06-03'],
    ['people/seren-voss', 'people/casey-tanaka',  '2026-09-18'],
    ['people/seren-voss', 'people/morgan-svensson', '2027-01-07'],
    ['people/seren-voss', 'people/keaton-bakker', '2027-02-20'],
    ['people/seren-voss', 'people/alex-petrov',   '2027-04-11'],
    ['people/dani-osei',  'people/tal-kimura',    '2026-05-20'],
    ['people/paz-santos', 'people/casey-tanaka',  '2026-10-05'],
    ['people/seren-voss', 'people/piper-bergmann', '2026-11-30'],
    ['people/seren-voss', 'people/harper-nguyen', '2027-06-15'],
  ];

  for (let i = 0; i < oneOnOnePairs.length; i++) {
    const [a, b, date] = oneOnOnePairs[i];
    const personA = people.find(p => p.slug === a);
    const personB = people.find(p => p.slug === b);
    meetings.push({
      type: 'meeting',
      slug: `meetings/oneonone-${i}-${date}`,
      name: `1:1 ${personA?.name ?? a} + ${personB?.name ?? b}`,
      meeting_type: 'one_on_one',
      date,
      attendees: [a, b],
      topic_company: 'companies/anchor',
    });
  }

  // Investor calls (Series A process, 2026 Q3-Q4)
  const investorCalls = [
    { date: '2026-09-05', vc: 'people/cal-suzuki',   firm: 'Crestline Capital', topic: 'Series A intro call' },
    { date: '2026-09-12', vc: 'people/piper-bergmann', firm: 'Prism Ventures',  topic: 'Initial meeting — compression market overview' },
    { date: '2026-09-22', vc: 'people/nash-moreau',  firm: 'Foundry Partners',  topic: 'Diligence call — technical deep dive' },
    { date: '2026-10-03', vc: 'people/bex-andersen', firm: 'Crestline Capital', topic: 'Partner meeting — go-to-market discussion' },
    { date: '2026-10-14', vc: 'people/piper-bergmann', firm: 'Prism Ventures',  topic: 'Term sheet discussion' },
    { date: '2026-11-02', vc: 'people/xen-castillo', firm: 'Thornfield Capital', topic: 'Late-stage Series A interest — enterprise focus' },
  ];

  for (let i = 0; i < investorCalls.length; i++) {
    const ic = investorCalls[i];
    meetings.push({
      type: 'meeting',
      slug: `meetings/investor-call-${i}-${ic.date}`,
      name: `Investor Call — ${ic.firm}`,
      meeting_type: 'investor_call',
      date: ic.date,
      attendees: ['people/seren-voss', ic.vc],
      topic_company: 'companies/anchor',
      topic: ic.topic,
    });
  }

  // Customer calls (key milestones)
  const customerCalls = [
    { date: '2026-06-10', customer: 'companies/orbit-systems',  attendees: ['people/seren-voss', 'people/paz-santos'], topic: 'Initial enterprise pilot scoping — Orbit Systems' },
    { date: '2026-08-05', customer: 'companies/orbit-systems',  attendees: ['people/seren-voss', 'people/paz-santos', 'people/dani-osei'], topic: 'Pilot review — Orbit Systems ($120K contract close)' },
    { date: '2026-12-10', customer: 'companies/helios-corp',    attendees: ['people/seren-voss', 'people/paz-santos', 'people/blake-nowak'], topic: 'Enterprise evaluation kickoff — Helios Corp' },
    { date: '2027-03-15', customer: 'companies/vertex-cloud',   attendees: ['people/seren-voss', 'people/dani-osei', 'people/reese-abebe'], topic: 'Cloud partnership scoping — Vertex Cloud integration' },
    { date: '2027-08-20', customer: 'companies/helios-corp',    attendees: ['people/paz-santos', 'people/blake-nowak', 'people/avery-khalil'], topic: 'Helios Corp expansion — org-wide rollout discussion' },
  ];

  for (let i = 0; i < customerCalls.length; i++) {
    const cc = customerCalls[i];
    meetings.push({
      type: 'meeting',
      slug: `meetings/customer-call-${i}-${cc.date}`,
      name: `Customer Call — ${cc.customer.replace('companies/', '')} ${cc.date.slice(0, 7)}`,
      meeting_type: 'customer_call',
      date: cc.date,
      attendees: cc.attendees,
      topic_company: cc.customer,
      topic: cc.topic,
    });
  }

  // Hiring panels (key hires)
  const hiringPanels = [
    { date: '2026-03-20', candidate: 'Dani Osei',       role: 'CTO',             panel: ['people/seren-voss', 'people/riley-moreau'] },
    { date: '2026-09-08', candidate: 'Wren Johansson',  role: 'DevRel Lead',     panel: ['people/seren-voss', 'people/miro-bergmann', 'people/paz-santos'] },
    { date: '2026-10-12', candidate: 'Emery Castillo',  role: 'Head of Marketing', panel: ['people/seren-voss', 'people/paz-santos'] },
    { date: '2027-08-15', candidate: 'Jasper Moreau',   role: 'VP Engineering',  panel: ['people/seren-voss', 'people/dani-osei', 'people/tal-kimura'] },
    { date: '2027-09-05', candidate: 'Indigo Ferreira', role: 'Head of Security', panel: ['people/seren-voss', 'people/dani-osei', 'people/sol-ramirez'] },
  ];

  for (let i = 0; i < hiringPanels.length; i++) {
    const hp = hiringPanels[i];
    meetings.push({
      type: 'meeting',
      slug: `meetings/hiring-panel-${i}-${hp.date}`,
      name: `Hiring Panel — ${hp.role}`,
      meeting_type: 'hiring_panel',
      date: hp.date,
      attendees: hp.panel,
      topic_company: 'companies/anchor',
      topic: `Interview panel for ${hp.candidate} (${hp.role})`,
    });
  }

  // All-hands (quarterly company meetings)
  const allHandsDates = ['2026-04-01', '2026-07-01', '2026-10-01', '2027-01-03', '2027-04-03', '2027-07-03', '2027-10-02', '2028-01-08'];
  for (let i = 0; i < allHandsDates.length; i++) {
    const date = allHandsDates[i];
    const quarter = `Q${(i % 4) + 1} ${2026 + Math.floor(i / 4)}`;
    // All-hands: Seren + dept leads present at the time
    const presentAtTime = anchorSlugs.filter(s => {
      const member = ANCHOR_TEAM.find(m => `people/${slugify(m.name)}` === s);
      return member && member.joined <= date;
    });
    meetings.push({
      type: 'meeting',
      slug: `meetings/all-hands-${date}`,
      name: `Anchor All-Hands ${quarter}`,
      meeting_type: 'all_hands',
      date,
      attendees: presentAtTime.slice(0, 8), // cap for schema — full team implied
      topic_company: 'companies/anchor',
      topic: `Company all-hands — ${quarter} review, OKRs, and roadmap`,
    });
  }

  // ── Concepts ──

  const concepts: ConceptFacts[] = ANCHOR_CONCEPTS.map((c, i) => ({
    type: 'concept' as const,
    slug: `concepts/${slugify(c.name)}`,
    name: c.name,
    description: c.desc,
    related_companies: pickN([anchor.slug, ...peers.map(p => p.slug), ...vcs.map(v => v.slug)], 2 + Math.floor(rand() * 2), rand),
    related_people: pickN(people.map(p => p.slug), 2, rand),
  }));

  return {
    people,
    companies: allCompanies,
    meetings,
    concepts,
  };
}

// ─── CLI smoke test ────────────────────────────────────────────────────

if (import.meta.main) {
  const world = buildWorldV2(99);
  console.log(`World-v2 built:`);
  console.log(`  People:    ${world.people.length}`);
  console.log(`  Companies: ${world.companies.length}`);
  console.log(`  Meetings:  ${world.meetings.length}`);
  console.log(`  Concepts:  ${world.concepts.length}`);
  console.log(`  Total:     ${world.people.length + world.companies.length + world.meetings.length + world.concepts.length}`);
  console.log('\nAnchor team:', world.people.filter(p => p.primary_affiliation === 'companies/anchor').map(p => `${p.name} (${p.title})`).join(', '));
  const anchor = world.companies.find(c => c.slug === 'companies/anchor')!;
  console.log('\nAnchor investors:', anchor.investors?.join(', '));
  console.log('Anchor advisors:', anchor.advisors?.join(', '));
}
