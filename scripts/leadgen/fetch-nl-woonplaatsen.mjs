#!/usr/bin/env node
// One-shot fetch of the CBS BAG woonplaats list from PDOK's locatieserver.
// Writes data/leadgen/nl-woonplaatsen.json, ~2,500 rows. Rerun manually
// when the CBS registry changes (rarely — < 1×/year).
//
// The output json is the source of truth for LOCATION_ROTATION in
// run-scheduled-leadgen.mjs. Each row has:
//   { name, gemeente, provincie, code, is_active }
// where is_active flags whether the sweep should currently include it.
// Non-active rows stay in the file so future policy tweaks can flip
// them on without another fetch — CBS registry churn is not the
// binding factor, our filter policy is.
//
// Usage:
//   node scripts/leadgen/fetch-nl-woonplaatsen.mjs

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const PDOK_BASE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/leadgen/nl-woonplaatsen.json');
const CURRENT_ROTATION_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../run-scheduled-leadgen.mjs');
const USER_AGENT = 'orion-leadgen/1.0 (vbjtechservices@gmail.com)';

// Common historic naming pairs — Dutch cities often have both a Dutch
// name in everyday use and an official BAG woonplaatsnaam. Search engines
// happily accept either but the JSON must use the BAG name so state
// comparisons stay consistent.
const NAME_ALIASES = new Map([
  ['Den Haag', "'s-Gravenhage"],
  ['Den Bosch', "'s-Hertogenbosch"],
]);

function extractCurrentRotation() {
  // Read the LOCATION_ROTATION array from run-scheduled-leadgen.mjs so we
  // preserve the operator's curated 565 entries as always-active. This is
  // a one-time bootstrap — after this fetch, the JSON is the source of
  // truth. We only look at the source for the FIRST fetch to seed the
  // legacy is_active flags.
  try {
    const src = readFileSync(CURRENT_ROTATION_PATH, 'utf8');
    const match = src.match(/export const LOCATION_ROTATION = \[([\s\S]*?)\];/);
    if (!match) return new Set();
    // Strip line comments before extracting string literals so the //
    // section-header comments in the array (like "// Noord-Holland")
    // don't leak into the curated set.
    //
    // Match BOTH single- and double-quoted string literals. Some Dutch
    // town names start with an apostrophe ("'s-Hertogenbosch",
    // "'s-Gravenhage") and are stored in double quotes for that
    // reason. A single-quote-only regex captured the apostrophe as a
    // string terminator and produced garbage extraction that lost 227
    // names from the "curated" set.
    const arrayBody = match[1].replace(/\/\/[^\n]*/g, '');
    const entries = [...arrayBody.matchAll(/'([^']*)'|"([^"]*)"/g)]
      .map((m) => (m[1] ?? m[2] ?? '').trim())
      .filter((s) => s.length > 0);
    return new Set(entries);
  } catch {
    return new Set();
  }
}

async function fetchAllWoonplaatsen() {
  const rows = [];
  const pageSize = 100;
  let start = 0;
  for (;;) {
    const url = new URL(PDOK_BASE);
    url.searchParams.set('q', '*:*');
    url.searchParams.set('fq', 'type:woonplaats');
    url.searchParams.set('rows', String(pageSize));
    url.searchParams.set('start', String(start));
    url.searchParams.set('sort', 'woonplaatscode asc');
    url.searchParams.set('wt', 'json');
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`PDOK fetch failed (${response.status}) at start=${start}`);
    const payload = await response.json();
    const docs = payload?.response?.docs || [];
    const numFound = Number(payload?.response?.numFound || 0);
    for (const doc of docs) {
      rows.push({
        name: String(doc.woonplaatsnaam || '').trim(),
        gemeente: String(doc.gemeentenaam || '').trim(),
        provincie: String(doc.provincienaam || '').trim(),
        provincie_afkorting: String(doc.provincieafkorting || '').trim(),
        woonplaatscode: String(doc.woonplaatscode || '').trim(),
      });
    }
    start += docs.length;
    process.stderr.write(`fetched ${rows.length} / ${numFound}\n`);
    if (docs.length === 0 || start >= numFound) break;
  }
  return rows;
}

function applyActiveFilter(rows /* , curatedSet unused for now */) {
  // Ship ALL 2,502 as is_active=true (2026-09-03 operator ask). An earlier
  // conservative filter (municipality capital + small-gemeente + curated)
  // dropped ~1,660 tiny hamlets, which was too aggressive: some of those
  // do have local businesses worth searching, and the yield-tracking
  // Tier 2 pass (deferred) will empirically flag the truly unproductive
  // ones without us having to guess upfront. Better to over-include and
  // measure than under-include and never discover.
  //
  // is_active stays a per-row flag rather than being removed entirely so
  // a future Tier 2 pass can flip individual rows to false based on real
  // yield data without needing to re-fetch or re-shape the file.
  return rows.map((r) => ({ ...r, is_active: true }));
}

async function main() {
  const rawRows = await fetchAllWoonplaatsen();
  process.stderr.write(`Fetched ${rawRows.length} raw woonplaatsen from PDOK\n`);
  const withFlags = applyActiveFilter(rawRows);
  const activeCount = withFlags.filter((r) => r.is_active).length;
  process.stderr.write(`Active after filter: ${activeCount} / ${withFlags.length}\n`);

  const doc = {
    source: 'PDOK BAG locatieserver v3.1 (fq=type:woonplaats)',
    fetched_at: new Date().toISOString(),
    filter_policy: 'is_active = true for all rows (2026-09-03: yield tracking Tier 2 will empirically flag unproductive ones later)',
    total: withFlags.length,
    active_count: activeCount,
    rows: withFlags.sort((a, b) => a.name.localeCompare(b.name, 'nl')),
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  process.stderr.write(`Wrote ${OUT_PATH}\n`);
}

main().catch((error) => {
  process.stderr.write(`fetch failed: ${error?.message || error}\n`);
  process.exit(1);
});
