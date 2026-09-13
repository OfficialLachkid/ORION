import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_VIDEO_TEMPLATE_OPTIONS } from '../../task-router/src/product-video-command-parser.mjs';
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
import {
  buildAudioFilterScript,
  buildPokeQuizzRenderPlan,
} from '../src/domains/pokemon/templates/progressive-reveal/renderer.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/progressive-reveal/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/progressive-reveal/render/visual-inputs.mjs';
import {
  buildProgressiveRevealMaskExpression,
  buildProgressiveRevealProgressExpression,
  PROGRESSIVE_REVEAL_METHODS,
} from '../src/domains/pokemon/templates/shared/render/progressive-reveal-engine.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = resolve(HERE, '..', '..', '..');
const TEMPLATE_PATH = resolve(HERE, '..', 'config', 'templates', 'pokemon', 'progressive-reveal.v1.json');

async function loadTemplate() {
  return JSON.parse(await readFile(TEMPLATE_PATH, 'utf8'));
}

function buildFixtureSubject(index) {
  return {
    id: `pokedex-${String(index).padStart(4, '0')}`,
    national_dex_number: index,
    slug: `fixture-${index}`,
    name: `Fixture ${index}`,
    generation: 1 + (index % 3),
    region: 'fixture',
    types: ['normal'],
    sprite_path: `/fake/sprites/${String(index).padStart(4, '0')}-fixture.png`,
    animated_sprite_path: '',
    sprite_source_url: `https://example.invalid/${index}.png`,
  };
}

function buildAssetInventory() {
  return {
    scanned_at: '2026-09-13T00:00:00.000Z',
    directories: {},
    backgrounds: ['/fake/backgrounds/forest.png', '/fake/backgrounds/city.gif'],
    music: ['/fake/audio/battle.mp3'],
    sound_effects: {
      all: ['/fake/audio/reveal.wav'],
      reveal: '/fake/audio/reveal.wav',
      timer_end: '/fake/audio/reveal.wav',
    },
    overlays: [],
    overlay_presets: {},
    transitions: [],
  };
}

test('progressive reveal is exposed through routing, runtime config, and scoped preview storage', async () => {
  const template = await loadTemplate();
  const option = PRODUCT_VIDEO_TEMPLATE_OPTIONS.find((entry) => entry.value === 'progressive-reveal');
  assert.ok(option);
  assert.equal(option.templateId, 'pokemon.progressive-reveal.v1');
  assert.equal(resolvePokeQuizzTemplateKey(template), 'progressive-reveal');
  assert.equal(resolvePokeQuizzPlanner(template), planPokemonProgressiveRevealChallenge);
  assert.equal(resolvePokeQuizzRenderPlanBuilder(template), buildPokeQuizzRenderPlan);
  assert.match(buildPokeQuizzPreviewDirectory(template), /\/Previews\/Progressive Reveal$/u);
  assert.match(resolvePokeQuizzSelectionStatePath(template), /selection-state-progressive-reveal\.json$/u);

  const runtime = await resolveVideoTemplateRuntime({
    projectRoot: PROJECT_ROOT,
    channelConfigPath: 'services/product-video-agent/config/channels/poke-quizz-youtube.json',
    templateId: template.template_id,
  });
  assert.equal(runtime.templateId, 'pokemon.progressive-reveal.v1');
  assert.equal(runtime.channelTemplate.templateKey, 'progressive-reveal');
  assert.equal(runtime.genreLabel, 'Progressive Reveal');
  assert.equal(runtime.templatePath, 'services/product-video-agent/config/templates/pokemon/progressive-reveal.v1.json');
});

test('planner deterministically selects three Pokemon and seeded non-repeating reveal methods', async () => {
  const template = await loadTemplate();
  const options = {
    template,
    pokedexRows: Array.from({ length: 12 }, (_, index) => buildFixtureSubject(index + 1)),
    seed: 'progressive-reveal-deterministic',
    assetInventory: buildAssetInventory(),
    selectionState: { last_background_path: '/fake/backgrounds/forest.png' },
  };
  const first = await planPokemonProgressiveRevealChallenge(options);
  const second = await planPokemonProgressiveRevealChallenge(options);

  assert.deepEqual(first, second);
  assert.equal(first.template_id, 'pokemon.progressive-reveal.v1');
  assert.equal(first.rounds.length, 3);
  assert.equal(first.narration.lines.length, 1);
  assert.equal(first.assets.background.selected_path, '/fake/backgrounds/city.gif');
  assert.match(first.assets.outputs.previews_directory, /\/Previews\/Progressive Reveal$/u);
  assert.equal(first.required_asset_gaps.length, 0);
  assert.deepEqual(
    first.selection.reveal_methods,
    first.rounds.map((round) => round.reveal_method),
  );
  for (const [index, round] of first.rounds.entries()) {
    assert.ok(PROGRESSIVE_REVEAL_METHODS.includes(round.reveal_method));
    assert.equal(round.round_label, `${index + 1}/3`);
    assert.equal(round.answer_text, round.subject.name);
    assert.ok(round.reveal_seed.includes(`round-${index + 1}`));
    if (index > 0) {
      assert.notEqual(round.reveal_method, first.rounds[index - 1].reveal_method);
    }
  }
});

test('fixed reveal mode uses one configured algorithm for the entire video', async () => {
  const template = await loadTemplate();
  template.reveal.mode = 'fixed_video';
  template.reveal.method = 'horizontal_strips';
  const plan = await planPokemonProgressiveRevealChallenge({
    template,
    pokedexRows: Array.from({ length: 6 }, (_, index) => buildFixtureSubject(index + 1)),
    seed: 'progressive-reveal-fixed',
    assetInventory: buildAssetInventory(),
  });
  assert.deepEqual(plan.selection.reveal_methods, ['strips', 'strips', 'strips']);
});

test('all V1 reveal algorithms build deterministic progressive alpha masks', () => {
  const progress = buildProgressiveRevealProgressExpression({
    startSeconds: 1.5,
    durationSeconds: 4.2,
    fps: 30,
    difficulty: 'hard',
  });
  assert.match(progress, /pow\(clip\(\(\(N\/30\)-1\.5\)\/4\.2,0,1\),1\.42\)/u);

  const expressions = PROGRESSIVE_REVEAL_METHODS.map((method) => buildProgressiveRevealMaskExpression({
    method,
    seed: 'same-video-seed',
    progressExpression: progress,
    config: {
      direction: 'left_to_right',
      orientation: 'vertical',
      fragment_size_px: 64,
      strip_count: 16,
      noise_scale: 0.03,
      particle_size_px: 8,
    },
  }));
  assert.equal(new Set(expressions).size, PROGRESSIVE_REVEAL_METHODS.length);
  for (const expression of expressions) {
    assert.match(expression, /if\(lte\(.+,0\),0,if\(gte\(.+,0\.999\),255,/u);
    assert.doesNotMatch(expression, /random|Math\./u);
  }
  assert.match(expressions[1], /floor\(X\/64\)/u);
  assert.match(expressions[2], /floor\(X\/max\(1,W\/16\)\)/u);
  assert.match(expressions[3], /sin\(\(X\+/u);
  assert.match(expressions[4], /floor\(X\/8\)\*197/u);
});

test('render plan and filters keep sprites centered, reach full reveal, and slide through rounds', async () => {
  const template = await loadTemplate();
  const plan = await planPokemonProgressiveRevealChallenge({
    template,
    pokedexRows: Array.from({ length: 8 }, (_, index) => buildFixtureSubject(index + 1)),
    seed: 'progressive-reveal-render',
    assetInventory: buildAssetInventory(),
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/progressive-reveal.mp4',
  });
  const visualInputs = buildVisualInputs(plan, renderPlan);
  const visualFilter = buildVisualFilterScript(plan, template, renderPlan, {
    background: 0,
    rounds: renderPlan.rounds.map((_, index) => ({ sprite: index + 1 })),
  });
  const audioFilter = buildAudioFilterScript({
    narrationPaths: ['/tmp/hook.wav'],
    musicPath: '/tmp/music.mp3',
    revealSoundPath: '/tmp/reveal.wav',
    renderPlan,
  });

  assert.equal(renderPlan.canvas.width, 1080);
  assert.equal(renderPlan.canvas.height, 1920);
  assert.equal(renderPlan.reveal_box.center_x, 540);
  assert.equal(renderPlan.rounds[0].reveal_complete_seconds, 5.9);
  assert.equal(renderPlan.rounds[1].scene_start_seconds > 0, true);
  assert.equal(visualInputs.length, 4);
  assert.equal(visualInputs[0].role, 'background');
  assert.equal(visualInputs[1].role, 'round-1-sprite');
  assert.match(visualFilter.script, /flags=neighbor/u);
  assert.match(visualFilter.script, /geq=r='r\(X,Y\)'/u);
  assert.match(visualFilter.script, /alpha\(X,Y\)/u);
  assert.match(visualFilter.script, /overlay=x=540-w\/2:y=850-h\/2/u);
  assert.match(visualFilter.script, /trim=start=[0-9.]+:end=[0-9.]+/u);
  assert.match(visualFilter.script, /xfade=transition=slideleft/u);
  assert.match(visualFilter.script, /BEFORE IT\\'S REVEALED/u);
  assert.match(audioFilter, /reveal0/u);
  assert.match(audioFilter, /reveal2/u);
});

test('fallback publication metadata describes the reveal mechanic without spoiling answers', async () => {
  const template = await loadTemplate();
  const plan = await planPokemonProgressiveRevealChallenge({
    template,
    pokedexRows: Array.from({ length: 6 }, (_, index) => buildFixtureSubject(index + 1)),
    seed: 'progressive-reveal-metadata',
    assetInventory: buildAssetInventory(),
  });
  const metadata = buildPokeQuizzFallbackPublicationMetadata(plan, { name: 'Poke Quizz' });
  assert.ok(metadata.title.length > 0);
  assert.match(metadata.description, /slowly revealed|full image/iu);
  assert.ok(metadata.hashtags.includes('#pokemonreveal'));
  assert.equal(plan.selection.selected_subjects.some((subject) => metadata.title.includes(subject.name)), false);
});
