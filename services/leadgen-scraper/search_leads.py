#!/usr/bin/env python3
"""Search for candidate businesses and extract a lead record from each result.

Builds on extract_lead.py: a DuckDuckGo search (no API key, no per-token
cost) finds candidate URLs for a query, then each page is run through the
same local Ollama extraction pipeline. Runs entirely locally.

Usage:
    python search_leads.py "electricians in Rotterdam"
    python search_leads.py "hair salons in Utrecht" --max 8
"""

import argparse
import json
import signal
import sys
import time
from urllib.parse import urlparse

from scrapegraphai.utils.research_web import search_on_web

# Same "auto resume" philosophy as the Node side (services/lib/retry.mjs):
# a WiFi/ISP blip must not kill the whole niche run over one unlucky search
# call. Retries roughly every 2 minutes, ~10 minutes of total resilience.
SEARCH_RETRY_DELAYS_SECONDS = [15, 30, 60, 120, 120, 120]


def search_on_web_with_retry(**kwargs):
    last_error = None
    for attempt, delay in enumerate([0] + SEARCH_RETRY_DELAYS_SECONDS, start=1):
        if delay:
            print(
                f"DuckDuckGo search failed (attempt {attempt - 1}), retrying in {delay}s: {last_error}",
                file=sys.stderr,
            )
            time.sleep(delay)
        try:
            return search_on_web(**kwargs)
        except Exception as exc:  # network blip, rate limit, etc.
            last_error = exc
    raise last_error

from extract_lead import extract, unload_model

# One slow/hanging page must not stall a whole batch: the Amsterdam
# slijterijen niche took ~2h20m for 43 candidates while other niches did
# ~35 candidates in ~30min — some pages hold Playwright/Ollama far too
# long. SIGALRM aborts a single extraction; the loop records it as an
# error and moves on.
EXTRACT_TIMEOUT_SECONDS = 180


class ExtractTimeout(Exception):
    pass


def _alarm_handler(signum, frame):
    raise ExtractTimeout(f"extraction exceeded {EXTRACT_TIMEOUT_SECONDS}s")


def extract_with_timeout(url: str, niche: str) -> dict:
    signal.signal(signal.SIGALRM, _alarm_handler)
    signal.alarm(EXTRACT_TIMEOUT_SECONDS)
    try:
        return extract(url, niche=niche)
    finally:
        signal.alarm(0)

# Domains observed (not guessed) to return real-but-irrelevant businesses —
# data brokers, directories, and search-result pages that rank for niche
# search terms without being an actual business in that niche. The
# extraction prompt asks the model to self-filter these too, but that's
# unreliable on an 8B model for this kind of judgment call (tested: it
# missed companydata.com twice in a row) — this list is the deterministic
# backstop. Expected to grow as new offenders turn up; not exhaustive.
BLOCKED_DOMAINS = {
    "companydata.com",
    "bolddata.nl",  # same company as companydata.com, different domain
    "bedrijfsinformatieonline.nl",
    "yelp.com",
    "wikipedia.org",
    "tripadvisor.com",
    "opencorporates.com",
    "elektriciensgids.nl",
    "elektricien.nl",  # bare generic niche-word domain — a Dutch directory pattern
    "trustoo.nl",  # review/matching marketplace, same class as yelp.com
    "consumentenbond.nl",  # Dutch consumer-advocacy nonprofit, not a business
    "spoedklus.nl",  # multi-trade emergency broker (plumber/electrician/locksmith/roofer)
    "startpagina.nl",  # self-describes as "Online directory"
    "klantervaringen.nl",  # self-describes as "Online review platform"
    "loodgieters-bedrijven.nl",  # confirmed lead-referral marketplace
    "yoys.nl",  # self-describes as "B2B Marketplace" in its own title
    "delokaleloodgieter.nl",  # multi-province referral platform
    "moving.nl",  # multi-category comparison marketplace (moving, plumbing, etc.)
    "linkedin.com",  # job postings and profiles, not a business's own site
    "technieknederland.nl",  # trade association ("Vakorganisatie"), not a business
    "klusup.nl",  # gig-work matching platform ("you'll be matched with a plumber")
    "loodgietershub.nl",  # self-describes as bringing customers and plumbers together
    "bouwproducten.nl",  # construction-industry news/product platform, not a plumber
    # Social platforms and ad/search redirect domains — never a business's own
    # site by definition, safe to block broadly rather than case-by-case.
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "bing.com",  # search-ad click-tracking redirect URLs turned up, not real pages
    "alexwaterandbouw.eu",  # SEO content site (pricing guides) with a business-sounding name
    "homedeal.nl",  # quote-comparison marketplace ("vergelijk offertes van vakspecialisten")
    "werkspot.nl",  # largest Dutch home-services marketplace, same class as homedeal
    "expatguide.nl",  # expat directory ("Index of quality businesses... Add your company")
    "de10beste.nl",  # "the 10 best" ranking/listing site
    "zoofy.nl",  # handyman booking platform
    "slimster.nl",  # quote-comparison platform (previously hit via a bing ad redirect)
    "amsterdamlokaal.nl",  # city blog/directory ("De 5 Beste ... van Amsterdam" listicles)
    "amsterdamonline.nl",  # city business directory ("Bedrijvengids Amsterdam")
    "mva.nl",  # Makelaarsvereniging Amsterdam — brokers' association, not a business
    "wieisdebestemakelaar.nl",  # makelaar comparison site
    "ikzoekdebestemakelaar.nl",  # makelaar comparison site
    "makelaaroverzicht.nl",  # makelaar directory ("5000+ makelaars geindexeerd")
    "elektricienaanhuis.nl",  # Volton marketplace ("brings you in contact with companies")
    "elektricienindebuurt.com",  # no-identity SEO shell (no KvK/address, city mismatch)
    "zorgkaartnederland.nl",  # national healthcare review/directory platform
    "kliniekervaringen.nl",  # clinic review site
    "independer.nl",  # insurance/services comparison site
    "clinicbooking.com",  # clinic booking platform (fronts real clinics)
    "injectablesbooking.nl",  # cosmetic-clinic booking platform
    "davidhealth.com",  # health-equipment brand; extraction misattributed a clinic to it
    "triginta.be",  # real-estate investor; its portfolio page about a clinic got extracted
    "4in24.nl",  # self-describes as "B2B-platform for recruitment"
    "ecommercerecruitment.nl",  # recruitment-bureau comparison directory ("30 bureaus getest")
    # Phone books / yellow pages — directories by definition, safe to block
    # as a class like the social platforms above.
    "telefoonboek.nl",
    "detelefoongids.nl",
    "goudengids.nl",
    "cylex.nl",
}

# Marketing language Dutch/English directory and comparison sites consistently
# use to describe themselves — checked against the model's own business_type
# and services fields after extraction. Catches directory sites the domain
# list hasn't seen yet, wherever the model's extraction actually surfaced the
# directory language (it doesn't always — see BLOCKED_DOMAINS' elektricien.nl
# entry for a case where the model missed it entirely and needed the domain
# list instead).
DIRECTORY_LANGUAGE_MARKERS = (
    "gids", "vergelijk", "bedrijvengids", "geverifieerde bedrijven",
    "offertes van meerdere", "meerdere elektriciens", "vind een geschikte",
    "compare quotes", "verified businesses", "find multiple",
)


def is_blocked_domain(url: str, extra_blocked: set[str] | None = None) -> bool:
    host = (urlparse(url).hostname or "").lower()
    blocked = BLOCKED_DOMAINS | (extra_blocked or set())
    return any(host == domain or host.endswith(f".{domain}") for domain in blocked)


def looks_like_directory(record: dict) -> bool:
    haystack = str(record.get("business_type", "")).lower()
    haystack += " " + " ".join(str(item) for item in (record.get("services") or [])).lower()
    return any(marker in haystack for marker in DIRECTORY_LANGUAGE_MARKERS)


def is_mostly_empty(record: dict) -> bool:
    """business_name isn't literally "NA" (the only thing the existing NA
    filter checks) but everything else came back NA/empty — e.g. the model
    fell back to using the domain itself as the name. Not a usable lead
    either way.
    """
    return str(record.get("business_type", "")).strip().upper() == "NA"


def search_leads(
    query: str,
    max_results: int,
    skip_domains: set[str] | None = None,
    blocked_domains: set[str] | None = None,
) -> list[dict]:
    urls = search_on_web_with_retry(query=query, search_engine="duckduckgo", max_results=max_results)

    records = []
    seen_domains = set()  # same business, different pages (e.g. site.nl/ and site.nl/region)
    known_domains = skip_domains or set()  # already saved in the leads table from past runs
    for url in urls:
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")

        if is_blocked_domain(url, extra_blocked=blocked_domains):
            records.append({"source_url": url, "error": "skipped: known directory/aggregator domain"})
            continue

        if host in known_domains:
            records.append({"source_url": url, "error": "skipped: domain already in leads table"})
            continue

        if host in seen_domains:
            records.append({"source_url": url, "error": "skipped: already found a lead from this domain in this run"})
            continue

        try:
            record = extract_with_timeout(url, niche=query)
            record["source_url"] = url
            if looks_like_directory(record):
                record = {"source_url": url, "error": "skipped: extraction matched directory/comparison-site language"}
            elif is_mostly_empty(record):
                record = {"source_url": url, "error": "skipped: extraction came back empty (business_type NA)"}
            else:
                seen_domains.add(host)
        except Exception as exc:  # one bad site shouldn't kill the batch
            record = {"source_url": url, "error": str(exc)}
        records.append(record)
    return records


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help='Search query, e.g. "electricians in Rotterdam"')
    parser.add_argument(
        "--max", type=int, default=10, help="Max candidate URLs to extract (default: 10)"
    )
    parser.add_argument(
        "--skip-domains-file",
        default=None,
        help="File with one domain per line to skip (already-saved leads)",
    )
    parser.add_argument(
        "--blocked-domains-file",
        default=None,
        help="File with one domain per line to block (Supabase blocked_domains table)",
    )
    args = parser.parse_args()

    if args.max > 50:
        print("Refusing --max > 50 in one run — stay bounded, see README.", file=sys.stderr)
        sys.exit(1)

    def load_domain_file(path: str | None) -> set[str]:
        if not path:
            return set()
        with open(path, encoding="utf-8") as f:
            return {line.strip().lower() for line in f if line.strip()}

    results = search_leads(
        args.query,
        args.max,
        skip_domains=load_domain_file(args.skip_domains_file),
        blocked_domains=load_domain_file(args.blocked_domains_file),
    )
    print(json.dumps(results, indent=2))
    unload_model()  # release RAM once the whole batch is done, not between URLs
