"""Regression guard for the BLOCKED_DOMAINS set in search_leads.py.

Each domain here has a corresponding rationale comment in the source file.
Removing a domain without updating this test is a signal to reconsider —
these are all sites we've observed leaking non-lead content into the
qualification pipeline (comparison marketplaces, directories, national
chains, corporate career pages, city info portals, US college sports
rosters that matched Dutch surnames).

Run with:
    python3 services/leadgen-scraper/test_blocked_domains.py
"""

import re
import sys
from pathlib import Path


def load_blocked_domains(source_path: Path) -> set[str]:
    content = source_path.read_text()
    match = re.search(r"BLOCKED_DOMAINS\s*=\s*\{(.+?)^\}", content, re.DOTALL | re.MULTILINE)
    if not match:
        raise AssertionError("Could not locate BLOCKED_DOMAINS literal in search_leads.py")
    body = match.group(1)
    return set(re.findall(r'"([^"]+)"', body))


def main() -> int:
    source_path = Path(__file__).with_name("search_leads.py")
    domains = load_blocked_domains(source_path)

    # Original curated set (pre-2026-08-16 batch) — sanity check that the
    # older entries survived the extension.
    original_survivors = [
        "companydata.com", "yelp.com", "wikipedia.org", "tripadvisor.com",
        "linkedin.com", "facebook.com", "instagram.com",
        "telefoonboek.nl", "detelefoongids.nl", "goudengids.nl", "cylex.nl",
        "werkspot.nl", "homedeal.nl", "zoofy.nl",
    ]
    for d in original_survivors:
        assert d in domains, f"Pre-existing blocklist entry missing: {d!r}"

    # 2026-08-16 batch — added after operator's autonomous quality review of
    # the newest 500 leads. Each has a specific junk pattern observed in the
    # backlog. Removing one should be a deliberate choice, not accidental.
    new_2026_08_16 = [
        # National chains
        "feenstra.com",
        "guidion.com",
        "hoogvliet.com",
        "valksolarsystems.com",
        "chimay.com",
        # Corporate career / info portals
        "careers.chevron.com",
        "jobs.vinci.com",
        "creditsafe.com",
        # Directory / comparison / marketplace
        "bylder.com",
        "makelaarsgids.nl",
        "nubreda.nl",
        "explorebreda.com",
        "bredasdagblad.nl",
        "deburchtbreda.nl",
        "stappen-shoppen.nl",
        "thuiswinkel.org",
        # City-initiative portals
        "castricum.info",
        "sterk.amsterdam",
        "vva.amsterdam",
        # US college athletics leaking via Dutch surname matches
        "cofcsports.com",
        "godrakebulldogs.com",
        "newberrywolves.com",
    ]
    for d in new_2026_08_16:
        assert d in domains, f"2026-08-16 blocklist addition missing: {d!r}"

    # 2026-08-23 batch — second week-over-week quality review; only 4 new
    # patterns worth permanently blocking after the R1 + R3 improvements
    # dropped overall leak rates by ~50%.
    new_2026_08_23 = [
        "findhealthclinics.com",
        "nephrocare.com",
        "kendew-agency.com",
        "ns.nl",
    ]
    for d in new_2026_08_23:
        assert d in domains, f"2026-08-23 blocklist addition missing: {d!r}"

    # No accidental duplicates (a set literal would silently dedupe but the
    # rationale-comment style makes visual review harder — this asserts each
    # domain appears exactly once as source-code text).
    content = source_path.read_text()
    for d in new_2026_08_16:
        occurrences = content.count(f'"{d}"')
        assert occurrences == 1, f"Domain {d!r} appears {occurrences} times in source; expected exactly 1"

    print(f"OK: BLOCKED_DOMAINS contains {len(domains)} entries; all 2026-08-16 additions present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
