import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItchBrowseHtml } from '../src/itch-browse-adapter.mjs';

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
