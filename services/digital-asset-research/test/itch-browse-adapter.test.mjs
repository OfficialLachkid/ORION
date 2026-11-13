import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchItchBrowseView, parseItchBrowseHtml } from '../src/itch-browse-adapter.mjs';

function makeResponse({ status = 200, body = '', retryAfter = null } = {}) {
  const headers = new Map();
  if (retryAfter != null) headers.set('retry-after', String(retryAfter));
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://itch.io/browse',
    headers: { get: (k) => headers.get(String(k).toLowerCase()) || null },
    text: async () => body,
  };
}

const PASSING_HTML = `
  <div class="game_cell" data-game_id="1">
    <a class="game_link" href="https://alpha.itch.io/a"><span class="game_title">A</span></a>
    <a class="game_author">Author</a><span class="price_value">$1.00</span>
  </div>
`;
const VIEW_FIXTURE = {
  view: { id: 'top', url: 'https://itch.io/browse', signal: 'marketplace_rank_proxy' },
  runId: '11111111-1111-4111-8111-111111111111',
  sourceId: 'itch-public-assets',
  observedAt: '2026-11-13T00:00:00.000Z',
  maximumItems: 10,
  userAgent: 'orion-research-test',
};

test('parses ranked public itch asset listings without inventing sales metrics', () => {
  const html = `
    <div class="game_cell" data-game_id="1">
      <a class="game_link" href="https://alpha.itch.io/neon-weapons"><span class="game_title">Neon Weapons</span></a>
      <a class="game_author">Alpha Studio</a><span class="price_value">$4.99</span>
      <div class="game_text">Eight pixel-art weapons.</div>
    </div>
    <div class="game_cell" data-game_id="2">
      <a class="game_link" href="https://beta.itch.io/space-effects"><span class="game_title">Space &amp; Effects</span></a>
      <a class="game_author">Beta</a><span class="price_tag">Free</span>
    </div>`;
  const rows = parseItchBrowseHtml(html, {
    runId: '11111111-1111-4111-8111-111111111111',
    sourceId: 'itch-public-assets',
    view: { id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy' },
    observedAt: '2026-10-16T12:00:00.000Z',
    maximumItems: 10,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].title, 'Neon Weapons');
  assert.equal(rows[0].price_text, '$4.99');
  assert.equal(rows[1].title, 'Space & Effects');
  assert.equal('sales' in rows[0], false);
  assert.match(rows[0].evidence_hash, /^[a-f0-9]{64}$/u);
});

// 2026-11-04 and 2026-11-12: a single 429 from itch.io nuked the entire
// nightly research run (and still charged Supabase egress on the
// failure-row write). The retry below honors Retry-After when present,
// bounded; 429-only on purpose so we don't hammer itch.io on real errors.
test('fetchItchBrowseView retries on 429 and succeeds on the next attempt', async () => {
  const sleeps = [];
  const sleepImpl = async (ms) => { sleeps.push(ms); };
  const responses = [
    makeResponse({ status: 429, retryAfter: '1' }),
    makeResponse({ status: 200, body: PASSING_HTML }),
  ];
  const fetchImpl = async () => responses.shift();
  const result = await fetchItchBrowseView({ ...VIEW_FIXTURE, fetchImpl, sleepImpl });
  assert.equal(result.observations.length, 1);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 1000, 'retry-after seconds should be honored (1s)');
});

test('fetchItchBrowseView gives up after the retry budget and keeps the same error shape', async () => {
  const sleepImpl = async () => {};
  const responses = [
    makeResponse({ status: 429, retryAfter: '2' }),
    makeResponse({ status: 429, retryAfter: '3' }),
    makeResponse({ status: 429 }),
  ];
  const fetchImpl = async () => responses.shift();
  await assert.rejects(
    fetchItchBrowseView({ ...VIEW_FIXTURE, fetchImpl, sleepImpl }),
    /itch\.io research request was rate limited; Retry-After=unspecified/,
  );
});

test('fetchItchBrowseView does not retry on non-429 errors', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return makeResponse({ status: 503, body: 'bad gateway' });
  };
  await assert.rejects(
    fetchItchBrowseView({ ...VIEW_FIXTURE, fetchImpl, sleepImpl: async () => {} }),
    /itch\.io research request failed \(503\)/,
  );
  assert.equal(calls, 1);
});
