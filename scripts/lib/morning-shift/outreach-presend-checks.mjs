// Deterministic pre-send checks for fresh outreach drafts
// (`source_type: lead_qualification`). Each check returns
// { ok: boolean, reason?: string }; the orchestrator calls them in
// order and returns the first failure. Cheap in-memory checks run
// first, Supabase queries last. No LLM in the chain — the drafter is
// already an LLM, a second LLM pass is just paying twice for a
// correlated error.
//
// Follow-ups are auto-sent without pre-send checks because the
// drafter already battle-tested the address + personalisation on the
// first touch. Only fresh outreach runs through this module.

export const DEFAULT_BODY_MIN_CHARS = 100;
export const DEFAULT_BODY_MAX_CHARS = 5000;
export const DEFAULT_PER_DOMAIN_DAILY_CAP = 1;

// Regex patterns that catch common LLM-leakage into the drafter
// output. If any one hits the body or subject we refuse the send.
const DRAFTER_LEAKAGE_PATTERNS = [
  /\bas an ai\b/iu,
  /\bi (?:am|'m) an? (?:large )?language model\b/iu,
  /\bi apologi[sz]e (?:for|,)/iu,
  /\bhere(?:'s| is) (?:a |the |your )?(?:draft|revised|rewritten)/iu,
  /\bi cannot (?:comply|fulfill|generate|write)\b/iu,
  /\bi'?m sorry[,.]? (?:but|i)/iu,
  /\b(?:lorem ipsum|placeholder text)\b/iu,
];

// Unresolved template placeholders — if the drafter left any of
// these in the output, something went wrong upstream.
const PLACEHOLDER_PATTERNS = [
  /\{\{[^}]+\}\}/u,
  /\[(?:FIRST_NAME|LAST_NAME|COMPANY|BUSINESS|LEAD_NAME|DOMAIN|CITY)\]/iu,
  /<<[^>]+>>/u,
  /\bTODO:/u,
];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

// File-extension / asset-path "TLDs" that only appear when the lead
// scraper mistook a URL fragment or filename for a contact email.
// `flags@2x.webp` passed the plain shape check on 2026-10-27 because
// `.webp` has `[^\s@]+\.[^\s@]+` structure; nobody has a real inbox
// at `.webp`, so this is pure junk. Lowercased, compared against the
// substring after the final `.` in the "to" address.
export const BLOCKED_TLD_EXTENSIONS = new Set([
  // Image / media
  'webp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'bmp', 'tiff', 'tif',
  'webm', 'mp4', 'mp3', 'mov', 'avi', 'wav', 'ogg', 'flac',
  // Code / page assets
  'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'html', 'htm', 'json', 'xml',
  'yaml', 'yml', 'map', 'scss', 'sass', 'less', 'php',
  // Docs / archives
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
  'zip', 'tar', 'gz', 'rar', '7z',
  // Fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

function emailAddress(task) {
  return String(task?.email_request?.to || '').trim();
}

function emailSubject(task) {
  return String(task?.email_request?.subject || '').trim();
}

function emailBody(task) {
  return String(task?.email_request?.bodyText || '').trim();
}

function domainOf(task) {
  const explicit = String(task?.lead_domain || '').trim().toLowerCase();
  if (explicit) return explicit;
  const addr = emailAddress(task);
  const at = addr.lastIndexOf('@');
  return at === -1 ? '' : addr.slice(at + 1).toLowerCase();
}

// ─── Individual checks ──────────────────────────────────────────────

export function checkRequiredFields(task) {
  if (!emailAddress(task)) return { ok: false, reason: 'missing_to_address' };
  if (!emailSubject(task)) return { ok: false, reason: 'missing_subject' };
  if (!emailBody(task)) return { ok: false, reason: 'missing_body' };
  return { ok: true };
}

export function checkEmailShape(task) {
  const to = emailAddress(task);
  if (!EMAIL_SHAPE.test(to)) return { ok: false, reason: `invalid_to_address:${to}` };
  // Guard against scraped-asset addresses (e.g. flags@2x.webp): the
  // substring after the final `.` must not be a known file extension.
  const lastDot = to.lastIndexOf('.');
  const tld = lastDot === -1 ? '' : to.slice(lastDot + 1).toLowerCase();
  if (BLOCKED_TLD_EXTENSIONS.has(tld)) {
    return { ok: false, reason: `invalid_to_address_asset_tld:${to}` };
  }
  return { ok: true };
}

export function checkBodyLength(task, { min = DEFAULT_BODY_MIN_CHARS, max = DEFAULT_BODY_MAX_CHARS } = {}) {
  const length = emailBody(task).length;
  if (length < min) return { ok: false, reason: `body_too_short:${length}<${min}` };
  if (length > max) return { ok: false, reason: `body_too_long:${length}>${max}` };
  return { ok: true };
}

export function checkPlaceholderLeakage(task) {
  const combined = `${emailSubject(task)}\n${emailBody(task)}`;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = combined.match(pattern);
    if (match) return { ok: false, reason: `unresolved_placeholder:${match[0].slice(0, 40)}` };
  }
  return { ok: true };
}

export function checkDrafterLeakage(task) {
  const combined = `${emailSubject(task)}\n${emailBody(task)}`;
  for (const pattern of DRAFTER_LEAKAGE_PATTERNS) {
    const match = combined.match(pattern);
    if (match) return { ok: false, reason: `drafter_leakage:${match[0].slice(0, 40)}` };
  }
  return { ok: true };
}

// ─── Supabase-backed checks ─────────────────────────────────────────

// Rejects when the lead's domain has at least one sibling marked
// `unsubscribed` or `bounced` — same guard the qualifier already
// honours before drafting. We re-check at send time in case anything
// landed in the window between drafting (overnight) and sending
// (morning).
export async function checkSuppressedDomain(task, { supabaseFetch, leadsTable = 'leads' }) {
  const domain = domainOf(task);
  if (!domain) return { ok: true }; // address-shape check will catch this upstream
  if (typeof supabaseFetch !== 'function') return { ok: true }; // no Supabase → skip rather than block
  const path = `${leadsTable}?select=status&status=in.(unsubscribed,bounced)&domain=eq.${encodeURIComponent(domain)}&limit=1`;
  const rows = await supabaseFetch(path).catch(() => []);
  if (Array.isArray(rows) && rows.length > 0) {
    return { ok: false, reason: `suppressed_domain:${domain}:${rows[0]?.status || 'suppressed'}` };
  }
  return { ok: true };
}

// Rejects when this domain has already received `cap` or more
// outreach emails today (default: 1 — one touch per domain per
// morning). Reads `video_analytics`-style — actually, reads
// `email_outbox` or the `leads` table's `last_contacted_at`?
// We query the `leads` table for recent outreach timestamps on
// siblings of the same domain. If the schema evolves, this is one
// query to update.
export async function checkPerDomainDailyCap(task, {
  supabaseFetch, leadsTable = 'leads', cap = DEFAULT_PER_DOMAIN_DAILY_CAP, nowIso = new Date().toISOString(),
}) {
  const domain = domainOf(task);
  if (!domain) return { ok: true };
  if (typeof supabaseFetch !== 'function') return { ok: true };
  if (!Number.isFinite(cap) || cap <= 0) return { ok: true };
  const startOfToday = new Date(nowIso);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const sinceIso = startOfToday.toISOString();
  const path = `${leadsTable}?select=id&domain=eq.${encodeURIComponent(domain)}&last_contacted_at=gte.${encodeURIComponent(sinceIso)}&limit=${cap + 1}`;
  const rows = await supabaseFetch(path).catch(() => []);
  const count = Array.isArray(rows) ? rows.length : 0;
  if (count >= cap) {
    return { ok: false, reason: `per_domain_cap_hit:${domain}:${count}>=${cap}` };
  }
  return { ok: true };
}

// ─── Orchestrator ───────────────────────────────────────────────────

export async function runPresendChecks(task, deps = {}) {
  const cheapChecks = [
    checkRequiredFields,
    checkEmailShape,
    checkBodyLength,
    checkPlaceholderLeakage,
    checkDrafterLeakage,
  ];
  for (const check of cheapChecks) {
    const result = check(task, deps);
    if (!result.ok) return result;
  }
  const suppressed = await checkSuppressedDomain(task, deps);
  if (!suppressed.ok) return suppressed;
  const capped = await checkPerDomainDailyCap(task, deps);
  if (!capped.ok) return capped;
  return { ok: true };
}
