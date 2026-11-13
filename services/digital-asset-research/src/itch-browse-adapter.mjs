import { createHash, randomUUID } from 'node:crypto';

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/gu, ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ')
    .replace(/&#(\d+);/gu, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/\s+/gu, ' ')
    .trim();
}

function firstMatch(value, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return '';
}

function listingUrl(cell) {
  const matches = [...cell.matchAll(/href=["'](https:\/\/[^"']+\.itch\.io\/[^"'#?]+)[^"']*["']/giu)];
  return matches.map((match) => match[1]).find((value) => {
    try { return new URL(value).hostname.endsWith('.itch.io'); } catch { return false; }
  }) || '';
}

export function parseItchBrowseHtml(html, context) {
  const chunks = String(html || '').split(/(?=<[^>]+class=["'][^"']*\bgame_cell\b)/giu).slice(1);
  const observedAt = context.observedAt || new Date().toISOString();
  const maximumItems = context.maximumItems || 30;
  const observations = [];
  for (const cell of chunks) {
    if (observations.length >= maximumItems) break;
    const url = listingUrl(cell);
    const title = firstMatch(cell, [
      /class=["'][^"']*\bgame_title\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
      /class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
      /class=["'][^"']*\bgame_link\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
    ]);
    if (!url || !title) continue;
    const creator = firstMatch(cell, [
      /class=["'][^"']*\bgame_author\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
      /class=["'][^"']*\buser_link\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
    ]);
    const priceText = firstMatch(cell, [
      /class=["'][^"']*\bprice_value\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
      /class=["'][^"']*\bprice_tag\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
    ]);
    const summary = firstMatch(cell, [
      /class=["'][^"']*\bgame_text\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
      /class=["'][^"']*\bgame_description\b[^"']*["'][^>]*>([\s\S]*?)<\//iu,
    ]);
    const evidenceHash = createHash('sha256')
      .update(JSON.stringify({ url, title, creator, priceText, summary, view: context.view.id }))
      .digest('hex');
    observations.push({
      observation_id: randomUUID(),
      run_id: context.runId,
      source_id: context.sourceId,
      view_id: context.view.id,
      signal: context.view.signal,
      observed_at: observedAt,
      rank: observations.length + 1,
      listing_url: url,
      title,
      creator,
      price_text: priceText,
      summary,
      tags: [],
      evidence_hash: evidenceHash,
    });
  }
  return observations;
}

// itch.io 429 retry: without this, a single rate-limited view aborts the
// whole nightly research run and still charges Supabase egress on the
// failure-row write. With it, we honor Retry-After (or a bounded backoff)
// and keep the run alive. 429-only on purpose — 5xx retries would hammer
// itch.io and 4xx retries can't succeed.
const ITCH_RETRY_MAX_ATTEMPTS = 3;
const ITCH_RETRY_BACKOFF_MS = [2000, 5000];
const ITCH_RETRY_AFTER_CAP_MS = 60000;

function parseRetryAfterMs(headerValue) {
  const value = String(headerValue || '').trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(ITCH_RETRY_AFTER_CAP_MS, Math.ceil(seconds * 1000));
  const asDate = Date.parse(value);
  if (!Number.isFinite(asDate)) return null;
  return Math.max(0, Math.min(ITCH_RETRY_AFTER_CAP_MS, asDate - Date.now()));
}

export async function fetchItchBrowseView(options) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let response;
  let html = '';
  for (let attempt = 1; attempt <= ITCH_RETRY_MAX_ATTEMPTS; attempt += 1) {
    response = await fetchImpl(options.view.url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': options.userAgent,
      },
      redirect: 'follow',
    });
    html = await response.text();
    if (response.status !== 429) break;
    if (attempt === ITCH_RETRY_MAX_ATTEMPTS) {
      const retryAfter = response.headers.get('retry-after') || 'unspecified';
      throw new Error(`itch.io research request was rate limited; Retry-After=${retryAfter}. No partial run was stored.`);
    }
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const backoffMs = retryAfterMs != null
      ? retryAfterMs
      : ITCH_RETRY_BACKOFF_MS[Math.min(attempt - 1, ITCH_RETRY_BACKOFF_MS.length - 1)];
    await sleepImpl(backoffMs);
  }
  if (!response.ok) throw new Error(`itch.io research request failed (${response.status}) for ${options.view.id}.`);
  const observations = parseItchBrowseHtml(html, {
    runId: options.runId,
    sourceId: options.sourceId,
    view: options.view,
    observedAt: options.observedAt,
    maximumItems: options.maximumItems,
  });
  if (!observations.length) {
    throw new Error(`itch.io returned no parseable listings for ${options.view.id}; refusing to store an empty baseline.`);
  }
  return { html, observations, finalUrl: response.url || options.view.url };
}
