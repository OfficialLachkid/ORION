#!/usr/bin/env python3
"""Extract a structured lead record from a business's public website.

Runs entirely locally against Ollama — no Anthropic/OpenAI API key, no
per-token cost. See README.md for setup.

Usage:
    python extract_lead.py https://example-business.com
"""

import json
import re
import subprocess
import sys

from pydantic import BaseModel, Field, field_validator
from scrapegraphai.graphs import SmartScraperGraph

KVK_NUMBER_PATTERN = re.compile(r"^\d{8}$")

OLLAMA_MODEL = "llama3.1:8b"

def build_extraction_prompt(niche: str | None = None) -> str:
    """Build the extraction prompt, optionally checking the page's business
    against a target niche/category so an unrelated but real business
    (e.g. a data broker whose SEO page ranks for the search term) doesn't
    get saved as if it were an actual match.
    """
    relevance_clause = ""
    if niche:
        relevance_clause = (
            f"You are specifically looking for businesses in this category: "
            f"\"{niche}\". If the page's own business is a DIFFERENT kind of "
            "company that merely mentions, lists, or ranks for that category "
            "(e.g. a data broker, marketing agency, directory, review site, "
            "or SEO content page), that does NOT count as a match, even "
            "though it is a real business.\n\n"
        )

    return (
        "First decide whether this page IS a single business's own official "
        "website for a business that itself matches the target category, or "
        "whether it is instead a directory, listing site, aggregator, "
        "marketplace, unrelated business, or search-results page (e.g. Yelp "
        "search results, a business-data directory, a Wikipedia article, a "
        "review-site listing page). "
        + relevance_clause
        + "If it does NOT match, set business_name to exactly \"NA\" and "
        "leave the other fields as NA / empty — do not extract the "
        "directory/aggregator/unrelated site's own name or details as if it "
        "were the target business.\n\n"
        "If it DOES match, extract a lead record: its name, what it does "
        "(business type / services), any contact details (email, phone) "
        "that are publicly listed, links to social media profiles, its Dutch "
        "KvK (Kamer van Koophandel) chamber-of-commerce registration number "
        "if shown anywhere on the page (often in the footer, a legal/imprint "
        "page, or terms and conditions — usually 8 digits), and whether the "
        "site itself looks modern, dated, or barely functional."
    )


class LeadRecord(BaseModel):
    business_name: str = Field(description="The business's name")
    business_type: str = Field(description="What the business does / its industry")
    services: list[str] = Field(description="Services or products offered")
    contact_email: str | None = Field(default=None, description="Public contact email, if listed")
    contact_phone: str | None = Field(default=None, description="Public contact phone, if listed")
    social_links: list[str] = Field(default_factory=list, description="Social media profile URLs")
    kvk_number: str | None = Field(
        default=None,
        description="Dutch KvK chamber-of-commerce registration number, if shown on the page",
    )
    website_quality: str = Field(
        description="One of: modern, dated, minimal, broken — a rough read on the site itself"
    )

    @field_validator("kvk_number")
    @classmethod
    def validate_kvk_number(cls, value):
        # The model sometimes fills this with an explanatory sentence, an
        # address, or a placeholder-looking number instead of leaving it
        # null — a real KvK number is exactly 8 digits, nothing else counts.
        # 12345678 passes the 8-digit shape but is the classic placeholder
        # (observed live); reject sequential runs explicitly.
        cleaned = (value or "").strip()
        if KVK_NUMBER_PATTERN.match(cleaned) and cleaned not in {"12345678", "87654321"}:
            return cleaned
        return None

    @field_validator("website_quality")
    @classmethod
    def validate_website_quality(cls, value):
        # Same failure mode as kvk_number: observed values include a bare
        # ".", "low", and a full URL. Only the documented labels count.
        allowed = {"modern", "dated", "minimal", "broken"}
        normalized = str(value or "").strip().lower()
        return normalized if normalized in allowed else ""


def extract(url: str, niche: str | None = None) -> dict:
    graph = SmartScraperGraph(
        prompt=build_extraction_prompt(niche),
        source=url,
        schema=LeadRecord,
        config={
            "llm": {
                "model": f"ollama/{OLLAMA_MODEL}",
                "format": "json",
                "temperature": 0,
            },
            "verbose": False,
            "headless": True,
        },
    )
    return graph.run()


def unload_model() -> None:
    """Release the model from RAM now instead of waiting out Ollama's idle timer."""
    try:
        subprocess.run(["ollama", "stop", OLLAMA_MODEL], capture_output=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        pass  # best-effort — not worth failing the run over


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python extract_lead.py <url>", file=sys.stderr)
        sys.exit(1)

    result = extract(sys.argv[1])
    print(json.dumps(result, indent=2))
    unload_model()
