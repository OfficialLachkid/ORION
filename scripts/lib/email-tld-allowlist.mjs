// Shared email-TLD allowlist for the leadgen pipeline. Extracted from
// services/leadgen-scraper/src/worker.mjs on 2026-10-27 after
// `flags@2x.webp` slipped past the scraper's old loose `.[a-z]{2,}`
// tail and ended up queued for outreach. The scraper had added this
// allowlist a week earlier but the qualifier's local-LLM email
// discovery (`contact_email_recovered` path in
// run-lead-qualification.mjs) was still using the loose regex, so
// a bogus address returned by the LLM still landed on a lead row.
//
// Both gates (scraper + qualifier) now share THIS list. The
// morning-shift pre-send check (outreach-presend-checks.mjs) keeps
// a *blocklist* as a final defensive layer — allowlists are strict
// (safer for the DB) and blocklists are loose (safer at send time
// so a legitimate but missing-from-allowlist TLD doesn't block real
// business), so we run both.

export const EMAIL_TLD_ALLOWLIST = new Set([
  // EU + NL-adjacent ccTLDs
  'nl', 'be', 'de', 'fr', 'uk', 'es', 'it', 'pt', 'pl', 'se', 'no', 'dk',
  'fi', 'at', 'ch', 'lu', 'ie', 'cz', 'gr', 'ro', 'hu', 'bg', 'hr', 'si',
  'sk', 'lt', 'lv', 'ee', 'mt', 'cy', 'is', 'li', 'mc', 'tr', 'ru', 'ua',
  'rs', 'ba', 'mk', 'me', 'al', 'md', 'by', 'ge', 'am', 'az', 'kz',
  // Rest of world common
  'us', 'ca', 'mx', 'br', 'ar', 'cl', 'co', 'pe',
  'au', 'nz', 'jp', 'kr', 'cn', 'in', 'hk', 'sg', 'tw', 'th', 'my', 'id',
  'ph', 'vn', 'pk', 'bd', 'il', 'ae', 'sa', 'za', 'ng', 'ke', 'eg', 'ma', 'tn',
  // Country codes also commonly used as "generic"
  'io', 'tv', 'cc', 'ws', 'ai', 'so', 'gg', 'fm', 'eu',
  // Niue — commonly used by Dutch sites because "nu" means "now" in
  // Dutch. Caught by the 2026-10-27 backfill sweep: 7 legitimate NL
  // leads were being blocked (info@westlanders.nu, etc).
  'nu',
  // Core gTLDs
  'com', 'net', 'org', 'info', 'biz', 'pro', 'name', 'mobi', 'asia',
  'travel', 'jobs', 'tel', 'mail', 'email',
  // Modern business gTLDs commonly seen in Dutch SME contact pages
  'app', 'dev', 'cloud', 'tech', 'store', 'shop', 'online', 'site',
  'website', 'agency', 'studio', 'design', 'media', 'group', 'services',
  'solutions', 'consulting', 'systems', 'software', 'digital', 'marketing',
  'business', 'company', 'academy', 'foundation', 'world', 'today', 'works',
  'club', 'zone', 'center', 'team', 'support', 'press', 'blog', 'news',
  'gallery', 'photography', 'video', 'film', 'music', 'cafe', 'pizza',
  'bar', 'restaurant', 'pub', 'build', 'builders', 'contractors',
  'plumbing', 'electrician', 'law', 'legal', 'finance', 'bank', 'insurance',
  'health', 'clinic', 'dental', 'doctor', 'care', 'fit', 'fitness',
  'wellness', 'spa', 'yoga', 'life', 'family', 'school', 'university',
  'education', 'training', 'institute', 'house', 'home', 'properties',
  'realty', 'estate', 'rentals', 'apartments', 'holiday', 'hotel', 'tours',
  'vacation', 'flights', 'auto', 'cars', 'bike', 'motorcycle', 'green',
  'eco', 'organic', 'farm', 'garden', 'network', 'guru', 'ninja', 'rocks',
  'xyz', 'top', 'vip', 'link', 'page', 'space', 'international',
]);

export function hasValidEmailTld(email) {
  const addr = String(email || '');
  const atIndex = addr.lastIndexOf('@');
  if (atIndex < 0) return false; // not an email at all
  const dot = addr.lastIndexOf('.');
  if (dot < atIndex) return false; // dot is in the local-part, not after the @
  const tld = addr.slice(dot + 1).toLowerCase();
  return EMAIL_TLD_ALLOWLIST.has(tld);
}

const EMAIL_REGEX = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// Known file-extension TLDs that only appear when the scraper OR the
// local-LLM qualifier mistook an asset path or filename for an email.
// Mirrors services/leadgen-scraper/src/... and
// scripts/lib/morning-shift/outreach-presend-checks.mjs — centralised
// here so every gate shares the same list.
const BLOCKED_ASSET_TLDS = new Set([
  'webp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'bmp', 'tiff', 'tif',
  'webm', 'mp4', 'mp3', 'mov', 'avi', 'wav', 'ogg', 'flac',
  'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'html', 'htm', 'json', 'xml',
  'yaml', 'yml', 'map', 'scss', 'sass', 'less', 'php',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
  'zip', 'tar', 'gz', 'rar', '7z',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

// "Obviously bogus" verdict for the backfill sweep. True when we're
// confident the contact_email was never going to work:
//   - no `@` at all (placeholder text like "Contact via website")
//   - no dot in the domain part
//   - TLD is a known asset extension (.webp, .css, .pdf, …)
//   - TLD starts with a valid TLD but has 3+ extra alphabetic chars
//     (scraper swallowed the next Dutch word, e.g. `.commaandag`
//     [com + maandag], `.netmaandag`, `.comtelefoonnummer`)
// Returns false for recoverable formatting cruft like `.nl\`,
// `.nl)`, `.nl/contact/` — those get left for a future cleanup pass
// so we don't throw away real leads.
export function isObviouslyBogusContactEmail(email) {
  const addr = String(email || '').toLowerCase().trim();
  if (!addr) return true;
  const atIndex = addr.lastIndexOf('@');
  if (atIndex < 0) return true;
  const domainPart = addr.slice(atIndex + 1);
  const dot = domainPart.lastIndexOf('.');
  if (dot < 0) return true;
  const tld = domainPart.slice(dot + 1);
  if (BLOCKED_ASSET_TLDS.has(tld)) return true;
  // Glued-word check: scraper swallowed a Dutch word onto a valid TLD.
  for (const valid of EMAIL_TLD_ALLOWLIST) {
    if (tld.length > valid.length && tld.startsWith(valid)) {
      const extra = tld.slice(valid.length);
      if (/^[a-z]{3,}$/u.test(extra)) return true;
    }
  }
  return false;
}

// Scan `text` for the first email whose TLD is in the allowlist.
// Returns null when nothing matches. Case-insensitive; callers
// typically lowercase the result.
export function pickFirstValidEmail(text) {
  if (!text) return null;
  for (const match of String(text).matchAll(EMAIL_REGEX)) {
    const candidate = match[0];
    if (hasValidEmailTld(candidate)) return candidate;
  }
  return null;
}
