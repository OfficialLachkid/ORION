#!/usr/bin/env node
// Seed the blocked_domains table with domains that keep surfacing in
// leadgen searches but are not real single-business sites — municipal
// portals, provincial government pages, industry directories, and
// patient associations. Observed live over a 3-day sweep window
// (2026-09-03 through 2026-09-05, ~48 leads). Every one of these
// consumed a scraper slot only to be flagged extraction_error or, worse,
// stored as a spurious "clinic" or "recruitment agency" lead.
//
// The blocked_domains table is the authoritative deny-list — search_leads.py
// picks up the top entries as DuckDuckGo `-site:` prefilters, and the
// worker also filters out any URL whose host matches after search results
// come back. Idempotent: addBlockedDomain uses on_conflict=domain so
// re-running this is a no-op.
//
// Run manually when the operator (or a future auto-classifier) spots
// another persistently-noisy domain:
//   node scripts/leadgen/seed-blocked-directory-domains.mjs

import process from 'node:process';
import { addBlockedDomain, isLeadgenPersistenceConfigured, getLeadgenPersistenceConfig } from '../lib/leadgen-supabase.mjs';

const DOMAINS = [
  { domain: 'drenthe.nl', reason: 'Provincial government portal, not a business.' },
  { domain: 'wegwijshaarlem.nl', reason: 'Municipal information portal, not a business.' },
  { domain: 'sthubert.nu', reason: 'Village community portal, not a business.' },
  { domain: 'fluitenberg-online.nl', reason: 'Village community portal, not a business.' },
  { domain: 'bedrijfnederland.nl', reason: 'National business directory (aggregator), not a single business.' },
  { domain: 'vektis.nl', reason: 'Healthcare data infrastructure, not a target business.' },
  { domain: 'leisuremakelaarsnederland.nl', reason: 'Directory / franchise umbrella, not a single real estate agent.' },
  { domain: 'epilepsie.nl', reason: 'Patient association (EpilepsieNL stichting), not a commercial clinic.' },
  { domain: 'hellart.work', reason: 'Job aggregator for sustainability roles, not a recruitment agency.' },
  { domain: 'dutchpat.nl', reason: 'Non-commercial healthcare content, not a clinic.' },
];

async function main() {
  const config = getLeadgenPersistenceConfig();
  if (!isLeadgenPersistenceConfigured(config)) {
    process.stderr.write('Supabase is not configured (SUPABASE_URL or SERVICE_ROLE_KEY missing).\n');
    process.exit(1);
  }

  let successCount = 0;
  const failures = [];
  for (const entry of DOMAINS) {
    try {
      await addBlockedDomain(entry.domain, entry.reason);
      successCount += 1;
      process.stdout.write(`ok  ${entry.domain}\n`);
    } catch (error) {
      failures.push({ domain: entry.domain, message: error?.message || String(error) });
      process.stderr.write(`fail ${entry.domain}: ${error?.message || error}\n`);
    }
  }

  process.stdout.write(`\nSeeded ${successCount}/${DOMAINS.length} blocked domains.\n`);
  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`seed failed: ${error?.message || error}\n`);
  process.exit(1);
});
