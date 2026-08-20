import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POKE_QUIZZ_ASSET_LAYOUT,
  buildPokeQuizzPreviewArchiveDirectory,
  buildPokeQuizzPreviewDirectory,
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
  assert.match(buildPokeQuizzPreviewDirectory({ template_key: 'type-quiz' }), /Previews\/Type Quiz$/u);
  assert.match(buildPokeQuizzPreviewDirectory({ template_key: 'find-the-shiny' }), /Previews\/Find the Shiny$/u);
  assert.match(buildPokeQuizzPreviewDirectory({ template_key: 'memory' }), /Previews\/Memory$/u);
  assert.match(buildPokeQuizzPreviewDirectory({ template_key: 'know-your-shiny' }), /Previews\/Know Your Shiny$/u);
  assert.match(buildPokeQuizzPreviewDirectory({ template_id: 'pokemon.dual-type-reveal-v1' }), /Previews\/Dual Type Reveal$/u);
  assert.match(buildPokeQuizzPreviewDirectory({ template_id: 'pokemon.type-speed-quiz.v1' }), /Previews\/Type Quiz$/u);
  assert.match(buildPokeQuizzPreviewArchiveDirectory({ template_key: 'type-quiz' }), /Previews\/Type Quiz\/Older Generated Videos$/u);
});
