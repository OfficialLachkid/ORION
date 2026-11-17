import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTAGRAM_STORY_DEFAULT_VARIANTS,
  INSTAGRAM_STORY_VARIANT_FRAMED_CARD,
  buildInstagramStoryRecipe,
  resolveInstagramStoryVariant,
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

test('Story recipes expose all five reusable variants by default', () => {
  assert.deepEqual(resolveInstagramStoryVariantKeys(target), INSTAGRAM_STORY_DEFAULT_VARIANTS);
  assert.deepEqual(INSTAGRAM_STORY_DEFAULT_VARIANTS, [
    'current',
    'branded_fullscreen',
    'framed_card',
    'minimal',
    'hybrid',
  ]);
});

test('Story variant rotation looks shuffled while remaining deterministic for retries', () => {
  const variants = new Set();
  const sequence = [];
  for (let index = 0; index < 100; index += 1) {
    const scheduledFor = new Date(Date.UTC(2026, 10, 17 + index, 8)).toISOString();
    const args = {
      publication: { account_key: target.account_key },
      sourcePublication: {
        id: `source-${index}`,
        video_id: `video-${index}`,
        scheduled_for: scheduledFor,
      },
      target,
    };
    const first = resolveInstagramStoryVariant(args);
    const second = resolveInstagramStoryVariant(args);
    assert.equal(first, second);
    variants.add(first);
    sequence.push(first);
  }
  assert.deepEqual(new Set(INSTAGRAM_STORY_DEFAULT_VARIANTS), variants);
  assert.ok(sequence.some((variant, index) => index > 0 && variant === sequence[index - 1]));
  assert.ok(sequence.some((variant, index) => index > 0 && variant !== sequence[index - 1]));
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
