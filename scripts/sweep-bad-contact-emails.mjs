#!/usr/bin/env node
// One-time sweep (safe to re-run idempotently) that marks every lead
// whose `contact_email` fails the shared TLD allowlist as
// `status: 'rejected_fit'`. Catches the historical junk that
// accumulated BEFORE the scraper (2026-10-20) and qualifier
// (2026-10-27) gates were tightened — rows like
// `info@foo.webp`, `contact@bar.css`, etc.
//
// Usage:
//   node scripts/sweep-bad-contact-emails.mjs          # dry-run (default)
//   node scripts/sweep-bad-contact-emails.mjs --apply  # actually PATCH
//
// Each rewrite stores the prior status + the exact failing email in
// `qualification.sweep_rejection_*` so the operator can audit, and
// if desired reverse, every change by lead id.

import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { isObviouslyBogusContactEmail } from './lib/email-tld-allowlist.mjs';

const DRY_RUN = !process.argv.includes('--apply');
const PAGE_SIZE = 1000;
const SWEEP_REASON = 'contact_email_obviously_bogus';

const config = loadRuntimeConfig();
const supabaseUrl = config.env.SUPABASE_URL;
const apiKey = config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !apiKey) {
  throw new Error('Missing SUPABASE_URL / API key — check config/supabase/.env');
}
const headers = {
  apikey: apiKey,
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
};

async function fetchLeadsPage(offset) {
  // Only pull leads that (a) have a non-null contact_email and (b) are
  // not already rejected/suppressed/sent — those paths won't send
  // regardless of this flag. Filtering upstream keeps the sweep cheap.
  const url = new URL('/rest/v1/leads', supabaseUrl);
  url.searchParams.set('select', 'id,domain,contact_email,status,qualification,business_name');
  url.searchParams.set('contact_email', 'not.is.null');
  url.searchParams.set('status', 'not.in.(rejected_fit,suppressed,unsubscribed,bounced,sent)');
  url.searchParams.set('order', 'created_at.asc');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(offset));
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`fetchLeadsPage failed at offset=${offset}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function patchLead(lead, nowIso) {
  const url = new URL(`/rest/v1/leads?id=eq.${encodeURIComponent(lead.id)}`, supabaseUrl);
  const patch = {
    status: 'rejected_fit',
    qualification: {
      ...(lead.qualification || {}),
      sweep_rejection_reason: SWEEP_REASON,
      sweep_rejection_at: nowIso,
      sweep_rejection_email: lead.contact_email,
      sweep_rejection_prior_status: lead.status || null,
    },
  };
  const response = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${lead.id} failed: ${response.status} ${await response.text()}`);
  }
}

const nowIso = new Date().toISOString();
const toReject = [];
let offset = 0;
let scanned = 0;

while (true) {
  const page = await fetchLeadsPage(offset);
  if (!Array.isArray(page) || page.length === 0) break;
  scanned += page.length;
  for (const lead of page) {
    if (isObviouslyBogusContactEmail(lead.contact_email)) {
      toReject.push(lead);
    }
  }
  if (page.length < PAGE_SIZE) break;
  offset += PAGE_SIZE;
}

process.stdout.write(`[sweep-bad-contact-emails] scanned ${scanned} active lead(s), ${toReject.length} fail the TLD allowlist\n`);

// Group a few for a readable preview — don't dump 500 rows into the
// terminal.
const byTld = new Map();
for (const lead of toReject) {
  const addr = String(lead.contact_email || '');
  const dot = addr.lastIndexOf('.');
  const tld = dot < 0 ? '(none)' : addr.slice(dot + 1).toLowerCase();
  const bucket = byTld.get(tld) || [];
  bucket.push(lead);
  byTld.set(tld, bucket);
}
const sortedBuckets = [...byTld.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [tld, bucket] of sortedBuckets) {
  const sample = bucket.slice(0, 3).map((l) => `${l.contact_email} (${l.business_name || l.domain})`).join(' | ');
  process.stdout.write(`  .${tld}: ${bucket.length} lead(s) — sample: ${sample}${bucket.length > 3 ? ' …' : ''}\n`);
}

if (DRY_RUN) {
  process.stdout.write('\nDRY RUN. Pass --apply to actually PATCH these to status=rejected_fit.\n');
  process.exit(0);
}

let patched = 0;
for (const lead of toReject) {
  try {
    await patchLead(lead, nowIso);
    patched += 1;
    if (patched % 25 === 0) {
      process.stdout.write(`  patched ${patched}/${toReject.length}\n`);
    }
  } catch (error) {
    process.stderr.write(`[sweep] FAILED to patch ${lead.id} (${lead.contact_email}): ${error.message}\n`);
  }
}
process.stdout.write(`\n[sweep-bad-contact-emails] patched ${patched} / ${toReject.length} lead(s) → status=rejected_fit\n`);
process.stdout.write('Reversible per-lead via qualification.sweep_rejection_prior_status + sweep_rejection_email.\n');
