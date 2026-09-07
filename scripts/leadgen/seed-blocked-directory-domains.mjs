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
  // === 2026-09-05 batch (PR #89) ===
  // Municipal / provincial portals and community sites
  { domain: 'drenthe.nl', reason: 'Provincial government portal, not a business.' },
  { domain: 'wegwijshaarlem.nl', reason: 'Municipal information portal, not a business.' },
  { domain: 'sthubert.nu', reason: 'Village community portal, not a business.' },
  { domain: 'fluitenberg-online.nl', reason: 'Village community portal, not a business.' },
  { domain: 'nieuweschoot.info', reason: 'Village community portal (dorp in de gemeente Heerenveen), not a business.' },
  // National directories / aggregators / comparison sites
  { domain: 'bedrijfnederland.nl', reason: 'National business directory (aggregator), not a single business.' },
  { domain: 'vektis.nl', reason: 'Healthcare data infrastructure, not a target business.' },
  { domain: 'leisuremakelaarsnederland.nl', reason: 'Directory / franchise umbrella, not a single real estate agent.' },
  // Non-commercial / patient association / content sites
  { domain: 'epilepsie.nl', reason: 'Patient association (EpilepsieNL stichting), not a commercial clinic.' },
  { domain: 'hellart.work', reason: 'Job aggregator for sustainability roles, not a recruitment agency.' },
  { domain: 'dutchpat.nl', reason: 'Non-commercial healthcare content, not a clinic.' },

  // === 2026-09-06 batch ===
  // Comparison / "vergelijken" / "gids" platforms — LLM correctly
  // labeled these as "Online platform for comparing …" in the extracted
  // business_type field. Blocklisting them upfront saves the ~25s
  // Playwright+Ollama round trip per hit.
  { domain: 'aannemer-nu.nl', reason: 'Comparison platform for contractors, not a single aannemer.' },
  { domain: 'elektricienvergelijken.nl', reason: 'Comparison platform for electricians, not a single business.' },
  { domain: 'rijscholenvergelijken.nl', reason: 'Comparison platform for driving schools, not a single rijschool.' },
  { domain: 'verhuisoffertes.com', reason: 'Comparison platform for moving quotes, not a single verhuisbedrijf.' },
  { domain: 'hypotheekadviseurgids.nl', reason: '"Gids" directory for mortgage advisors, not a single advisor.' },
  { domain: 'aircokenner.nl', reason: 'Airconditioning information platform, not an installer.' },
  { domain: 'kinderopvanglijst.nl', reason: 'Directory/aggregator for daycares — LLM literally labeled it that way.' },
  { domain: 'verbouwpro.nl', reason: '"Bemiddelingsplatform" for construction jobs, not a stukadoor.' },
  { domain: 'vloerenservice.com', reason: 'Online platform matching customers to floor installers, not a single vloerlegger.' },
  { domain: 'bablu.nl', reason: 'Dienstverlener-platform (service-provider marketplace), not a kozijnen business.' },
  { domain: 'klaardeklus.nl', reason: 'Dienstenplatform (service marketplace), not a single vloerlegger.' },
  { domain: 'mindsetking.nl', reason: 'Blogplatform for health content, not a fysiotherapie practice.' },
  { domain: 'sustainablejobs.nl', reason: 'Job aggregator for sustainability roles, not a recruitment agency.' },
  // Country-wide / plural / obscure-TLD templates that consistently
  // extraction_error. Each is EITHER a directory or a low-effort SEO
  // shell with no real business behind it — safer to block than fetch.
  // (Kept the plural-vs-singular heuristic loose here; single-name
  // SEO shells like "loodgieter-heemskerk.nl" are LEFT untouched per
  // operator's earlier preference.)
  { domain: 'vloerenbedrijven.nl', reason: 'Plural + generic domain = directory, not a single vloerlegger.' },
  { domain: 'dakdekkers.net', reason: 'Plural + generic domain = directory, not a single dakdekker.' },
  { domain: 'hoveniers-nederland.info', reason: 'Country-wide plural directory, not a single hoveniersbedrijf.' },
  { domain: 'hovenier.website', reason: 'Generic single-word + .website TLD = directory shell, not a real hovenier.' },
  { domain: 'loodgieter.ws', reason: 'Generic single-word + obscure .ws TLD = directory shell, not a real loodgieter.' },
  { domain: 'warmtepomp.ai', reason: 'Generic term + .ai TLD = tech/aggregator, not a heat-pump installer.' },
  { domain: 'interimsearchnederland.nl', reason: 'Country-wide interim-search umbrella, not a single recruitment agency.' },
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
