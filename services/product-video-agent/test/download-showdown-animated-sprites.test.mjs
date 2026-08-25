import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFileName,
  buildShowdownSlugCandidates,
} from '../scripts/assets/download-showdown-animated-sprites.mjs';

test('buildShowdownSlugCandidates preserves standard form slugs', () => {
  const candidates = buildShowdownSlugCandidates({
    slug: 'rattata-alola',
    metadata: { pokemon_api: { pokemon_name: 'rattata-alola' } },
  });

  assert.ok(candidates.includes('rattata-alola'));
});

test('buildShowdownSlugCandidates adds megax and megay variants', () => {
  const megaXCandidates = buildShowdownSlugCandidates({
    slug: 'charizard-mega-x',
    metadata: { pokemon_api: { pokemon_name: 'charizard-mega-x' } },
  });
  const megaYCandidates = buildShowdownSlugCandidates({
    slug: 'mewtwo-mega-y',
    metadata: { pokemon_api: { pokemon_name: 'mewtwo-mega-y' } },
  });
  const prefixedMegaCandidates = buildShowdownSlugCandidates({
    slug: 'venusaur-mega',
    metadata: { pokemon_api: { pokemon_name: 'mega-venusaur' } },
  });

  assert.ok(megaXCandidates.includes('charizard-megax'));
  assert.ok(megaYCandidates.includes('mewtwo-megay'));
  assert.ok(prefixedMegaCandidates.includes('venusaur-mega'));
});

test('buildShowdownSlugCandidates keeps gendered shorthand names intact', () => {
  const candidates = buildShowdownSlugCandidates({
    slug: 'nidoran-f',
    metadata: { pokemon_api: { pokemon_name: 'nidoran-f' } },
  });

  assert.ok(candidates.includes('nidoran-f'));
  assert.ok(candidates.includes('nidoranf'));
});

test('buildShowdownSlugCandidates reorders regional prefixes to showdown-style suffixes', () => {
  const candidates = buildShowdownSlugCandidates({
    slug: 'rapidash-galar',
    metadata: { pokemon_api: { pokemon_name: 'galarian-rapidash' } },
  });

  assert.ok(candidates.includes('rapidash-galar'));
});

test('buildFileName mirrors the existing dex-slug naming convention', () => {
  assert.equal(
    buildFileName({
      national_dex_number: 6,
      slug: 'charizard-mega-x',
    }),
    '0006-charizard-mega-x.gif',
  );
});
