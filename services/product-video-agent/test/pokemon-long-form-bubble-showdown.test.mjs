import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  adaptBubbleSurvivalTemplateToLandscape,
  buildBubbleShowdownLongFormPlan,
  resolveBubbleShowdownDurationConfig,
  selectBubbleShowdownCategoryOrder,
  shouldAppendBubbleShowdownRound,
} from '../src/domains/pokemon/long-form/bubble-showdown/planner.mjs';
import {
  buildAnimatedBubbleSurvivalTitleMarkup,
  renderArenaSvg,
  resolveShowdownTitleAnimationState,
} from '../src/domains/pokemon/templates/bubble-survival/renderer.mjs';
import { BUBBLE_SURVIVAL_CATEGORIES } from '../src/domains/pokemon/templates/bubble-survival/category-resolver.mjs';
import { buildPokeQuizzPreviewDirectory } from '../src/poke-quizz-asset-layout.mjs';
import {
  PRODUCT_VIDEO_LONG_TEMPLATE_DEFINITIONS,
  findProductVideoTemplateDefinition,
} from '../src/product-video-template-routing.mjs';

async function loadJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('long-form Bubble Showdown config targets a bounded 4-6 minute landscape episode', async () => {
  const template = await loadJson('services/product-video-agent/config/templates/pokemon/long/bubble-showdown.v1.json');
  const duration = resolveBubbleShowdownDurationConfig(template);
  assert.deepEqual(duration, {
    minimum_seconds: 240,
    target_seconds: 300,
    maximum_seconds: 360,
    minimum_rounds: 8,
    target_rounds: 10,
    maximum_rounds: 12,
    intro_seconds: 5,
    outro_seconds: 6,
  });
  assert.deepEqual(template.canvas, {
    width: 1920,
    height: 1080,
    fps: 30,
    aspect_ratio: '16:9',
  });
});

test('category order is deterministic and exhausts unique pools before reuse', () => {
  const poolVariants = BUBBLE_SURVIVAL_CATEGORIES.map((category, index) => ({
    category,
    weight: index % 3 === 0 ? 2 : 1,
  }));
  const first = selectBubbleShowdownCategoryOrder({
    poolVariants,
    seed: 'long-category-order',
    maximumRounds: 12,
  });
  const second = selectBubbleShowdownCategoryOrder({
    poolVariants,
    seed: 'long-category-order',
    maximumRounds: 12,
  });
  assert.deepEqual(first, second);
  assert.equal(first.length, 12);
  assert.equal(new Set(first.slice(0, BUBBLE_SURVIVAL_CATEGORIES.length)).size, BUBBLE_SURVIVAL_CATEGORIES.length);
  assert.notEqual(first[10], first[11]);
});

test('duration planner keeps minimum rounds and rejects rounds beyond the bounded target', () => {
  const template = {
    episode: {
      minimum_duration_seconds: 240,
      target_duration_seconds: 300,
      maximum_duration_seconds: 360,
      minimum_rounds: 8,
      target_rounds: 10,
      maximum_rounds: 12,
    },
  };
  assert.equal(shouldAppendBubbleShowdownRound({
    currentDurationSeconds: 250,
    nextRoundDurationSeconds: 30,
    currentRoundCount: 7,
    template,
  }), true);
  assert.equal(shouldAppendBubbleShowdownRound({
    currentDurationSeconds: 305,
    nextRoundDurationSeconds: 25,
    currentRoundCount: 10,
    template,
  }), false);
  assert.equal(shouldAppendBubbleShowdownRound({
    currentDurationSeconds: 350,
    nextRoundDurationSeconds: 20,
    currentRoundCount: 9,
    template,
  }), false);
});

test('landscape adapter preserves shared physics while changing only presentation geometry and music bed', async () => {
  const shortTemplate = await loadJson('services/product-video-agent/config/templates/pokemon/bubble-survival.v1.json');
  const longTemplate = await loadJson('services/product-video-agent/config/templates/pokemon/long/bubble-showdown.v1.json');
  const adapted = adaptBubbleSurvivalTemplateToLandscape({
    shortTemplate,
    longTemplate,
    category: 'mega',
  });
  assert.equal(adapted.selection_rules.category, 'mega');
  assert.deepEqual(adapted.video.resolution, [1920, 1080]);
  assert.equal(adapted.video.aspect_ratio, '16:9');
  assert.equal(adapted.render.frame_width, 960);
  assert.equal(adapted.render.frame_height, 540);
  assert.equal(adapted.arena.center_x, 480);
  assert.equal(adapted.bubbles.initial_tail_count, shortTemplate.bubbles.initial_tail_count);
  assert.equal(adapted.simulation.fixed_step_seconds, shortTemplate.simulation.fixed_step_seconds);
  assert.equal(adapted.audio.music_volume, 0);
  assert.equal(adapted.presentation.showdown_title_animation.enabled, true);
});

test('Showdown title animates letter by letter at fixed final positions', () => {
  const animation = {
    start_seconds: 0.08,
    letter_interval_seconds: 0.085,
    letter_pop_seconds: 0.12,
  };
  const before = resolveShowdownTitleAnimationState(0, animation, 8);
  const during = resolveShowdownTitleAnimationState(0.3, animation, 8);
  const after = resolveShowdownTitleAnimationState(1, animation, 8);
  assert.equal(before.letters.every((letter) => !letter.visible), true);
  assert.ok(during.letters.filter((letter) => letter.visible).length > 1);
  assert.ok(during.letters.filter((letter) => letter.visible).length < 8);
  assert.equal(after.complete, true);
  const markup = buildAnimatedBubbleSurvivalTitleMarkup({
    centerX: 480,
    frameWidth: 960,
    videoTime: 0.3,
    animation,
    startY: 52,
  }).markup.join('');
  assert.match(markup, />S<\/text>/u);
  assert.doesNotMatch(markup, />SHOWDOWN<\/text>/u);
});

test('long-form round intro shows round and pool labels without changing short-form labels', () => {
  const plan = {
    video: { frame_width: 960, frame_height: 540, intro_seconds: 1.16, frame_fps: 30, winner_delay_seconds: 0.75 },
    simulation: {
      duration_seconds: 10,
      config: { center_x: 480, center_y: 300, arena_radius: 220, bubble_radius: 35 },
      frames: [{ bubbles: [{ id: 'pikachu', x: 480, y: 100, is_defeated: false }], tails: [] }],
    },
    selection: { selected_subjects: [{ id: 'pikachu', name: 'Pikachu' }] },
    winner: { id: 'pikachu' },
    presentation: { round_label: 'ROUND 2 / 10', category_label: 'Mega Pokemon' },
  };
  const template = {
    presentation: {
      showdown_title_animation: { enabled: true, start_seconds: 0, letter_interval_seconds: 0.05 },
      title: { y: 52, font_size: 30, side_margin: 60 },
    },
  };
  const introSvg = renderArenaSvg({ plan, template, videoTime: 0.5 }).toString('utf8');
  const battleSvg = renderArenaSvg({ plan, template, videoTime: 2 }).toString('utf8');
  assert.match(introSvg, /ROUND 2 \/ 10/u);
  assert.match(introSvg, /Mega Pokemon/u);
  assert.doesNotMatch(battleSvg, /ROUND 2 \/ 10|Mega Pokemon/u);
});

test('long-form plan keeps winner metadata spoiler-free and uses the shared review pipeline contract', async () => {
  const template = await loadJson('services/product-video-agent/config/templates/pokemon/long/bubble-showdown.v1.json');
  const rounds = Array.from({ length: 10 }, (_, index) => ({
    duration_seconds: 28,
    category: `pool-${index}`,
    selected_subjects: [{ id: `subject-${index}`, name: `Pokemon ${index}` }],
    winner: { id: `subject-${index}`, name: `Pokemon ${index}` },
  }));
  const plan = buildBubbleShowdownLongFormPlan({
    template,
    seed: 'long-plan',
    channelProfile: { id: 'channel-1', account_key: 'poke-quizz-youtube' },
    rounds,
    musicSchedule: [{ path: '/music.mp3', duration_seconds: 291 }],
  });
  assert.equal(plan.content_format, 'long_form');
  assert.equal(plan.content_surface, 'youtube_watch');
  assert.equal(plan.selection.round_count, 10);
  assert.equal(plan.timing.total_duration_seconds, 291);
  assert.doesNotMatch(plan.publication.description, /Pokemon 0|subject-0/u);
  assert.equal(plan.publication_policy.manual_review_required, true);
  assert.equal(plan.publication_policy.night_shift_enabled, false);
  assert.match(buildPokeQuizzPreviewDirectory(template), /Bubble Showdown Long Form$/u);
  assert.equal(
    PRODUCT_VIDEO_LONG_TEMPLATE_DEFINITIONS.some((entry) => entry.templateKey === 'long-bubble-showdown'),
    true,
  );
  assert.equal(
    findProductVideoTemplateDefinition('long-bubble-showdown', 'long_form')?.generationScript,
    'services/product-video-agent/scripts/generate-pokemon-bubble-showdown-long-form-review.mjs',
  );
});
