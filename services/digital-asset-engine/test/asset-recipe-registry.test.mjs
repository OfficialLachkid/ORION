import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_RECIPE_REGISTRY,
  resolveAssetRecipe,
  validateAssetRecipeRegistry,
} from '../src/asset-recipe-registry.mjs';
import { loadEngineConfig } from '../src/config.mjs';
import { validateOpportunity } from '../src/opportunity-validator.mjs';
import { createProductSpecification } from '../src/product-planner.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

test('asset kinds resolve to bounded recipes without invoking product fixtures', () => {
  assert.equal(resolveAssetRecipe('pistol').recipe_id, 'weapon');
  assert.equal(resolveAssetRecipe('book').recipe_id, 'tome');
  assert.equal(resolveAssetRecipe('relic').recipe_id, 'rune_stone');
  assert.equal(resolveAssetRecipe('alchemy-tool').recipe_id, 'flask');
  assert.equal(resolveAssetRecipe('ritual-object').recipe_id, 'candle');
  assert.equal(resolveAssetRecipe('focus').recipe_id, 'wand');
  assert.equal(resolveAssetRecipe('plasma shield').recipe_id, 'plasma_shield');
  assert.equal(resolveAssetRecipe('home decor plant').recipe_id, 'generic_static');
  assert.equal(resolveAssetRecipe('home decor plant').matched_by, 'fallback');
});

test('registry recipes use known primitives and preserve zero root motion', () => {
  assert.equal(validateAssetRecipeRegistry(), true);
  for (const definition of Object.values(ASSET_RECIPE_REGISTRY)) {
    for (const animation of definition.animations) {
      assert.deepEqual(animation.root_motion, { x: 0, y: 0 });
    }
  }
});

test('research-selected kinds persist their production recipe in the product specification', async () => {
  const [opportunity, config] = await Promise.all([
    readFile(resolve(projectRoot, 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'), 'utf8').then(JSON.parse),
    loadEngineConfig('services/digital-asset-engine/config.example.json', projectRoot),
  ]);
  const input = {
    ...opportunity,
    generation: {
      ...opportunity.generation,
      assets: [
        { ...opportunity.generation.assets[0], kind: 'potion' },
        { ...opportunity.generation.assets[0], asset_key: 'unknown-prop', name: 'Unknown Prop', kind: 'decor prop' },
      ],
    },
  };
  const validation = validateOpportunity(input, config, { now: '2026-10-12T12:00:00.000Z' });
  const product = createProductSpecification(validation, config);
  assert.equal(product.assets[0].production_recipe.recipe_id, 'potion');
  assert.equal(product.assets[0].production_recipe.executor.status, 'available');
  assert.equal(product.assets[0].production_recipe.executor.id, 'interactive_items_v1');
  assert.equal(product.assets[1].production_recipe.recipe_id, 'generic_static');
  assert.equal(product.assets[1].production_recipe.executor.orchestration, 'automatic');
});
