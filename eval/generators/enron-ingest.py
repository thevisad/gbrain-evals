"""
enron-ingest.py  —  Enron email corpus → BrainBench RichPage JSON

Reads corbt/enron-emails from HuggingFace (517k rows) and emits:
  eval/data/enron-v1/
    people__<slug>.json        ~150 Enron employees + top external contacts
    companies__<slug>.json     Enron + top external companies by email volume
    meetings__<slug>.json      Detected meeting threads with attendees
    threads__<slug>.json       Major email conversation threads
    concepts__<slug>.json      Hardcoded Enron topic pages (~15)
    _manifest.json

All pages match the world-v1 RichPage format so three-way-compare.ts
loads them with loadWorldV2()-style subdir or flat-file loader.

Usage:
    python eval/generators/enron-ingest.py --dry-run
    python eval/generators/enron-ingest.py
    python eval/generators/enron-ingest.py --max 50000
    python eval/generators/enron-ingest.py --output-dir eval/data/enron-v1
    python eval/generators/enron-ingest.py --hf-cache-dir D:/hf-cache
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple

# ─── Dependency check ────────────────────────────────────────────────────────

def check_deps():
    missing = []
    try:
        import datasets  # noqa: F401
    except ImportError:
        missing.append("datasets")
    if missing:
        print(f"Missing dependencies: {', '.join(missing)}")
        print(f"Install with: pip install {' '.join(missing)}")
        sys.exit(1)

# ─── Employee map (username → full name, canonical email) ────────────────────

EMPLOYEE_MAP: Dict[str, Tuple[str, str]] = {
    "allen-p":          ("Phillip Allen",         "phillip.allen@enron.com"),
    "arnold-j":         ("John Arnold",           "john.arnold@enron.com"),
    "arora-h":          ("Harry Arora",           "harry.arora@enron.com"),
    "bass-e":           ("Eric Bass",             "eric.bass@enron.com"),
    "beck-s":           ("Sally Beck",            "sally.beck@enron.com"),
    "blair-l":          ("Lynn Blair",            "lynn.blair@enron.com"),
    "buy-r":            ("Rick Buy",              "rick.buy@enron.com"),
    "campbell-l":       ("Larry Campbell",        "larry.campbell@enron.com"),
    "cash-m":           ("Michelle Cash",         "michelle.cash@enron.com"),
    "dasovich-j":       ("Jeff Dasovich",         "jeff.dasovich@enron.com"),
    "davis-d":          ("Dana Davis",            "dana.davis@enron.com"),
    "davis-p":          ("Pete Davis",            "pete.davis@enron.com"),
    "delainey-d":       ("David Delainey",        "david.delainey@enron.com"),
    "derrick-j":        ("James Derrick",         "james.derrick@enron.com"),
    "dickson-s":        ("Stacy Dickson",         "stacy.dickson@enron.com"),
    "donohoe-t":        ("Tom Donohoe",           "tom.donohoe@enron.com"),
    "dorland-c":        ("Craig Dorland",         "craig.dorland@enron.com"),
    "ermis-f":          ("Frank Ermis",           "frank.ermis@enron.com"),
    "farmer-d":         ("Daren Farmer",          "daren.farmer@enron.com"),
    "forney-j":         ("John Forney",           "john.forney@enron.com"),
    "fossum-d":         ("Drew Fossum",           "drew.fossum@enron.com"),
    "grigsby-m":        ("Mike Grigsby",          "mike.grigsby@enron.com"),
    "haedicke-m":       ("Mark Haedicke",         "mark.haedicke@enron.com"),
    "hayslett-r":       ("Rod Hayslett",          "rod.hayslett@enron.com"),
    "heard-m":          ("Marie Heard",           "marie.heard@enron.com"),
    "hendrickson-s":    ("Steve Hendrickson",     "steve.hendrickson@enron.com"),
    "hernandez-j":      ("Jose Hernandez",        "jose.hernandez@enron.com"),
    "horton-s":         ("Stanley Horton",        "stanley.horton@enron.com"),
    "hyatt-k":          ("Kevin Hyatt",           "kevin.hyatt@enron.com"),
    "kaminski-v":       ("Vince Kaminski",        "vince.kaminski@enron.com"),
    "kean-s":           ("Steven Kean",           "steven.kean@enron.com"),
    "keiser-k":         ("Kristina Keiser",       "kristina.keiser@enron.com"),
    "kitchen-l":        ("Louise Kitchen",        "louise.kitchen@enron.com"),
    "lavorato-j":       ("John Lavorato",         "john.lavorato@enron.com"),
    "lay-k":            ("Kenneth Lay",           "kenneth.lay@enron.com"),
    "lewis-a":          ("Andrew Lewis",          "andrew.lewis@enron.com"),
    "linder-e":         ("Eric Linder",           "eric.linder@enron.com"),
    "lokay-m":          ("Martin Lokay",          "martin.lokay@enron.com"),
    "lokey-t":          ("Tana Lokey",            "tana.lokey@enron.com"),
    "mann-k":           ("Kay Mann",              "kay.mann@enron.com"),
    "martin-t":         ("Thomas Martin",         "thomas.martin@enron.com"),
    "may-l":            ("Larry May",             "larry.may@enron.com"),
    "mcconnell-m":      ("Mike McConnell",        "mike.mcconnell@enron.com"),
    "mckay-b":          ("Bill McKay",            "bill.mckay@enron.com"),
    "mims-thurston-p":  ("Patrice Mims-Thurston", "patrice.mims-thurston@enron.com"),
    "motley-b":         ("Brian Motley",          "brian.motley@enron.com"),
    "neal-s":           ("Scott Neal",            "scott.neal@enron.com"),
    "nemec-g":          ("Gerald Nemec",          "gerald.nemec@enron.com"),
    "novosel-s":        ("Sarah Novosel",         "sarah.novosel@enron.com"),
    "panus-s":          ("Shona Panus",           "shona.panus@enron.com"),
    "pereira-s":        ("Susan Pereira",         "susan.pereira@enron.com"),
    "perlingiere-d":    ("Dana Perlingiere",      "dana.perlingiere@enron.com"),
    "phanis-s":         ("Scott Phanis",          "scott.phanis@enron.com"),
    "pickard-c":        ("Charles Pickard",       "charles.pickard@enron.com"),
    "platter-p":        ("Phillip Platter",       "phillip.platter@enron.com"),
    "quenet-j":         ("Jean Quenet",           "jean.quenet@enron.com"),
    "reitmeyer-j":      ("Jennifer Reitmeyer",    "jennifer.reitmeyer@enron.com"),
    "richey-c":         ("Carol Richey",          "carol.richey@enron.com"),
    "ring-a":           ("Amanda Ring",           "amanda.ring@enron.com"),
    "rodrique-r":       ("Rod Rodrique",          "rod.rodrique@enron.com"),
    "rogers-b":         ("Brad Rogers",           "brad.rogers@enron.com"),
    "ruscitti-k":       ("Kimberly Ruscitti",     "kimberly.ruscitti@enron.com"),
    "sager-e":          ("Elizabeth Sager",       "elizabeth.sager@enron.com"),
    "salisbury-m":      ("Matt Salisbury",        "matt.salisbury@enron.com"),
    "sanchez-m":        ("Mark Sanchez",          "mark.sanchez@enron.com"),
    "sanders-r":        ("Richard Sanders",       "richard.sanders@enron.com"),
    "scholtes-d":       ("Diana Scholtes",        "diana.scholtes@enron.com"),
    "scott-s":          ("Susan Scott",           "susan.scott@enron.com"),
    "semperger-c":      ("Carol Semperger",       "carol.semperger@enron.com"),
    "shankman-j":       ("Jeffrey Shankman",      "jeffrey.shankman@enron.com"),
    "shapiro-r":        ("Richard Shapiro",       "richard.shapiro@enron.com"),
    "shively-h":        ("Hunter Shively",        "hunter.shively@enron.com"),
    "skilling-j":       ("Jeffrey Skilling",      "jeffrey.skilling@enron.com"),
    "slinger-r":        ("Rod Slinger",           "rod.slinger@enron.com"),
    "smith-m":          ("Mike Smith",            "mike.smith@enron.com"),
    "solberg-g":        ("Gordon Solberg",        "gordon.solberg@enron.com"),
    "south-s":          ("Scott South",           "scott.south@enron.com"),
    "staab-t":          ("Todd Staab",            "todd.staab@enron.com"),
    "stclair-c":        ("Cara StClair",          "cara.stclair@enron.com"),
    "steffes-j":        ("James Steffes",         "james.steffes@enron.com"),
    "storey-g":         ("Geoff Storey",          "geoff.storey@enron.com"),
    "sturm-f":          ("Fletcher Sturm",        "fletcher.sturm@enron.com"),
    "symes-k":          ("Kate Symes",            "kate.symes@enron.com"),
    "taylor-m":         ("Mark Taylor",           "mark.taylor@enron.com"),
    "thomas-p":         ("Paul Thomas",           "paul.thomas@enron.com"),
    "tycholiz-b":       ("Barry Tycholiz",        "barry.tycholiz@enron.com"),
    "ward-k":           ("Kay Ward",              "kay.ward@enron.com"),
    "watson-k":         ("Kimberly Watson",       "kimberly.watson@enron.com"),
    "weldon-c":         ("Carol Weldon",          "carol.weldon@enron.com"),
    "whalley-g":        ("Greg Whalley",          "greg.whalley@enron.com"),
    "williams-j":       ("Jason Williams",        "jason.williams@enron.com"),
    "williams-w3":      ("Willie Williams",       "willie.williams@enron.com"),
    "wolfe-t":          ("Travis Wolfe",          "travis.wolfe@enron.com"),
    "ybarbo-p":         ("Paul Ybarbo",           "paul.ybarbo@enron.com"),
    "zipper-a":         ("Andrew Zipper",         "andrew.zipper@enron.com"),
    "kaufman-p":        ("Paul Kaufman",          "paul.kaufman@enron.com"),
    "mara-s":           ("Susan Mara",            "susan.mara@enron.com"),
    "mccubbin-s":       ("Sandra McCubbin",       "sandra.mccubbin@enron.com"),
    "guzman-m":         ("Mark Guzman",           "mark.guzman@enron.com"),
    "love-p":           ("Phillip Love",          "phillip.love@enron.com"),
    "meyers-a":         ("Alan Meyers",           "alan.meyers@enron.com"),
    "geaccone-t":       ("Tracy Geaccone",        "tracy.geaccone@enron.com"),
    "gilbertsmith-d":   ("D. Gilbertsmith",       "d.gilbertsmith@enron.com"),
    "jones-t":          ("Tana Jones",            "tana.jones@enron.com"),
    "townsend-j":       ("Julie Townsend",        "julie.townsend@enron.com"),
}

# Build reverse: canonical email → (full_name, slug)
EMAIL_TO_EMPLOYEE: Dict[str, Tuple[str, str]] = {}
for _uname, (_fullname, _email) in EMPLOYEE_MAP.items():
    _slug = "people/" + re.sub(r"[^a-z0-9]+", "-", _fullname.lower()).strip("-")
    EMAIL_TO_EMPLOYEE[_email] = (_fullname, _slug)

# Internal Enron domain variants all map to the same company
ENRON_DOMAINS: Set[str] = {
    "enron.com", "ect.enron.com", "ees.enron.com",
    "epsc.enron.com", "na.enron.com", "enron.net",
    "corp.enron.com", "eks.enron.com",
}

# Addresses that should not become person pages (role/list addresses)
ROLE_ADDRESS_BLOCKLIST: Set[str] = {
    "all.employees@enron.com", "helpdesk@enron.com",
    "enron.announcements@enron.com", "noreply@enron.com",
    "listserv@enron.com", "undisclosed-recipients",
}

# ─── Known external companies ────────────────────────────────────────────────

KNOWN_COMPANIES: Dict[str, Tuple[str, str]] = {
    # domain → (display_name, slug_stem)
    "enron.com":              ("Enron",                     "enron"),
    "ect.enron.com":          ("Enron",                     "enron"),
    "ees.enron.com":          ("Enron",                     "enron"),
    "epsc.enron.com":         ("Enron",                     "enron"),
    "na.enron.com":           ("Enron",                     "enron"),
    "enron.net":              ("Enron",                     "enron"),
    "corp.enron.com":         ("Enron",                     "enron"),
    "eks.enron.com":          ("Enron",                     "enron"),
    "kslaw.com":              ("King & Spalding",            "king-and-spalding"),
    "caiso.com":              ("CAISO",                     "caiso"),
    "bpa.gov":                ("Bonneville Power Admin",    "bpa"),
    "ferc.gov":               ("FERC",                      "ferc"),
    "sec.gov":                ("SEC",                       "sec"),
    "doj.gov":                ("DOJ",                       "doj"),
    "doe.gov":                ("US Dept of Energy",         "doe"),
    "vinson-elkins.com":      ("Vinson & Elkins",           "vinson-elkins"),
    "velaw.com":              ("Vinson & Elkins",           "vinson-elkins"),
    "andrewskurth.com":       ("Andrews Kurth",             "andrews-kurth"),
    "akllp.com":              ("Andrews Kurth",             "andrews-kurth"),
    "reliantenergy.com":      ("Reliant Energy",            "reliant-energy"),
    "dynegy.com":             ("Dynegy",                    "dynegy"),
    "elpaso.com":             ("El Paso Energy",            "el-paso"),
    "epelectric.com":         ("El Paso Energy",            "el-paso"),
    "pgande.com":             ("PG&E",                      "pge"),
    "pge.com":                ("PG&E",                      "pge"),
    "sempra.com":             ("Sempra Energy",             "sempra"),
    "williams.com":           ("Williams Companies",        "williams"),
    "marathon.com":           ("Marathon Oil",              "marathon"),
    "duke-energy.com":        ("Duke Energy",               "duke-energy"),
    "dukeenergy.com":         ("Duke Energy",               "duke-energy"),
    "andersonkill.com":       ("Anderson Kill",             "anderson-kill"),
    "bracewell.com":          ("Bracewell & Patterson",     "bracewell"),
    "bracepatt.com":          ("Bracewell & Patterson",     "bracewell"),
    "calpine.com":            ("Calpine",                   "calpine"),
    "mirant.com":             ("Mirant",                    "mirant"),
    "southernco.com":         ("Southern Company",          "southern-company"),
    "psnc.com":               ("Progress Energy",           "progress-energy"),
    "nisource.com":           ("NiSource",                  "nisource"),
    "oatiinc.com":            ("OATI",                      "oati"),
    "cambridge-energy.com":   ("Cambridge Energy Research", "cera"),
    "cera.com":               ("Cambridge Energy Research", "cera"),
    "mckinsey.com":           ("McKinsey",                  "mckinsey"),
    "accenture.com":          ("Accenture",                 "accenture"),
    "arthurandersen.com":     ("Arthur Andersen",           "arthur-andersen"),
    "aol.com":                ("AOL",                       "aol"),
    "yahoo.com":              ("Yahoo",                     "yahoo"),
    "hotmail.com":            ("Hotmail / MSN",             "hotmail"),
    "msn.com":                ("MSN",                       "msn"),
    "gmail.com":              ("Gmail",                     "gmail"),
}

def domain_of(addr: str) -> str:
    addr = addr.strip().lower()
    if "@" not in addr:
        return ""
    return addr.split("@", 1)[1]

def company_slug_for_domain(domain: str) -> str:
    if domain in KNOWN_COMPANIES:
        return "companies/" + KNOWN_COMPANIES[domain][1]
    stem = domain.split(".")[0]
    return "companies/" + re.sub(r"[^a-z0-9]+", "-", stem).strip("-")

def company_name_for_domain(domain: str) -> str:
    if domain in KNOWN_COMPANIES:
        return KNOWN_COMPANIES[domain][0]
    return domain.split(".")[0].capitalize()

# ─── Slug utilities ──────────────────────────────────────────────────────────

_ADDR_RE = re.compile(r"^[^@]+@[^@]+\.[^@]+$")

def is_valid_address(addr: str) -> bool:
    addr = addr.strip()
    return bool(addr) and bool(_ADDR_RE.match(addr)) and addr not in ROLE_ADDRESS_BLOCKLIST

def person_slug_for_address(addr: str) -> str:
    addr = addr.strip().lower()
    # Known Enron employee?
    if addr in EMAIL_TO_EMPLOYEE:
        return EMAIL_TO_EMPLOYEE[addr][1]
    # Internal Enron domain not in map — derive from local part
    domain = domain_of(addr)
    local = addr.split("@")[0] if "@" in addr else addr
    base = re.sub(r"[^a-z0-9]+", "-", local).strip("-")
    if domain in ENRON_DOMAINS:
        return f"people/{base}"
    # External — append domain stem to avoid collisions
    dom_stem = re.sub(r"[^a-z0-9]+", "-", domain.split(".")[0]).strip("-")
    return f"people/{base}-{dom_stem}"

def slugify(s: str, maxlen: int = 60) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:maxlen]

# ─── Meeting detection ───────────────────────────────────────────────────────

_MEET_SUBJECT_RE = re.compile(
    r"\b(meet(ing)?|call|conference|conf\.?\s*call|webcast|"
    r"mtg\.?|agenda|re\s*schedul|cancel(l?ed)?|postpone|"
    r"invitation|reminder|briefing|offsite|kick.?off|"
    r"townhall|town\s*hall|all.?hands|one.?on.?one|1:1)\b",
    re.IGNORECASE
)
_MEET_BODY_RE = re.compile(
    r"(?:^|\n)\s*(Date|Time|Location|Place|Attendees|Required|Optional)\s*:",
    re.IGNORECASE
)

def is_meeting_email(row: Dict) -> bool:
    fname = (row.get("file_name") or "").lower()
    if "/calendar/" in fname or "/_calendar/" in fname:
        return True
    subj = row.get("subject") or ""
    if _MEET_SUBJECT_RE.search(subj):
        return True
    body = row.get("body") or ""
    matches = _MEET_BODY_RE.findall(body[:2000])
    return len(matches) >= 2

# ─── Subject normalisation (for threading/meeting grouping) ─────────────────

_PREFIX_RE = re.compile(
    r"^(re|fw|fwd|forward|re:\s*\[\d+\]|aw|sv|wg)\s*:?\s*",
    re.IGNORECASE
)
_BRACKET_RE = re.compile(r"\[.*?\]|\(.*?\)")
_WS_RE = re.compile(r"\s+")
_NOISE_WORDS = {"canceled", "rescheduled", "updated", "reminder", "accepted",
                "tentative", "declined", "invitation", "re", "fw", "fwd"}

def normalise_subject(subj: str) -> str:
    s = subj.strip()
    for _ in range(5):
        m = _PREFIX_RE.match(s)
        if m:
            s = s[m.end():].strip()
        else:
            break
    s = _BRACKET_RE.sub("", s)
    s = _WS_RE.sub(" ", s).strip().lower()
    # Remove leading noise words
    words = s.split()
    words = [w for w in words if w not in _NOISE_WORDS or len(words) == 1]
    return " ".join(words)[:100]

# ─── Date parsing ────────────────────────────────────────────────────────────

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_SENTINEL = datetime(1970, 1, 1, tzinfo=timezone.utc)

def parse_date(row: Dict) -> datetime:
    d = row.get("date")
    if d is None:
        return _SENTINEL
    if isinstance(d, datetime):
        if d.tzinfo is None:
            return d.replace(tzinfo=timezone.utc)
        return d
    try:
        import email.utils
        t = email.utils.parsedate_to_datetime(str(d))
        return t
    except Exception:
        pass
    try:
        return datetime.fromisoformat(str(d).replace("Z", "+00:00"))
    except Exception:
        return _SENTINEL

# ─── Address list helpers ────────────────────────────────────────────────────

def clean_addrs(field) -> List[str]:
    if not field:
        return []
    if isinstance(field, str):
        field = [field]
    out = []
    for a in field:
        a = str(a).strip().lower()
        if a and a != "none" and is_valid_address(a):
            out.append(a)
    return out

def all_participants(row: Dict) -> List[str]:
    addrs = (
        clean_addrs(row.get("from")) +
        clean_addrs(row.get("to")) +
        clean_addrs(row.get("cc")) +
        clean_addrs(row.get("bcc"))
    )
    seen: Set[str] = set()
    unique = []
    for a in addrs:
        if a not in seen:
            seen.add(a)
            unique.append(a)
    return unique

# ─── Concept pages (hardcoded) ───────────────────────────────────────────────

CONCEPT_PAGES = [
    {
        "slug": "concepts/california-energy-crisis",
        "title": "California Energy Crisis 2000–2001",
        "description": "The 2000–2001 California electricity crisis, Enron's trading strategies, and FERC investigations into market manipulation.",
        "related_companies": ["companies/enron", "companies/caiso", "companies/ferc", "companies/reliant-energy"],
        "timeline_entries": [
            "**2000-06-01** | California electricity market deregulation fully takes effect",
            "**2000-12-01** | Rolling blackouts begin across California",
            "**2001-01-17** | California Governor declares state of emergency",
            "**2001-06-19** | FERC opens investigation into Western energy market manipulation",
            "**2002-05-06** | FERC releases transcripts showing Enron traders discussing market strategies",
        ],
    },
    {
        "slug": "concepts/mark-to-market-accounting",
        "title": "Mark-to-Market Accounting",
        "description": "Enron's aggressive use of mark-to-market accounting, approved by the SEC in 1992, allowed the company to book estimated future profits from long-term contracts as current earnings — inflating reported revenues.",
        "related_companies": ["companies/enron", "companies/sec", "companies/arthur-andersen"],
        "timeline_entries": [
            "**1992-01-30** | SEC approves Enron's request to use mark-to-market accounting",
            "**2000-12-31** | Enron reports $100B in revenues, much mark-to-market",
            "**2001-10-16** | Enron announces $544M after-tax charge and $1.2B equity reduction",
            "**2001-11-08** | Enron restates earnings back to 1997, reducing net income by $586M",
        ],
    },
    {
        "slug": "concepts/special-purpose-entities",
        "title": "Special Purpose Entities",
        "description": "Enron created hundreds of off-balance-sheet SPEs — including LJM Cayman, LJM2 Co-Investment, and the Raptor vehicles — to hide debt, book fictitious profits, and hedge deteriorating assets.",
        "related_companies": ["companies/enron", "companies/sec", "companies/arthur-andersen"],
        "timeline_entries": [
            "**1999-06-01** | LJM Cayman LP created; Andrew Fastow serves as general partner",
            "**2000-03-01** | Raptor I–IV SPEs created to hedge Enron's merchant investments",
            "**2001-10-16** | Enron discloses $1.2B equity reduction tied to Fastow-managed partnerships",
            "**2001-11-01** | Andrew Fastow placed on leave; resigns November 8",
        ],
    },
    {
        "slug": "concepts/enron-trading-operations",
        "title": "Enron Trading Operations",
        "description": "Enron built the largest energy trading operation in the United States, trading natural gas, electricity, bandwidth, weather derivatives, and other commodities through Enron Online and physical trading desks.",
        "related_companies": ["companies/enron", "companies/caiso", "companies/dynegy"],
        "timeline_entries": [
            "**1989-07-01** | Enron begins trading natural gas contracts",
            "**1999-11-29** | Enron Online launches — first major web-based commodity trading platform",
            "**2000-01-01** | Enron Online executes over $330B in trades annually at peak",
            "**2001-11-28** | Enron Online shuts down; Dynegy takeover deal collapses",
        ],
    },
    {
        "slug": "concepts/ferc-investigation",
        "title": "FERC Investigation into Enron",
        "description": "The Federal Energy Regulatory Commission investigated Enron and other energy companies for market manipulation during the California energy crisis and broader Western power market.",
        "related_companies": ["companies/enron", "companies/ferc", "companies/caiso"],
        "timeline_entries": [
            "**2001-06-19** | FERC opens formal investigation into Western electricity market",
            "**2002-02-04** | FERC releases Enron internal trading strategy memos (Death Star, Get Shorty, Fat Boy)",
            "**2003-07-16** | FERC orders Enron to pay $1.52B in refunds to California",
            "**2005-01-01** | Final FERC orders against Enron and traders concluded",
        ],
    },
    {
        "slug": "concepts/enron-collapse",
        "title": "Enron Collapse 2001",
        "description": "The sequence of events from the October 2001 earnings restatement through the December 2001 bankruptcy — the largest US corporate bankruptcy at the time.",
        "related_companies": ["companies/enron", "companies/sec", "companies/doj", "companies/dynegy", "companies/arthur-andersen"],
        "timeline_entries": [
            "**2001-10-16** | Enron announces $618M Q3 loss and $1.01B write-down",
            "**2001-10-22** | SEC opens formal investigation into Enron",
            "**2001-10-24** | CFO Andrew Fastow forced out",
            "**2001-11-08** | Enron restates five years of earnings; stock falls to $8",
            "**2001-11-28** | Dynegy terminates $8.9B acquisition; Enron stock hits $0.61",
            "**2001-12-02** | Enron files Chapter 11 bankruptcy ($63.4B in assets)",
            "**2002-01-25** | Enron VP Cliff Baxter found dead; suicide ruled",
        ],
    },
    {
        "slug": "concepts/enron-broadband",
        "title": "Enron Broadband Services",
        "description": "Enron's failed 2000–2001 venture into fiber optic bandwidth trading and video-on-demand, which generated fraudulent accounting entries and became a focus of criminal charges.",
        "related_companies": ["companies/enron", "companies/sec"],
        "timeline_entries": [
            "**2000-01-20** | Jeffrey Skilling announces Enron Broadband Services strategy",
            "**2000-03-09** | Skilling and Lay claim broadband division worth $29B standalone",
            "**2001-07-12** | Enron Broadband closes; 250 employees laid off",
            "**2003-04-17** | Five Enron broadband executives indicted for securities fraud",
        ],
    },
    {
        "slug": "concepts/energy-deregulation",
        "title": "Energy Deregulation",
        "description": "The political and regulatory movement to open electricity and natural gas markets to competition — the environment that enabled Enron's expansion from pipeline operator to global energy trader.",
        "related_companies": ["companies/enron", "companies/ferc", "companies/caiso", "companies/bpa"],
        "timeline_entries": [
            "**1978-11-09** | Natural Gas Policy Act begins partial deregulation of gas markets",
            "**1992-10-24** | Energy Policy Act: FERC gains authority to mandate open transmission access",
            "**1996-04-24** | FERC Orders 888/889: full open access to transmission grid",
            "**1998-04-01** | California electricity market deregulates",
            "**2005-08-08** | Energy Policy Act of 2005 reforms market rules post-Enron",
        ],
    },
    {
        "slug": "concepts/arthur-andersen-audit",
        "title": "Arthur Andersen Audit Failures",
        "description": "Arthur Andersen served as Enron's external auditor and was found to have approved or missed the accounting irregularities. Andersen was later convicted of obstruction of justice for shredding Enron documents.",
        "related_companies": ["companies/enron", "companies/arthur-andersen", "companies/sec"],
        "timeline_entries": [
            "**2001-10-23** | Arthur Andersen attorneys advise destruction of Enron-related documents",
            "**2002-01-10** | Andersen admits documents were shredded; fires partner David Duncan",
            "**2002-06-15** | Arthur Andersen convicted of obstruction of justice; effectively dissolved",
            "**2005-05-31** | Supreme Court overturns Andersen conviction on jury instruction grounds",
        ],
    },
    {
        "slug": "concepts/enron-org-structure",
        "title": "Enron Organizational Structure",
        "description": "Enron's corporate hierarchy spanning the board of directors, C-suite executives, trading divisions, and regional offices — as reconstructed from email communication patterns.",
        "related_companies": ["companies/enron"],
        "timeline_entries": [
            "**1985-07-01** | InterNorth and Houston Natural Gas merge to form Enron",
            "**1997-12-01** | Enron reorganized into four main divisions: wholesale, retail, transportation, broadband",
            "**2001-02-12** | Jeffrey Skilling named CEO; Kenneth Lay remains Chairman",
            "**2001-08-14** | Skilling resigns; Lay resumes CEO role",
        ],
    },
]

# ─── Main registry types ─────────────────────────────────────────────────────

class PersonRecord:
    __slots__ = ("slug", "name", "canonical_email", "is_enron", "affiliation_slug",
                 "email_count", "sent_count", "received_count",
                 "top_correspondents", "first_date", "last_date",
                 "folders_seen", "thread_slugs")

    def __init__(self, slug: str, name: str, email: str, is_enron: bool, affiliation: str):
        self.slug = slug
        self.name = name
        self.canonical_email = email
        self.is_enron = is_enron
        self.affiliation_slug = affiliation
        self.email_count = 0
        self.sent_count = 0
        self.received_count = 0
        self.top_correspondents: Dict[str, int] = defaultdict(int)
        self.first_date: Optional[datetime] = None
        self.last_date: Optional[datetime] = None
        self.folders_seen: Set[str] = set()
        self.thread_slugs: List[str] = []

class MeetingCluster:
    __slots__ = ("slug", "norm_subject", "earliest_date", "latest_date",
                 "participant_addrs", "email_count")

    def __init__(self, norm_subject: str, date: datetime, participants: List[str]):
        self.norm_subject = norm_subject
        self.earliest_date = date
        self.latest_date = date
        self.participant_addrs: Set[str] = set(participants)
        self.email_count = 1
        self.slug = ""  # assigned after clustering

class ThreadCluster:
    __slots__ = ("slug", "norm_subject", "earliest_date", "latest_date",
                 "participant_addrs", "email_count", "sample_subjects")

    def __init__(self, norm_subject: str, date: datetime, participants: List[str], raw_subject: str):
        self.norm_subject = norm_subject
        self.earliest_date = date
        self.latest_date = date
        self.participant_addrs: Set[str] = set(participants)
        self.email_count = 1
        self.sample_subjects: List[str] = [raw_subject]
        self.slug = ""

# ─── Page builders ───────────────────────────────────────────────────────────

def build_person_page(p: PersonRecord, all_persons: Dict[str, PersonRecord]) -> Dict:
    first_str = p.first_date.strftime("%Y-%m-%d") if p.first_date and p.first_date != _SENTINEL else "unknown"
    last_str = p.last_date.strftime("%Y-%m-%d") if p.last_date and p.last_date != _SENTINEL else "unknown"

    # Top 5 correspondents
    top5 = sorted(p.top_correspondents.items(), key=lambda x: -x[1])[:5]
    top5_links = []
    for addr, cnt in top5:
        slug = person_slug_for_address(addr)
        rec = all_persons.get(slug)
        name = rec.name if rec else addr.split("@")[0].replace(".", " ").title()
        top5_links.append(f"[{name}]({slug}) ({cnt})")

    org_line = f" at [{company_name_for_domain(domain_of(p.canonical_email))}]({p.affiliation_slug})" if p.affiliation_slug else ""
    enron_line = "an Enron employee" if p.is_enron else "an external contact"

    truth = (
        f"{p.name} is {enron_line}{org_line}. "
        f"Over the corpus period ({first_str} to {last_str}), {p.name} sent {p.sent_count} "
        f"and received {p.received_count} emails, totalling {p.email_count} interactions. "
    )
    if top5_links:
        truth += f"Top correspondents: {', '.join(top5_links)}. "
    if p.folders_seen and p.is_enron:
        truth += f"Mailbox folders observed: {', '.join(sorted(p.folders_seen)[:6])}. "

    timeline = ""
    if p.first_date and p.first_date != _SENTINEL:
        timeline += f"- **{first_str}** | First recorded email in corpus\n"
    if p.last_date and p.last_date != _SENTINEL and p.last_date != p.first_date:
        timeline += f"- **{last_str}** | Last recorded email in corpus"

    return {
        "slug": p.slug,
        "type": "person",
        "title": p.name,
        "compiled_truth": truth.strip(),
        "timeline": timeline.strip(),
        "_facts": {
            "type": "person",
            "slug": p.slug,
            "name": p.name,
            "email": p.canonical_email,
            "primary_affiliation": p.affiliation_slug,
        },
    }

def build_company_page(
    slug: str, name: str, domain: str,
    employees: List[str], email_vol: int
) -> Dict:
    is_enron = slug == "companies/enron"

    if is_enron:
        truth = (
            "Enron Corporation was an American energy company headquartered in Houston, Texas. "
            "Founded in 1985 through the merger of InterNorth and Houston Natural Gas, Enron grew "
            "from a natural gas pipeline company into the largest energy trading company in the United States. "
            "Its collapse in 2001 was the largest corporate bankruptcy in US history at the time, "
            "triggering criminal investigations that resulted in convictions of senior executives including "
            "Jeffrey Skilling and Andrew Fastow. The email corpus covers approximately 150 Enron employees "
            f"across trading, legal, regulatory, and executive functions. Total email volume: {email_vol:,}."
        )
        timeline = (
            "- **1985-07-01** | InterNorth + Houston Natural Gas merge to form Enron\n"
            "- **1989-07-01** | Enron begins natural gas trading\n"
            "- **1999-11-29** | Enron Online launches\n"
            "- **2000-12-31** | Enron reports $100B in annual revenues\n"
            "- **2001-10-16** | Announces $618M Q3 loss; SEC investigation begins\n"
            "- **2001-12-02** | Files Chapter 11 bankruptcy ($63.4B in assets)"
        )
    else:
        truth = (
            f"{name} is an external organization that appears in the Enron email corpus. "
            f"Domain: {domain}. Total email interactions with Enron: {email_vol:,}. "
        )
        if employees:
            truth += f"Known contacts: {len(employees)} individuals."
        timeline = f"- **2000-01-01** | Organization appears in Enron email corpus ({email_vol:,} emails)"

    return {
        "slug": slug,
        "type": "company",
        "title": name,
        "compiled_truth": truth,
        "timeline": timeline,
        "_facts": {
            "type": "company",
            "slug": slug,
            "name": name,
            "employees": employees,
            "founders": [],
            "investors": [],
            "advisors": [],
        },
    }

def build_meeting_page(cluster: MeetingCluster, all_persons: Dict[str, PersonRecord]) -> Dict:
    date_str = cluster.earliest_date.strftime("%Y-%m-%d") if cluster.earliest_date != _SENTINEL else "unknown"
    end_str = cluster.latest_date.strftime("%Y-%m-%d") if cluster.latest_date != cluster.earliest_date else ""

    attendee_slugs = sorted(
        set(person_slug_for_address(a) for a in cluster.participant_addrs
            if is_valid_address(a))
    )
    attendee_links = []
    for slug in attendee_slugs[:10]:
        rec = all_persons.get(slug)
        name = rec.name if rec else slug.replace("people/", "").replace("-", " ").title()
        attendee_links.append(f"[{name}]({slug})")

    period = f" through {end_str}" if end_str else ""
    truth = (
        f"Meeting: \"{cluster.norm_subject.title()}\". "
        f"Occurred {date_str}{period} with {cluster.email_count} related emails. "
        f"Participants included: {', '.join(attendee_links[:8])}{'...' if len(attendee_links) > 8 else ''}."
    )
    timeline = f"- **{date_str}** | Meeting: {cluster.norm_subject[:60]}"
    if end_str:
        timeline += f"\n- **{end_str}** | Final related email"

    return {
        "slug": cluster.slug,
        "type": "meeting",
        "title": f"Meeting: {cluster.norm_subject[:60].title()}",
        "compiled_truth": truth,
        "timeline": timeline,
        "_facts": {
            "type": "meeting",
            "slug": cluster.slug,
            "attendees": attendee_slugs,
            "date": date_str,
        },
    }

def build_thread_page(cluster: ThreadCluster, all_persons: Dict[str, PersonRecord]) -> Dict:
    date_str = cluster.earliest_date.strftime("%Y-%m-%d") if cluster.earliest_date != _SENTINEL else "unknown"
    end_str = cluster.latest_date.strftime("%Y-%m-%d") if cluster.latest_date != cluster.earliest_date else ""

    attendee_slugs = sorted(
        set(person_slug_for_address(a) for a in cluster.participant_addrs
            if is_valid_address(a))
    )
    attendee_links = []
    for slug in attendee_slugs[:8]:
        rec = all_persons.get(slug)
        name = rec.name if rec else slug.replace("people/", "").replace("-", " ").title()
        attendee_links.append(f"[{name}]({slug})")

    period = f" to {end_str}" if end_str else ""
    truth = (
        f"Email thread: \"{cluster.norm_subject.title()}\". "
        f"Ran from {date_str}{period} with {cluster.email_count} messages. "
        f"Participants: {', '.join(attendee_links[:8])}{'...' if len(attendee_links) > 8 else ''}."
    )
    timeline = f"- **{date_str}** | Thread begins: {cluster.norm_subject[:60]}"
    if end_str:
        timeline += f"\n- **{end_str}** | Thread last active"

    return {
        "slug": cluster.slug,
        "type": "meeting",  # use 'meeting' so buildQueries picks up attendees
        "title": f"Thread: {cluster.norm_subject[:60].title()}",
        "compiled_truth": truth,
        "timeline": timeline,
        "_facts": {
            "type": "meeting",
            "slug": cluster.slug,
            "attendees": attendee_slugs,
            "date": date_str,
        },
    }

def build_concept_page(concept: Dict, person_registry: Dict[str, PersonRecord]) -> Dict:
    related_people: List[str] = []
    for co_slug in concept.get("related_companies", []):
        # Find Enron employees as related people for Enron concepts
        if co_slug == "companies/enron":
            named = ["people/kenneth-lay", "people/jeffrey-skilling",
                     "people/andrew-fastow", "people/richard-causey"]
            for s in named:
                if s not in related_people:
                    related_people.append(s)

    timeline = "\n".join(f"- {e}" for e in concept.get("timeline_entries", []))
    related_co_slugs = concept.get("related_companies", [])
    co_links = ", ".join(
        f"[{company_name_for_domain(s.replace('companies/', '') + '.com')}]({s})"
        if s not in [f"companies/{v[1]}" for v in KNOWN_COMPANIES.values()]
        else f"[{next((v[0] for k, v in KNOWN_COMPANIES.items() if 'companies/' + v[1] == s), s)}]({s})"
        for s in related_co_slugs[:4]
    )

    truth = concept["description"]
    if co_links:
        truth += f" Related organizations: {co_links}."

    return {
        "slug": concept["slug"],
        "type": "concept",
        "title": concept["title"],
        "compiled_truth": truth,
        "timeline": timeline,
        "_facts": {
            "type": "concept",
            "slug": concept["slug"],
            "related_companies": related_co_slugs,
            "related_people": related_people,
        },
    }

# ─── Output writer ───────────────────────────────────────────────────────────

def write_page(out_dir: str, page: Dict) -> str:
    filename = page["slug"].replace("/", "__") + ".json"
    path = os.path.join(out_dir, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(page, f, indent=2, ensure_ascii=False)
    return path

def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

# ─── Main pipeline ───────────────────────────────────────────────────────────

def run(
    output_dir: str,
    max_rows: int,
    dry_run: bool,
    hf_cache_dir: Optional[str],
    min_person_emails: int,
    min_company_emails: int,
    max_meetings: int,
    max_threads: int,
    max_external_persons: int,
) -> None:

    check_deps()
    from datasets import load_dataset  # type: ignore

    if not dry_run:
        os.makedirs(output_dir, exist_ok=True)

    print(f"Loading corbt/enron-emails (streaming)...")
    print(f"  Output dir: {output_dir}")
    print(f"  Max rows: {'all' if max_rows == 0 else max_rows}")
    print(f"  Dry run: {dry_run}\n")

    ds = load_dataset(
        "corbt/enron-emails",
        split="train",
        streaming=True,
        cache_dir=hf_cache_dir,
        trust_remote_code=True,
    )

    # ── Stage 1+2: Stream + deduplicate ──────────────────────────────────────

    # Registries built during stream
    person_registry: Dict[str, PersonRecord] = {}   # slug → PersonRecord
    company_email_vol: Dict[str, int] = defaultdict(int)  # company_slug → email count
    company_employees: Dict[str, Set[str]] = defaultdict(set)  # company_slug → person slugs

    meeting_candidates: List[Tuple[str, datetime, List[str]]] = []  # (norm_subj, date, participant_addrs)
    thread_candidates: List[Tuple[str, datetime, List[str], str]] = []  # (norm_subj, date, participants, raw_subj)

    dedup_seen: Set[str] = set()
    rows_raw = 0
    rows_deduped = 0

    def get_or_create_person(addr: str) -> PersonRecord:
        addr = addr.strip().lower()
        slug = person_slug_for_address(addr)
        if slug in person_registry:
            return person_registry[slug]
        domain = domain_of(addr)
        is_enron = domain in ENRON_DOMAINS
        # Name
        if addr in EMAIL_TO_EMPLOYEE:
            name = EMAIL_TO_EMPLOYEE[addr][0]
        else:
            local = addr.split("@")[0]
            name = local.replace(".", " ").replace("_", " ").title()
        # Affiliation
        co_slug = company_slug_for_domain(domain) if domain else ""
        rec = PersonRecord(slug, name, addr, is_enron, co_slug)
        person_registry[slug] = rec
        return rec

    def update_date(rec: PersonRecord, dt: datetime) -> None:
        if dt == _SENTINEL:
            return
        if rec.first_date is None or dt < rec.first_date:
            rec.first_date = dt
        if rec.last_date is None or dt > rec.last_date:
            rec.last_date = dt

    print("Stage 1–2: Streaming + deduplication...")
    for row in ds:
        rows_raw += 1
        if max_rows and rows_raw > max_rows:
            break
        if rows_raw % 50000 == 0:
            print(f"  Processed {rows_raw:,} rows, {rows_deduped:,} unique so far...")

        # Dedup key: from + subject + body[:500]
        frm = (row.get("from") or "").strip().lower()
        subj = (row.get("subject") or "").strip()
        body_prefix = (row.get("body") or "")[:500]
        dedup_key = hashlib.md5(f"{frm}\x00{subj}\x00{body_prefix}".encode(errors="replace")).hexdigest()

        # Prefer _sent_mail copies — if we see a sent version later, update
        fname = (row.get("file_name") or "").lower()
        is_sent = "_sent_mail" in fname or "/sent_items" in fname or "/sent/" in fname
        folder = fname.split("/")[1] if fname.count("/") >= 1 else "unknown"

        if dedup_key in dedup_seen and not is_sent:
            continue
        dedup_seen.add(dedup_key)
        rows_deduped += 1

        # Parse date
        dt = parse_date(row)

        # Get participants
        participants = all_participants(row)
        if not participants:
            continue

        # Username from file_name
        username = fname.split("/")[0] if "/" in fname else ""

        # Update person records
        from_addr = frm if is_valid_address(frm) else ""
        if from_addr:
            sender = get_or_create_person(from_addr)
            sender.sent_count += 1
            sender.email_count += 1
            update_date(sender, dt)
            if folder and folder not in ("all_documents",):
                sender.folders_seen.add(folder)

        for addr in participants:
            if not is_valid_address(addr):
                continue
            rec = get_or_create_person(addr)
            if addr != from_addr:
                rec.received_count += 1
                rec.email_count += 1
                update_date(rec, dt)
            # Correspondents
            if from_addr and addr != from_addr:
                get_or_create_person(from_addr).top_correspondents[addr] += 1

        # Update company volumes
        for addr in participants:
            domain = domain_of(addr)
            if not domain:
                continue
            co_slug = company_slug_for_domain(domain)
            company_email_vol[co_slug] += 1
            p_slug = person_slug_for_address(addr)
            company_employees[co_slug].add(p_slug)

        # Collect meeting / thread candidates
        norm_subj = normalise_subject(subj)
        if not norm_subj:
            continue

        if is_meeting_email(row):
            meeting_candidates.append((norm_subj, dt, participants))
        else:
            thread_candidates.append((norm_subj, dt, participants, subj))

    print(f"\n  Raw rows: {rows_raw:,}")
    print(f"  Deduplicated: {rows_deduped:,} unique emails")
    print(f"  People seen: {len(person_registry):,}")
    print(f"  Companies seen: {len(company_email_vol):,}")
    print(f"  Meeting candidates: {len(meeting_candidates):,}")
    print(f"  Thread candidates: {len(thread_candidates):,}\n")

    # ── Stage 3: Meeting clustering ───────────────────────────────────────────

    print("Stage 3: Meeting clustering...")
    meeting_candidates.sort(key=lambda x: x[1])  # sort by date

    meeting_clusters: List[MeetingCluster] = []
    for norm_subj, dt, participants in meeting_candidates:
        if not norm_subj or len(norm_subj) < 4:
            continue
        # Try to merge into existing cluster
        merged = False
        # Only look back 50 clusters within 7-day window
        for cluster in reversed(meeting_clusters[-50:]):
            # Date proximity: within 7 days
            if dt != _SENTINEL and cluster.earliest_date != _SENTINEL:
                delta = abs((dt - cluster.earliest_date).days)
                if delta > 7:
                    continue
            # Subject similarity: exact normalised match
            if cluster.norm_subject != norm_subj:
                continue
            # Participant overlap: at least 1 shared
            if cluster.participant_addrs.isdisjoint(set(participants)):
                continue
            # Merge
            cluster.participant_addrs.update(participants)
            if dt != _SENTINEL:
                if cluster.earliest_date == _SENTINEL or dt < cluster.earliest_date:
                    cluster.earliest_date = dt
                if cluster.latest_date == _SENTINEL or dt > cluster.latest_date:
                    cluster.latest_date = dt
            cluster.email_count += 1
            merged = True
            break
        if not merged:
            meeting_clusters.append(MeetingCluster(norm_subj, dt, participants))

    # Sort by participant count descending, cap
    meeting_clusters.sort(key=lambda c: -len(c.participant_addrs))
    # Only keep meetings with >= 2 internal Enron participants
    def internal_count(c: MeetingCluster) -> int:
        return sum(1 for a in c.participant_addrs if domain_of(a) in ENRON_DOMAINS)
    meeting_clusters = [c for c in meeting_clusters if internal_count(c) >= 2]
    meeting_clusters = meeting_clusters[:max_meetings]

    # Assign slugs (deduplicated)
    used_meeting_slugs: Set[str] = set()
    for cluster in meeting_clusters:
        base = slugify(cluster.norm_subject, 40)
        date_str = cluster.earliest_date.strftime("%Y-%m") if cluster.earliest_date != _SENTINEL else "unknown"
        slug = f"meetings/{base}-{date_str}"
        if slug in used_meeting_slugs:
            slug = f"{slug}-{cluster.email_count}"
        used_meeting_slugs.add(slug)
        cluster.slug = slug

    print(f"  Meeting clusters: {len(meeting_clusters):,}\n")

    # ── Stage 4: Thread clustering ────────────────────────────────────────────

    print("Stage 4: Thread clustering...")
    thread_candidates.sort(key=lambda x: x[1])

    thread_clusters: List[ThreadCluster] = []
    thread_map: Dict[str, int] = {}  # norm_subj → cluster index

    for norm_subj, dt, participants, raw_subj in thread_candidates:
        if not norm_subj or len(norm_subj) < 4:
            continue
        if norm_subj in thread_map:
            cluster = thread_clusters[thread_map[norm_subj]]
            # Check date proximity (30-day window)
            if dt != _SENTINEL and cluster.earliest_date != _SENTINEL:
                if abs((dt - cluster.earliest_date).days) > 30:
                    # Start new cluster for same subject after gap
                    new_cluster = ThreadCluster(norm_subj, dt, participants, raw_subj)
                    thread_map[norm_subj] = len(thread_clusters)
                    thread_clusters.append(new_cluster)
                    continue
            cluster.participant_addrs.update(participants)
            if dt != _SENTINEL:
                if cluster.earliest_date == _SENTINEL or dt < cluster.earliest_date:
                    cluster.earliest_date = dt
                if cluster.latest_date == _SENTINEL or dt > cluster.latest_date:
                    cluster.latest_date = dt
            cluster.email_count += 1
            if raw_subj not in cluster.sample_subjects:
                cluster.sample_subjects.append(raw_subj)
        else:
            new_cluster = ThreadCluster(norm_subj, dt, participants, raw_subj)
            thread_map[norm_subj] = len(thread_clusters)
            thread_clusters.append(new_cluster)

    # Sort by participant count, cap
    thread_clusters.sort(key=lambda c: -(len(c.participant_addrs) * c.email_count))
    thread_clusters = [c for c in thread_clusters if len(c.participant_addrs) >= 3]
    thread_clusters = thread_clusters[:max_threads]

    # Assign slugs
    used_thread_slugs: Set[str] = set()
    for cluster in thread_clusters:
        base = slugify(cluster.norm_subject, 40)
        date_str = cluster.earliest_date.strftime("%Y-%m") if cluster.earliest_date != _SENTINEL else "unknown"
        slug = f"threads/{base}-{date_str}"
        if slug in used_thread_slugs:
            slug = f"{slug}-{cluster.email_count}"
        used_thread_slugs.add(slug)
        cluster.slug = slug

    print(f"  Thread clusters: {len(thread_clusters):,}\n")

    # ── Stage 5: Filter persons for emission ─────────────────────────────────

    print("Stage 5: Filtering persons for emission...")

    # Always include all Enron employees (from EMPLOYEE_MAP)
    enron_person_slugs: Set[str] = set()
    for _uname, (_name, _email) in EMPLOYEE_MAP.items():
        enron_person_slugs.add(person_slug_for_address(_email))

    # External persons by email frequency
    external_persons = [
        (slug, rec) for slug, rec in person_registry.items()
        if not rec.is_enron and rec.email_count >= min_person_emails
    ]
    external_persons.sort(key=lambda x: -x[1].email_count)
    external_persons = external_persons[:max_external_persons]
    external_person_slugs = set(s for s, _ in external_persons)

    emit_person_slugs = enron_person_slugs | external_person_slugs
    # Also ensure persons referenced in meeting/thread attendees are present
    for cluster in meeting_clusters:
        for addr in cluster.participant_addrs:
            slug = person_slug_for_address(addr)
            if slug in person_registry:
                emit_person_slugs.add(slug)

    emit_persons = {
        slug: person_registry[slug]
        for slug in emit_person_slugs
        if slug in person_registry
    }
    print(f"  Persons to emit: {len(emit_persons):,}")

    # ── Stage 6: Filter companies for emission ────────────────────────────────

    # Always include Enron + KNOWN_COMPANIES
    known_co_slugs = set("companies/" + v[1] for v in KNOWN_COMPANIES.values())
    # Top external companies by volume
    top_extern_cos = sorted(
        [(slug, vol) for slug, vol in company_email_vol.items()
         if slug not in known_co_slugs and vol >= min_company_emails],
        key=lambda x: -x[1]
    )[:200]
    emit_co_slugs = known_co_slugs | set(s for s, _ in top_extern_cos)
    print(f"  Companies to emit: {len(emit_co_slugs):,}")

    # ── Stats before writing ──────────────────────────────────────────────────

    total_pages = (
        len(emit_persons) + len(emit_co_slugs) +
        len(meeting_clusters) + len(thread_clusters) + len(CONCEPT_PAGES)
    )
    print(f"\nTotal pages to emit: {total_pages:,}")
    print(f"  People:    {len(emit_persons):,}")
    print(f"  Companies: {len(emit_co_slugs):,}")
    print(f"  Meetings:  {len(meeting_clusters):,}")
    print(f"  Threads:   {len(thread_clusters):,}")
    print(f"  Concepts:  {len(CONCEPT_PAGES)}")

    if dry_run:
        print("\n[dry-run] No files written.")
        return

    # ── Stage 7: Emit pages ───────────────────────────────────────────────────

    print("\nStage 7: Writing pages...")
    manifest_items = []

    written = 0

    # People
    for slug, rec in emit_persons.items():
        page = build_person_page(rec, person_registry)
        path = write_page(output_dir, page)
        manifest_items.append({"slug": slug, "path": os.path.basename(path), "type": "person"})
        written += 1
    print(f"  Wrote {written:,} person pages")

    # Companies
    co_written = 0
    for co_slug in emit_co_slugs:
        domain = next(
            (k for k, v in KNOWN_COMPANIES.items() if "companies/" + v[1] == co_slug),
            co_slug.replace("companies/", "") + ".com"
        )
        name = company_name_for_domain(domain)
        emps = sorted(company_employees.get(co_slug, set()))
        vol = company_email_vol.get(co_slug, 0)
        page = build_company_page(co_slug, name, domain, emps, vol)
        path = write_page(output_dir, page)
        manifest_items.append({"slug": co_slug, "path": os.path.basename(path), "type": "company"})
        co_written += 1
    written += co_written
    print(f"  Wrote {co_written:,} company pages")

    # Meetings
    mt_written = 0
    for cluster in meeting_clusters:
        page = build_meeting_page(cluster, person_registry)
        path = write_page(output_dir, page)
        manifest_items.append({"slug": cluster.slug, "path": os.path.basename(path), "type": "meeting"})
        mt_written += 1
        written += 1
    print(f"  Wrote {mt_written:,} meeting pages")

    # Threads
    th_written = 0
    for cluster in thread_clusters:
        page = build_thread_page(cluster, person_registry)
        path = write_page(output_dir, page)
        manifest_items.append({"slug": cluster.slug, "path": os.path.basename(path), "type": "thread"})
        th_written += 1
        written += 1
    print(f"  Wrote {th_written:,} thread pages")

    # Concepts
    for concept in CONCEPT_PAGES:
        page = build_concept_page(concept, person_registry)
        path = write_page(output_dir, page)
        manifest_items.append({"slug": concept["slug"], "path": os.path.basename(path), "type": "concept"})
        written += 1
    print(f"  Wrote {len(CONCEPT_PAGES)} concept pages")

    # Manifest
    manifest = {
        "schema_version": 1,
        "corpus_id": "enron-v1",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "generator": {
            "name": "enron-ingest.py",
            "model": "none",
            "source": "corbt/enron-emails",
            "rows_raw": rows_raw,
            "rows_deduped": rows_deduped,
        },
        "license": "public-domain",
        "items": manifest_items,
    }
    manifest_path = os.path.join(output_dir, "_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nDONE. {written:,} pages written to {output_dir}/")
    print(f"  Manifest: {manifest_path}")

# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Enron email corpus → BrainBench RichPage JSON")
    parser.add_argument("--output-dir",           default="eval/data/enron-v1",   help="Output directory")
    parser.add_argument("--max",        type=int,  default=0,                     help="Max rows to process (0=all)")
    parser.add_argument("--dry-run",    action="store_true",                      help="Print stats only, no files")
    parser.add_argument("--hf-cache-dir",          default=None,                  help="HuggingFace cache directory")
    parser.add_argument("--min-person-emails", type=int, default=10,              help="Min emails for external person page")
    parser.add_argument("--min-company-emails", type=int, default=20,             help="Min emails for auto-company page")
    parser.add_argument("--max-meetings",      type=int, default=3000,            help="Max meeting pages to emit")
    parser.add_argument("--max-threads",       type=int, default=5000,            help="Max thread pages to emit")
    parser.add_argument("--max-external-persons", type=int, default=2000,         help="Max external person pages")
    args = parser.parse_args()

    run(
        output_dir=args.output_dir,
        max_rows=args.max,
        dry_run=args.dry_run,
        hf_cache_dir=args.hf_cache_dir,
        min_person_emails=args.min_person_emails,
        min_company_emails=args.min_company_emails,
        max_meetings=args.max_meetings,
        max_threads=args.max_threads,
        max_external_persons=args.max_external_persons,
    )

if __name__ == "__main__":
    main()
