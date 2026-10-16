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

export async function fetchItchBrowseView(options) {
  const response = await (options.fetchImpl || fetch)(options.view.url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': options.userAgent,
    },
    redirect: 'follow',
  });
  const html = await response.text();
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || 'unspecified';
    throw new Error(`itch.io research request was rate limited; Retry-After=${retryAfter}. No partial run was stored.`);
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
