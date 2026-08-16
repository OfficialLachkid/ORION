"""Regression tests for the 2026-08-16 R1 (country context) + R3 (national
chains) additions to search_leads.py.

Run with:
    python3 services/leadgen-scraper/test_country_context_and_chains.py
"""

import re
import sys
from pathlib import Path


def load_source() -> str:
    return (Path(__file__).with_name("search_leads.py")).read_text()


def load_set(name: str, source: str) -> set[str]:
    match = re.search(rf"{name}\s*=\s*\{{(.+?)^\}}", source, re.DOTALL | re.MULTILINE)
    if not match:
        raise AssertionError(f"Could not locate {name} literal in search_leads.py")
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def main() -> int:
    source = load_source()

    # ----- R3: NATIONAL_CHAINS set exists and contains the curated list -----
    chains = load_set("NATIONAL_CHAINS", source)
    required_chains = [
        # Recruitment
        "randstad.nl", "randstad.com", "adecco.nl", "manpower.nl",
        "tempo-team.nl", "olympia.nl", "unique.nl", "startpeople.nl",
        # Supermarkets
        "ah.nl", "albertheijn.nl", "jumbo.com", "aldi.nl", "lidl.nl", "plus.nl",
    ]
    for d in required_chains:
        assert d in chains, f"NATIONAL_CHAINS missing: {d!r}"
    # is_blocked_domain wires NATIONAL_CHAINS into the union — assert the
    # unioning line survives future refactors of that function.
    assert "BLOCKED_DOMAINS | NATIONAL_CHAINS" in source, (
        "is_blocked_domain no longer unions NATIONAL_CHAINS into the effective blocklist; "
        "the chains set is inert unless it's included in the union."
    )

    # ----- R1: apply_country_context + COUNTRY_CONTEXT_TOKENS -----
    assert "def apply_country_context" in source, (
        "apply_country_context helper missing — the country-context tweak was reverted or renamed."
    )
    assert "COUNTRY_CONTEXT_TOKENS" in source, (
        "COUNTRY_CONTEXT_TOKENS constant missing — pass-through detection would break."
    )
    # The helper MUST be called from search_leads, not just defined.
    assert "apply_country_context(query)" in source, (
        "apply_country_context is defined but not called from search_leads — feature is inert."
    )

    # ----- Behaviour: apply_country_context appends 'Nederland' by default,
    # and passes through when the incoming query already has country context.
    # Import at runtime via a scoped exec so we don't need the full
    # scrapegraphai dependency chain in the test environment.
    def get_helper():
        import ast
        tree = ast.parse(source)
        wanted = {"apply_country_context", "COUNTRY_CONTEXT_TOKENS"}
        keep = [n for n in tree.body if (
            (isinstance(n, ast.FunctionDef) and n.name in wanted)
            or (isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id in wanted for t in n.targets))
        )]
        module = ast.Module(body=keep, type_ignores=[])
        scope = {}
        exec(compile(module, "<extract>", "exec"), scope)  # noqa: S102
        return scope["apply_country_context"]

    apply_country_context = get_helper()

    # Fresh niche+city query gets 'Nederland' appended.
    assert apply_country_context("elektriciens Amsterdam") == "elektriciens Amsterdam Nederland"
    assert apply_country_context("klinieken Heemskerk") == "klinieken Heemskerk Nederland"

    # Case-insensitive pass-through when the caller already provided context.
    assert apply_country_context("elektriciens Amsterdam Nederland") == "elektriciens Amsterdam Nederland"
    assert apply_country_context("elektriciens Amsterdam NEDERLAND") == "elektriciens Amsterdam NEDERLAND"
    assert apply_country_context("plumbers netherlands") == "plumbers netherlands"
    assert apply_country_context("makelaars site:.nl breda") == "makelaars site:.nl breda"

    # Empty / edge inputs don't crash — they still get 'Nederland' appended
    # (defensive; realistically the caller always passes a query).
    assert apply_country_context("") == " Nederland"

    print(
        f"OK: NATIONAL_CHAINS contains {len(chains)} entries; apply_country_context works as expected."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
