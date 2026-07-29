import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { fetchBlockedDomains, fetchExistingLeadKeys, upsertLeads } from '../../../scripts/lib/leadgen-supabase.mjs';
import { withRetry } from '../../lib/retry.mjs';

const DEFAULT_MAX_RESULTS = 10;

function resolvePythonBin(config) {
  const configuredBin = config?.env?.LEADGEN_PYTHON_BIN;
  if (configuredBin) {
    return configuredBin;
  }

  const venvPython = resolve(projectRoot, '.venv-leadgen', 'bin', 'python3');
  return existsSync(venvPython) ? venvPython : 'python3';
}

function resolveSearchScriptPath() {
  return resolve(projectRoot, 'services', 'leadgen-scraper', 'search_leads.py');
}

function runPythonSearch(query, max, config, skipDomainsFile, blockedDomainsFile) {
  return new Promise((resolvePromise, rejectPromise) => {
    const pythonBin = resolvePythonBin(config);
    const scriptPath = resolveSearchScriptPath();
    const args = [scriptPath, query, '--max', String(max)];
    if (skipDomainsFile) {
      args.push('--skip-domains-file', skipDomainsFile);
    }
    if (blockedDomainsFile) {
      args.push('--blocked-domains-file', blockedDomainsFile);
    }

    const child = spawn(pythonBin, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(new Error(`Could not start leadgen search: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `Leadgen search exited with code ${code}.`));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        rejectPromise(new Error(`Could not parse leadgen search output: ${error.message}`));
      }
    });
  });
}

function isUsableLead(record) {
  return Boolean(
    record
    && !record.error
    && record.business_name
    && record.business_name !== 'NA',
  );
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

const KVK_NUMBER_PATTERN = /^\d{8}$/;
const WEBSITE_QUALITY_LABELS = new Set(['modern', 'dated', 'minimal', 'broken']);

function sanitizeKvkNumber(value) {
  // Backstop for extract_lead.py's own validator, in case scrapegraphai
  // doesn't actually re-run pydantic validation on the raw LLM output —
  // the model has been observed returning addresses and placeholder
  // numbers here instead of null. Only a bare 8-digit string counts,
  // and 12345678 passes the shape but is the classic placeholder
  // (observed live on a real batch).
  const trimmed = String(value || '').trim();
  if (!KVK_NUMBER_PATTERN.test(trimmed) || trimmed === '12345678' || trimmed === '87654321') {
    return null;
  }
  return trimmed;
}

function sanitizeWebsiteQuality(value) {
  // Observed junk in this field: ".", "low", a full URL. Labels only.
  const normalized = String(value || '').trim().toLowerCase();
  return WEBSITE_QUALITY_LABELS.has(normalized) ? normalized : null;
}

function sanitizePhone(value) {
  // The model has been observed inventing a placeholder phone number
  // ("+31 020 1234567") for a page that showed no phone at all — a fake
  // number in outreach is worse than an empty field. Sequential-digit
  // runs are the placeholder signature; real Dutch numbers don't contain
  // them.
  const trimmed = String(value || '').trim();
  if (!trimmed || /123456|654321/.test(trimmed.replace(/[^0-9]/g, ''))) {
    return null;
  }
  return trimmed;
}

const TRACKING_PARAMS = ['srsltid', 'gclid', 'fbclid', 'msclkid'];

function cleanSourceUrl(url) {
  try {
    const parsed = new URL(url);
    for (const param of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.includes(param) || param.startsWith('utm_')) {
        parsed.searchParams.delete(param);
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function mapLeadToRow(record, context = {}, existingByDomain = new Map()) {
  // Every row in one upsertLeads() call must carry the EXACT same set of
  // keys — PostgREST's bulk insert builds one fixed column list from the
  // batch and rejects mismatched objects with PGRST102 "All object keys
  // must match" (this took down every niche in the 2026-07-20 sweep: rows
  // with an email and rows without had different key sets in the same
  // batch). So every optional column is ALWAYS present here.
  //
  // The value itself still prefers the newly-extracted one, falling back to
  // whatever's already stored for this domain — never sending an explicit
  // null over a value a previous run already captured (the bug the
  // omit-when-empty approach was originally trying to fix, the day before).
  const domain = extractDomain(record.source_url);
  const existing = existingByDomain.get(domain) || {};

  return {
    source_url: cleanSourceUrl(record.source_url),
    domain,
    business_name: record.business_name,
    business_type: record.business_type || '',
    services: Array.isArray(record.services) ? record.services : [],
    social_links: Array.isArray(record.social_links) ? record.social_links : [],
    contact_email: record.contact_email || existing.contact_email || null,
    contact_phone: sanitizePhone(record.contact_phone) || existing.contact_phone || null,
    kvk_number: sanitizeKvkNumber(record.kvk_number) || existing.kvk_number || null,
    website_quality: sanitizeWebsiteQuality(record.website_quality) || existing.website_quality || null,
    search_query: context.query || '',
    niche: context.niche || '',
    location: context.location || '',
    status: 'new',
    raw_extraction: record,
  };
}

export async function runLeadgenSearch(query, max, config, options = {}) {
  const boundedMax = Math.min(Math.max(Number(max) || DEFAULT_MAX_RESULTS, 1), 50);

  // Skip domains already saved from any previous run — the same search
  // query returns largely the same top results every time, and without
  // this every batch re-extracts (~25s each) and re-reports businesses
  // that are already in the table as if they were new finds.
  let skipDomainsFile = null;
  let blockedDomainsFile = null;
  let tempDir = null;
  let knownKvkNumbers = new Set();
  let existingByDomain = new Map();
  try {
    const existingKeys = await fetchExistingLeadKeys();
    knownKvkNumbers = new Set(existingKeys.kvkNumbers);
    existingByDomain = existingKeys.byDomain || new Map();
    if (existingKeys.domains.length > 0) {
      tempDir = mkdtempSync(join(tmpdir(), 'leadgen-'));
      skipDomainsFile = join(tempDir, 'known-domains.txt');
      writeFileSync(skipDomainsFile, existingKeys.domains.join('\n'), 'utf8');
    }
  } catch {
    // If the pre-check fails (e.g. table missing), run without it — the
    // domain-level upsert still prevents duplicate rows either way.
  }

  try {
    // The Supabase table is the authoritative denylist; the Python-side
    // hardcoded set stays as the fallback seed when this fetch fails.
    const blockedDomains = await fetchBlockedDomains();
    if (blockedDomains.length > 0) {
      tempDir = tempDir || mkdtempSync(join(tmpdir(), 'leadgen-'));
      blockedDomainsFile = join(tempDir, 'blocked-domains.txt');
      writeFileSync(blockedDomainsFile, blockedDomains.join('\n'), 'utf8');
    }
  } catch {
    // Table not created yet or unreachable — python's built-in list covers it.
  }

  let records;
  try {
    records = await runPythonSearch(query, boundedMax, config, skipDomainsFile, blockedDomainsFile);
  } finally {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
  const extractedLeads = (Array.isArray(records) ? records : []).filter(isUsableLead);
  let alreadyKnownCount = (Array.isArray(records) ? records : [])
    .filter((record) => String(record?.error || '').includes('already in leads table'))
    .length;

  // Same business, different domain: KvK number is the business-identity
  // key domain dedup can't see (observed twice in one sweep — a company
  // running a branded site plus an SEO city domain, both extracted as
  // separate "leads" with the same KvK).
  const usableLeads = [];
  const batchKvkNumbers = new Set();
  for (const record of extractedLeads) {
    const kvk = sanitizeKvkNumber(record.kvk_number);
    if (kvk && (knownKvkNumbers.has(kvk) || batchKvkNumbers.has(kvk))) {
      alreadyKnownCount += 1;
      continue;
    }
    if (kvk) {
      batchKvkNumbers.add(kvk);
    }
    usableLeads.push(record);
  }

  let insertedCount = 0;
  if (usableLeads.length > 0) {
    const rows = usableLeads.map((record) => mapLeadToRow(record, {
      query,
      niche: options.niche || '',
      location: options.location || '',
    }, existingByDomain));
    // A whole batch of already-extracted leads (real work: search + one
    // Playwright/Ollama pass per URL) must not be thrown away over a
    // transient Supabase blip — retry before giving up.
    const upserted = await withRetry(() => upsertLeads(rows), { label: 'Supabase lead save' });
    insertedCount = Array.isArray(upserted) ? upserted.length : rows.length;
  }

  return {
    searchedCount: Array.isArray(records) ? records.length : 0,
    leadCount: usableLeads.length,
    skippedCount: (Array.isArray(records) ? records.length : 0) - usableLeads.length,
    alreadyKnownCount,
    insertedCount,
    // full list, not truncated — the leadCount/insertedCount in Discord
    // messages must match how many names are actually shown, or it reads
    // as a discrepancy. Callers truncate for display if they want to.
    leadsPreview: usableLeads.map((record) => ({
      name: record.business_name,
      url: record.source_url,
    })),
  };
}
