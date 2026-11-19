import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTAGRAM_STORY_DEFAULT_VARIANTS,
  INSTAGRAM_STORY_VARIANT_REGISTRY,
  INSTAGRAM_STORY_VARIANT_FRAMED_CARD,
  buildInstagramStoryRecipe,
  resolveInstagramStoryVariant,
  resolveInstagramStoryVariantAssignment,
  resolveInstagramStoryVariantKeys,
} from '../src/instagram-story-recipes.mjs';

const target = {
  account_key: 'poke-quizzz-instagram',
  instagram: {
    expected_username: 'pokequizzz',
    story: {
      display_name: 'Poke Quizz',
      theme: {
        primary: '#FFCB05',
        secondary: '#1756B8',
        accent: '#E3350D',
        surface: '#071B3A',
        text: '#FFFFFF',
      },
    },
  },
};

test('Story recipes expose every registered reusable variant by default', () => {
  assert.deepEqual(resolveInstagramStoryVariantKeys(target), INSTAGRAM_STORY_DEFAULT_VARIANTS);
  assert.deepEqual(INSTAGRAM_STORY_DEFAULT_VARIANTS, [
    'current',
    'branded_fullscreen',
    'framed_card',
    'minimal',
    'hybrid',
    'glass_spotlight',
    'editorial_gallery',
    'broadcast_elite',
  ]);
  assert.deepEqual(
    INSTAGRAM_STORY_DEFAULT_VARIANTS,
    INSTAGRAM_STORY_VARIANT_REGISTRY.map(({ key }) => key),
  );
});

function buildRotationSequence(length) {
  const sequence = [];
  let rotationState = {};
  for (let index = 0; index < length; index += 1) {
    const assignment = resolveInstagramStoryVariantAssignment({
      publication: { account_key: target.account_key },
      sourcePublication: { id: `source-${index}`, video_id: `video-${index}` },
      target,
      rotationState,
    });
    sequence.push(assignment);
    rotationState = {
      previousVariantKey: assignment.variantKey,
      poolSignature: assignment.poolSignature,
      cycle: assignment.cycle,
      position: assignment.position,
      order: assignment.order,
    };
  }
  return sequence;
}

test('Story shuffle bags use every registered variant before repeating', () => {
  const poolSize = INSTAGRAM_STORY_DEFAULT_VARIANTS.length;
  const sequenceLength = poolSize * 3;
  const first = buildRotationSequence(sequenceLength);
  const second = buildRotationSequence(sequenceLength);
  assert.deepEqual(first, second);
  for (let offset = 0; offset < first.length; offset += poolSize) {
    assert.deepEqual(
      new Set(first.slice(offset, offset + poolSize).map(({ variantKey }) => variantKey)),
      new Set(INSTAGRAM_STORY_DEFAULT_VARIANTS),
    );
  }
  for (let index = 1; index < first.length; index += 1) {
    assert.notEqual(first[index].variantKey, first[index - 1].variantKey);
  }
  assert.deepEqual(
    first.map(({ cycle }) => cycle),
    Array.from({ length: sequenceLength }, (_, index) => Math.floor(index / poolSize)),
  );
  assert.deepEqual(
    first.map(({ position }) => position),
    Array.from({ length: sequenceLength }, (_, index) => index % poolSize),
  );
});

test('Story variant selection honors the persisted immutable recipe choice', () => {
  const variant = resolveInstagramStoryVariant({
    publication: {
      account_key: target.account_key,
      metadata: { instagram_story: { variant_key: 'framed-card' } },
    },
    sourcePublication: { id: 'source-1' },
    target,
  });
  assert.equal(variant, INSTAGRAM_STORY_VARIANT_FRAMED_CARD);
});

test('every Story recipe embeds the channel avatar and contains no hardcoded initials', () => {
  const avatarDataUri = 'data:image/png;base64,YXZhdGFy';
  for (const variantKey of INSTAGRAM_STORY_DEFAULT_VARIANTS) {
    const recipe = buildInstagramStoryRecipe({
      variantKey,
      username: 'pokequizzz',
      title: 'Craft the Ultimate Pokemon Team',
      avatarDataUri,
      target,
    });
    const svg = recipe.overlaySvg.toString('utf8');
    assert.match(svg, /data:image\/png;base64,YXZhdGFy/u);
    assert.doesNotMatch(svg, />PQ</u);
    assert.doesNotMatch(svg, /premium/iu);
    assert.equal(recipe.variantKey, variantKey);
  }
});

test('unknown Story variants fail closed', () => {
  assert.throws(
    () => resolveInstagramStoryVariantKeys({
      instagram: { story: { variant_keys: ['minimal', 'unknown-layout'] } },
    }),
    /Unsupported Instagram Story variants/u,
  );
});
