import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POKE_QUIZZ_ASSET_LAYOUT,
  buildPokeQuizzShinySpritePath,
  buildPokeQuizzSilhouettePath,
  buildPokeQuizzSpritePath,
  buildPokeQuizzThreeDTypeIconPath,
  buildPokeQuizzTypeIconPath,
  formatDexNumber,
  sanitizePokemonSlug,
} from '../src/poke-quizz-asset-layout.mjs';

test('asset layout helpers build deterministic Pokemon asset paths', () => {
  const row = {
    generation: 2,
    national_dex_number: 169,
    slug: 'mr-mime',
  };

  assert.equal(formatDexNumber(7), '0007');
  assert.equal(sanitizePokemonSlug("Farfetch'd"), 'farfetch-d');
  assert.match(buildPokeQuizzSpritePath(row), /Sprites\/Generation 2\/0169-mr-mime\.png$/u);
  assert.match(buildPokeQuizzShinySpritePath(row), /Shiny Sprites\/Generation 2\/0169-mr-mime\.png$/u);
  assert.match(buildPokeQuizzSilhouettePath(row), /Silhouettes\/Generation 2\/0169-mr-mime\.png$/u);
  assert.match(buildPokeQuizzTypeIconPath('Psychic'), /Pixel Types\/psychic\.gif$/u);
  assert.match(buildPokeQuizzThreeDTypeIconPath('Psychic'), /3D Types\/psychic\.png$/u);
  assert.match(POKE_QUIZZ_ASSET_LAYOUT.previews, /Pokemon\/Poke Quizz\/Previews$/u);
});
