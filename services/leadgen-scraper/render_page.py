#!/usr/bin/env python3
"""Render a page in headless Chromium and print its visible text.

Fallback for the qualification step when a site blocks plain HTTP fetches
(403/anti-bot): a real browser render usually passes. Deliberately gentle —
one page, one attempt, hard timeout, no crawling.

Usage:
    python render_page.py https://example.com
"""

import sys

from playwright.sync_api import sync_playwright

PAGE_TIMEOUT_MS = 30000
MAX_TEXT_CHARS = 8000


def render(url: str) -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
                )
            )
            page.goto(url, timeout=PAGE_TIMEOUT_MS, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)  # let late JS content settle
            text = page.inner_text("body")
            return " ".join(text.split())[:MAX_TEXT_CHARS]
        finally:
            browser.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python render_page.py <url>", file=sys.stderr)
        sys.exit(1)

    try:
        print(render(sys.argv[1]))
    except Exception as exc:
        print(f"render failed: {exc}", file=sys.stderr)
        sys.exit(1)
