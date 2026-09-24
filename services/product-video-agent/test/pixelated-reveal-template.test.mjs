import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseProductVideoCommand,
  PRODUCT_VIDEO_TEMPLATE_OPTIONS,
} from '../../task-router/src/product-video-command-parser.mjs';
import { buildPokeQuizzFallbackPublicationMetadata } from '../src/local-publication-metadata.mjs';
import { buildPokeQuizzPreviewDirectory } from '../src/poke-quizz-asset-layout.mjs';
import {
  resolvePokeQuizzPlanner,
  resolvePokeQuizzRenderPlanBuilder,
  resolvePokeQuizzTemplateKey,
} from '../src/poke-quizz-template-registry.mjs';
import { resolvePokeQuizzSelectionStatePath } from '../src/poke-quizz-selection-state.mjs';
import { resolveVideoTemplateRuntime } from '../src/video-template-context.mjs';
import { planPokemonProgressiveRevealChallenge } from '../src/domains/pokemon/templates/progressive-reveal/planner.mjs';
import { buildPokeQuizzRenderPlan } from '../src/domains/pokemon/templates/progressive-reveal/renderer.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/progressive-reveal/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/progressive-reveal/render/visual-inputs.mjs';

const HERE = resolve(import.meta.dirname);
const PROJECT_ROOT = resolve(HERE, '..', '..', '..');
const TEMPLATE_PATH = resolve(HERE, '..', 'config', 'templates', 'pokemon', 'pixelated-reveal.v1.json');
const PROGRESSIVE_TEMPLATE_PATH = resolve(
  HERE,
  '..',
  'config',
  'templates',
  'pokemon',
  'progressive-reveal.v1.json',
);

async function loadJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function buildFixtureSubject(index, animatedGifPath) {
  return {
    id: `pokedex-${String(index).padStart(4, '0')}`,
    national_dex_number: index,
    slug: `fixture-${index}`,
    name: `Fixture ${index}`,
    generation: 1,
    region: 'fixture',
    types: ['normal'],
    sprite_path: `/fake/sprites/${String(index).padStart(4, '0')}-fixture.png`,
    animated_sprite_path: animatedGifPath,
    cry_path: TEMPLATE_PATH,
  };
}

function buildAssetInventory() {
  return {
    backgrounds: ['/fake/backgrounds/forest.png'],
    pixel_backgrounds: ['/fake/pixel-backgrounds/forest.png'],
    music: ['/fake/audio/battle.mp3'],
    sound_effects: {
      ding: '/fake/audio/ding-sound.mp3',
      reveal: '/fake/audio/reveal.wav',
    },
    overlays: [],
    transitions: [],
  };
}

test('pixelated reveal is a standalone manually selectable template', async () => {
  const [template, progressiveTemplate] = await Promise.all([
    loadJson(TEMPLATE_PATH),
    loadJson(PROGRESSIVE_TEMPLATE_PATH),
  ]);
  const option = PRODUCT_VIDEO_TEMPLATE_OPTIONS.find((entry) => entry.value === 'pixelated-reveal');
  assert.deepEqual(option, {
    name: 'Pixelated Reveal',
    value: 'pixelated-reveal',
    templateId: 'pokemon.pixelated-reveal.v1',
  });
  assert.equal(template.template_id, 'pokemon.pixelated-reveal.v1');
  assert.equal(template.template_key, 'pixelated-reveal');
  assert.equal(template.selection_rules.round_count, 4);
  assert.equal(template.layout.reveal_box.center_y, 925);
  assert.equal(template.layout.reveal_box.sprite_visible_margin_px, 24);
  assert.equal(template.layout.reveal_box.sprite_crop_padding_px, 4);
  assert.equal(template.layout.text.difficulty_label_y, 435);
  assert.equal(template.layout.text.show_round_counter, false);
  assert.equal(template.layout.rounds.show_first_reveal_immediately, true);
  assert.equal(template.reveal.mode, 'fixed_video');
  assert.deepEqual(template.reveal.methods, ['pixelated']);
  assert.equal(progressiveTemplate.reveal.methods.includes('pixelated'), false);
  assert.equal(progressiveTemplate.reveal.method_config.pixelated, undefined);
  assert.equal(resolvePokeQuizzTemplateKey(template), 'pixelated-reveal');
  assert.equal(resolvePokeQuizzPlanner(template), planPokemonProgressiveRevealChallenge);
  assert.equal(resolvePokeQuizzRenderPlanBuilder(template), buildPokeQuizzRenderPlan);
  assert.match(buildPokeQuizzPreviewDirectory(template), /\/Previews\/Pixelated Reveal$/u);
  assert.match(resolvePokeQuizzSelectionStatePath(template), /selection-state-pixelated-reveal\.json$/u);
  assert.equal(
    parseProductVideoCommand(
      'generate video template: pixelated-reveal channel: poke-quizz-youtube',
    )?.templateId,
    'pokemon.pixelated-reveal.v1',
  );

  const runtime = await resolveVideoTemplateRuntime({
    projectRoot: PROJECT_ROOT,
    channelConfigPath: 'services/product-video-agent/config/channels/poke-quizz-youtube.json',
    templateId: template.template_id,
  });
  assert.equal(runtime.templateId, 'pokemon.pixelated-reveal.v1');
  assert.equal(runtime.channelTemplate.templateKey, 'pixelated-reveal');
  assert.equal(runtime.channelTemplate.manualGenerate, true);
  assert.equal(runtime.channelTemplate.nightShift, true);
  assert.equal(runtime.channelTemplate.weight, 2);
  assert.equal(runtime.genreLabel, 'Pixelated Reveal');
  assert.equal(
    runtime.templatePath,
    'services/product-video-agent/config/templates/pokemon/pixelated-reveal.v1.json',
  );
});

test('pixelated reveal progresses from easy to impossible across four GIF rounds', async (context) => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), 'orion-pixelated-reveal-'));
  context.after(() => rm(runtimeDirectory, { recursive: true, force: true }));
  const animatedGifPath = join(runtimeDirectory, 'animated.gif');
  const { default: sharp } = await import('sharp');
  const visibleSprite = await sharp({
    create: {
      width: 20,
      height: 40,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  }).png().toBuffer();
  await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: visibleSprite, left: 40, top: 30 }])
    .gif()
    .toFile(animatedGifPath);
  const template = await loadJson(TEMPLATE_PATH);
  const plan = await planPokemonProgressiveRevealChallenge({
    template,
    pokedexRows: Array.from({ length: 8 }, (_, index) => (
      buildFixtureSubject(index + 1, animatedGifPath)
    )),
    seed: 'pixelated-reveal-difficulty-progression',
    assetInventory: buildAssetInventory(),
  });
  plan.rounds[0].answer_text = 'ALOLAN EXEGGUTOR FORM';
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/pixelated-reveal.mp4',
  });
  const visualInputs = buildVisualInputs(plan, renderPlan);
  const visualFilter = buildVisualFilterScript(plan, template, renderPlan, {
    background: 0,
    rounds: renderPlan.rounds.map((_, index) => ({ sprite: index + 1 })),
  });

  assert.equal(plan.template_id, 'pokemon.pixelated-reveal.v1');
  assert.equal(plan.rounds.length, 4);
  assert.equal(plan.rounds[0].scene_lead_seconds, 0);
  assert.equal(renderPlan.rounds[0].local.reveal_start_seconds, 0);
  assert.equal(renderPlan.reveal_box.center_y, 925);
  assert.equal(renderPlan.reveal_box.sprite_visible_margin_px, 24);
  assert.equal(renderPlan.text_layout.difficulty_label_y, 435);
  assert.deepEqual(plan.selection.reveal_methods, Array(4).fill('pixelated'));
  assert.deepEqual(
    plan.rounds.map((round) => round.difficulty_id),
    ['easy', 'medium', 'hard', 'impossible'],
  );
  assert.deepEqual(
    plan.rounds.map((round) => round.difficulty_label),
    ['EASY', 'MEDIUM', 'HARD', 'IMPOSSIBLE'],
  );
  assert.deepEqual(
    plan.rounds.map((round) => round.reveal_completion_progress),
    [0.3, 0.25, 0.15, 0.1],
  );
  assert.deepEqual(
    plan.rounds.map((round) => round.reveal_duration_seconds),
    [7.65, 6.375, 3.825, 2.55],
  );
  assert.equal(plan.rounds.every((round) => round.reveal_config.resolution_steps_px.length === 37), true);
  assert.equal(plan.rounds.every((round) => round.reveal_config.resolution_steps_px[0] === 4), true);
  assert.equal(plan.rounds.every((round) => round.subject.render_sprite_path === animatedGifPath), true);
  assert.equal(plan.rounds.every((round) => (
    JSON.stringify(round.subject.sprite_crop) === JSON.stringify({
      x: 36,
      y: 26,
      width: 28,
      height: 48,
      source_width: 100,
      source_height: 100,
    })
  )), true);
  assert.equal(visualInputs.slice(1).every((input) => input.args.includes('-ignore_loop')), true);
  for (const difficulty of ['EASY', 'MEDIUM', 'HARD', 'IMPOSSIBLE']) {
    assert.match(visualFilter.script, new RegExp(`drawtext=text='${difficulty}'`, 'u'));
  }
  assert.match(visualFilter.script, /y=435/u);
  assert.doesNotMatch(visualFilter.script, /drawtext=text='1\/4'/u);
  assert.doesNotMatch(visualFilter.script, /scene0pixelPreCover/u);
  assert.match(visualFilter.script, /crop=28:48:36:26/u);
  assert.match(visualFilter.script, /scale=700:700:force_original_aspect_ratio=decrease/u);
  assert.match(visualFilter.script, /drawtext=text='ALOLAN'/u);
  assert.match(visualFilter.script, /drawtext=text='EXEGGUTOR FORM'/u);
  assert.doesNotMatch(visualFilter.script, /ALOLAN(?:\\+n|n)EXEGGUTOR FORM/u);
  assert.match(visualFilter.script, /\/25\.5,0,0\.3\)/u);
  assert.match(visualFilter.script, /\/25\.5,0,0\.25\)/u);
  assert.match(visualFilter.script, /\/25\.5,0,0\.15\)/u);
  assert.match(visualFilter.script, /\/25\.5,0,0\.1\)/u);

  const metadata = buildPokeQuizzFallbackPublicationMetadata(plan, { name: 'Poke Quizz' });
  assert.match(metadata.description, /Easy to Impossible/u);
  assert.ok(metadata.hashtags.includes('#pixelchallenge'));
});
