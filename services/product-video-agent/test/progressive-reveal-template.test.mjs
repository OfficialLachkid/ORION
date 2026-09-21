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
  buildProgressiveRevealCryCues,
  buildPokeQuizzRenderPlan,
} from '../src/domains/pokemon/templates/progressive-reveal/renderer.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/progressive-reveal/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/progressive-reveal/render/visual-inputs.mjs';
import {
  appendProgressiveCoverFilters,
  buildCascadeFallingParticlePhases,
  buildFluidFallingParticlePhases,
  buildProgressiveRevealMaskExpression,
  buildProgressiveRevealProgressExpression,
  calculateOpaqueRevealCompletionProgress,
  PROGRESSIVE_REVEAL_METHODS,
} from '../src/domains/pokemon/templates/shared/render/progressive-reveal-engine.mjs';
import { applyChannelWatermarkToVisualFilter } from '../src/domains/pokemon/templates/shared/render/channel-watermark.mjs';

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
    cry_path: TEMPLATE_PATH,
  };
}

function buildAssetInventory() {
  return {
    scanned_at: '2026-09-13T00:00:00.000Z',
    directories: {},
    backgrounds: ['/fake/backgrounds/forest.png', '/fake/backgrounds/city.gif'],
    pixel_backgrounds: ['/fake/pixel-backgrounds/forest.png', '/fake/pixel-backgrounds/city.gif'],
    music: ['/fake/audio/battle.mp3'],
    sound_effects: {
      all: ['/fake/audio/reveal.wav', '/fake/audio/ding-sound.mp3'],
      ding: '/fake/audio/ding-sound.mp3',
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
  assert.match(template.layout.text.font_candidates[0], /Arial Black\.ttf$/u);
  assert.equal(template.layout.reveal_box.background_color, 'white');
  assert.equal(template.reveal.method_config.strips.strip_width_px, 6);
  assert.equal(template.reveal.method_config.strips.line_reveal_min_seconds, 0.3);
  assert.equal(template.reveal.method_config.strips.line_reveal_max_seconds, 1);
  assert.equal(template.question_contract.hook_text, 'Who is that Pokemon?');
  assert.deepEqual(template.question_contract.headline_lines, ['WHO IS THAT', 'POKEMON?']);
  assert.equal(template.reveal.target_opaque_fraction, 0.6);
  assert.deepEqual(
    template.reveal.methods,
    PROGRESSIVE_REVEAL_METHODS.filter((method) => method !== 'pixelated'),
  );
  assert.deepEqual(
    template.reveal.methods.slice(-8),
    [
      'spiral',
      'diamond',
      'cross',
      'edge_particles',
      'diagonal_particles',
      'square_spiral',
      'square_spiral_inward',
      'fluid_fill',
    ],
  );
  assert.equal(template.layout.branding, undefined);
  assert.equal(template.layout.progress_bar, undefined);
  assert.equal(template.layout.text.method_y, undefined);
  assert.equal(template.layout.text.method_font_size, undefined);
  assert.equal(template.reveal.method_config.cascade.fall_duration_seconds, 1.2);
  assert.equal(template.reveal.method_config.cascade.fall_step_count, 10);
  assert.equal(template.audio.cry_playback.delay_after_ding_seconds, 0.3);
  assert.equal(template.reveal.method_config.square_spiral.turns, 3);
  assert.equal(template.reveal.method_config.square_spiral_inward.turns, 3);
  assert.equal(template.reveal.method_config.fluid_fill.particle_size_px, 8);
  assert.equal(template.reveal.method_config.fluid_fill.fall_step_count, 12);
  assert.equal(template.reveal.method_config.pixelated, undefined);
});

test('planner deterministically selects three Pokemon and seeded non-repeating reveal methods', async () => {
  const template = await loadTemplate();
  const options = {
    template,
    pokedexRows: Array.from({ length: 12 }, (_, index) => buildFixtureSubject(index + 1)),
    seed: 'progressive-reveal-deterministic',
    assetInventory: buildAssetInventory(),
    selectionState: { last_background_path: '/fake/pixel-backgrounds/forest.png' },
    channelProfile: {
      id: 'video-channel-dexguess-youtube',
      name: 'DexGuess',
      account_key: 'dexguess-youtube',
      niche: 'pokemon_quiz',
      metadata: { youtube_handle: '@DexGuess' },
    },
  };
  const first = await planPokemonProgressiveRevealChallenge(options);
  const second = await planPokemonProgressiveRevealChallenge(options);

  assert.deepEqual(first, second);
  assert.equal(first.template_id, 'pokemon.progressive-reveal.v1');
  assert.equal(first.rounds.length, 3);
  assert.equal(first.narration.lines.length, 1);
  assert.equal(first.channel.name, 'DexGuess');
  assert.equal(first.channel.handle, '@DexGuess');
  assert.equal(first.assets.background.selected_path, '/fake/pixel-backgrounds/city.gif');
  assert.match(first.assets.background.expected_directory, /pixel-backgrounds$/u);
  assert.match(first.assets.outputs.previews_directory, /\/Previews\/Progressive Reveal$/u);
  assert.equal(first.assets.audio.selected_sound_effects.reveal, '/fake/audio/ding-sound.mp3');
  assert.equal(first.required_asset_gaps.length, 0);
  assert.deepEqual(
    first.selection.reveal_methods,
    first.rounds.map((round) => round.reveal_method),
  );
  assert.deepEqual(first.selection_state.last_reveal_methods, first.selection.reveal_methods);
  assert.equal(new Set(first.selection.reveal_methods).size, first.selection.reveal_methods.length);
  for (const [index, round] of first.rounds.entries()) {
    assert.ok(PROGRESSIVE_REVEAL_METHODS.includes(round.reveal_method));
    assert.equal(round.round_label, `${index + 1}/3`);
    assert.equal(round.reveal_duration_seconds, 5.1);
    assert.equal(round.full_reveal_duration_seconds, 8.5);
    assert.equal(round.reveal_completion_progress, 0.6);
    assert.equal(round.reveal_target_opaque_fraction, 0.6);
    assert.equal(round.reveal_estimated_opaque_fraction, 0.6);
    assert.equal(round.reveal_config.progress_scale, 1);
    assert.equal(round.answer_text, round.subject.name);
    assert.equal(round.subject.cry_path, TEMPLATE_PATH);
    assert.ok(round.reveal_seed.includes(`round-${index + 1}`));
    if (index > 0) {
      assert.notEqual(round.reveal_method, first.rounds[index - 1].reveal_method);
    }
  }
});

test('random reveal selection excludes the previous video methods for one channel', async () => {
  const template = await loadTemplate();
  const baseOptions = {
    template,
    pokedexRows: Array.from({ length: 12 }, (_, index) => buildFixtureSubject(index + 1)),
    seed: 'progressive-reveal-channel-history',
    assetInventory: buildAssetInventory(),
  };
  const first = await planPokemonProgressiveRevealChallenge(baseOptions);
  const nextForSameChannel = await planPokemonProgressiveRevealChallenge({
    ...baseOptions,
    selectionState: first.selection_state,
  });
  const firstForAnotherChannel = await planPokemonProgressiveRevealChallenge(baseOptions);

  assert.deepEqual(firstForAnotherChannel.selection.reveal_methods, first.selection.reveal_methods);
  assert.deepEqual(
    nextForSameChannel.selection.reveal_methods.filter((method) => (
      first.selection.reveal_methods.includes(method)
    )),
    [],
  );
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
  const cappedProgress = buildProgressiveRevealProgressExpression({
    startSeconds: 1.5,
    durationSeconds: 5.1,
    fps: 30,
    difficulty: 'normal',
    completionProgress: 0.6,
  });
  assert.match(cappedProgress, /\(clip\(\(\(N\/30\)-1\.5\)\/5\.1,0,1\)\)\*0\.6/u);

  const expressions = PROGRESSIVE_REVEAL_METHODS.map((method) => buildProgressiveRevealMaskExpression({
    method,
    seed: 'same-video-seed',
    progressExpression: progress,
    config: {
      direction: 'left_to_right',
      orientation: 'vertical',
      fragment_size_px: 64,
      strip_width_px: 6,
      line_reveal_min_seconds: 0.3,
      line_reveal_max_seconds: 1,
      reveal_duration_seconds: 8.5,
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
  assert.match(expressions[2], /floor\(X\/6\)/u);
  assert.match(expressions[2], /Y\/max\(1,H-1\)/u);
  assert.match(expressions[2], /0\.3/u);
  assert.match(expressions[2], /\/8\.5/u);
  assert.match(expressions[3], /sin\(\(X\+/u);
  assert.match(expressions[4], /floor\(X\/8\)\*197/u);
  assert.match(expressions[5], /min\(.*pow\(\(X-W\*0\.[0-9]+\)\/max\(1,W\),2\)/u);
  assert.match(expressions[6], /eq\(mod\(floor\(X\/56\)\+floor\(Y\/56\),2\),0\)/u);
  assert.match(expressions[7], /X\/max\(1,W-1\).*Y\/max\(1,H-1\).*sin/u);
  assert.match(expressions[8], /floor\(Y\/8\).*max\(1,H-1\)/u);
  assert.match(expressions[9], /abs\(.*floor\(X\/14\).*floor\(Y\/14\)/u);
  assert.match(expressions[10], /atan2\(Y-H\/2,X-W\/2\)/u);
  assert.match(expressions[11], /1-\(\(abs\(X\/max\(1,W-1\)-0\.[0-9]+\)/u);
  assert.match(expressions[12], /min\(abs\(X\/max\(1,W-1\)-0\.5\)\*2,abs\(Y\/max\(1,H-1\)-0\.5\)\*2\)/u);
  assert.match(expressions[13], /min\(min\(floor\(X\/8\)\*8\/max\(1,W-1\)/u);
  assert.match(expressions[13], /floor\(X\/8\)\*271\+floor\(Y\/8\)\*487/u);
  assert.match(expressions[14], /floor\(X\/8\)\*307\+floor\(Y\/8\)\*503/u);
  assert.match(expressions[15], /max\(abs\(X\/max\(1,W-1\)-0\.5\),abs\(Y\/max\(1,H-1\)-0\.5\)\)\*2/u);
  assert.match(expressions[15], /if\(lte\(Y\/max\(1,H-1\)-0\.5,-abs\(X\/max\(1,W-1\)-0\.5\)\)/u);
  assert.match(expressions[16], /lte\(\(1-\(clip\(/u);
  assert.match(expressions[17], /\(H-1-floor\(Y\/8\)\*8\)\/max\(1,H-1\)/u);
  assert.match(expressions[17], /sin\(\(floor\(X\/8\)\*8\)\*0\.045/u);
  assert.match(expressions[17], /floor\(X\/8\)\*331\+floor\(Y\/8\)\*521/u);
  assert.match(expressions[18], /gte\(.+,0\)/u);
});

test('falling-particle phases descend in discrete sand steps before settling', () => {
  const phases = buildCascadeFallingParticlePhases({
    seed: 'falling-sand',
    progressExpression: 'p',
    completionProgress: 0.6,
    config: {
      particle_size_px: 12,
      fall_jitter: 0.28,
      fall_duration_seconds: 1.2,
      fall_step_count: 10,
      fall_distance_px: 748,
      reveal_duration_seconds: 8.5,
      progress_scale: 1.1,
    },
  });

  assert.equal(phases.length, 10);
  assert.ok(phases[0].offsetPixels < phases.at(-1).offsetPixels);
  assert.equal(phases.at(-1).offsetPixels, 711);
  assert.match(phases[0].maskExpression, /gt\(.+,\(\(p\)\*1\.1\)\+/u);
  assert.match(phases[0].maskExpression, /lte\(.+,min\(0\.66,/u);
  assert.doesNotMatch(phases[0].maskExpression, /and\(/u);
  assert.ok(new Set(phases.map((phase) => phase.maskExpression)).size === phases.length);
});

test('fluid-fill particles visibly fall from the top before joining the rising pool', () => {
  const phases = buildFluidFallingParticlePhases({
    seed: 'fluid-pour',
    progressExpression: 'p',
    completionProgress: 0.6,
    config: {
      particle_size_px: 8,
      particle_jitter: 0.16,
      surface_wave_amplitude: 0.055,
      surface_wave_frequency: 0.045,
      fall_duration_seconds: 1.4,
      fall_step_count: 12,
      fall_distance_px: 748,
      reveal_duration_seconds: 8.5,
      progress_scale: 1.1,
    },
  });

  assert.equal(phases.length, 12);
  assert.equal(phases.at(-1).offsetPixels, 717);
  assert.match(phases[0].maskExpression, /H-1-floor\(Y\/8\)\*8/u);
  assert.match(phases[0].maskExpression, /floor\(X\/8\)\*331\+floor\(Y\/8\)\*521/u);
  assert.match(phases[0].maskExpression, /gt\(.+,\(\(p\)\*1\.1\)\+/u);
  assert.ok(new Set(phases.map((phase) => phase.maskExpression)).size === phases.length);
});

test('opaque coverage calibration ignores transparent box pixels', () => {
  const opaquePoints = [];
  for (let y = 260; y < 500; y += 6) {
    for (let x = 270; x < 490; x += 6) {
      opaquePoints.push({ x, y });
    }
  }
  const coverage = calculateOpaqueRevealCompletionProgress({
    method: 'radial',
    seed: 'radial-coverage',
    config: { origin_count: 4, maximum_radius_ratio: 0.42 },
    opaquePoints,
    width: 748,
    height: 748,
    targetOpaqueFraction: 0.6,
  });
  assert.equal(coverage.completionProgress, 0.6);
  assert.ok(coverage.sampledOpaquePixelCount > 1000);
  assert.ok(coverage.estimatedOpaqueFraction >= 0.6);
  assert.ok(coverage.estimatedOpaqueFraction < 0.61);
  assert.notEqual(coverage.progressScale, 1);
});

test('render plan and filters keep sprites centered, reach full reveal, and slide through rounds', async () => {
  const template = await loadTemplate();
  template.reveal.mode = 'fixed_video';
  template.reveal.method = 'cascade';
  const plan = await planPokemonProgressiveRevealChallenge({
    template,
    pokedexRows: Array.from({ length: 8 }, (_, index) => buildFixtureSubject(index + 1)),
    seed: 'progressive-reveal-render',
    assetInventory: buildAssetInventory(),
    channelProfile: {
      id: 'video-channel-poke-guess-youtube',
      name: 'Poke Guess',
      account_key: 'poke-guess-youtube',
      metadata: { youtube_handle: '@PokeGuesss' },
    },
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
  const watermarkedVisualFilter = applyChannelWatermarkToVisualFilter(visualFilter, {
    plan,
    renderPlan,
  });
  const cryCues = buildProgressiveRevealCryCues({ plan, renderPlan, template });
  const audioFilter = buildAudioFilterScript({
    narrationPaths: ['/tmp/hook.wav'],
    musicPath: '/tmp/music.mp3',
    revealSoundPath: '/tmp/reveal.wav',
    cryCues,
    renderPlan,
  });

  assert.equal(renderPlan.canvas.width, 1080);
  assert.equal(renderPlan.canvas.height, 1920);
  assert.equal(renderPlan.reveal_box.center_x, 540);
  assert.equal(renderPlan.branding, undefined);
  assert.equal(renderPlan.progress_bar, undefined);
  assert.equal(renderPlan.rounds[0].progress_bar, undefined);
  assert.equal(renderPlan.rounds[0].reveal_complete_seconds, 6.8);
  assert.equal(renderPlan.rounds[1].scene_start_seconds > 0, true);
  assert.equal(visualInputs.length, 4);
  assert.equal(visualInputs[0].role, 'background');
  assert.equal(visualInputs[1].role, 'round-1-sprite');
  assert.match(visualFilter.script, /flags=neighbor/u);
  assert.match(visualFilter.script, /crop=w=2160:h=3840:x='\(iw-2160\)\*\(0\.5\+0\.5\*sin\(t\*/u);
  assert.match(visualFilter.script, /scale=1080:1920:flags=lanczos,gblur=sigma=6/u);
  assert.match(visualFilter.script, /geq=r='r\(X,Y\)'/u);
  assert.match(visualFilter.script, /alpha\(X,Y\)/u);
  assert.match(visualFilter.script, /drawbox=x=160:y=470:w=760:h=760:color=white:t=fill/u);
  assert.match(visualFilter.script, /color=c=black:s=748x748/u);
  assert.match(visualFilter.script, /alpha\(X,Y\)\*\(255-\(if\(/u);
  assert.doesNotMatch(visualFilter.script, /drawtext=text='\?'/u);
  assert.match(visualFilter.script, /overlay=x=166:y=476/u);
  assert.match(visualFilter.script, /trim=start=[0-9.]+:end=[0-9.]+/u);
  assert.match(visualFilter.script, /xfade=transition=slideleft/u);
  assert.match(visualFilter.script, /WHO IS THAT/u);
  assert.match(visualFilter.script, /POKEMON\?/u);
  assert.doesNotMatch(visualFilter.script, /FALLING PARTICLES|scene0method/u);
  assert.match(visualFilter.script, /\*0\.6/u);
  assert.match(visualFilter.script, /split=11\[round0spriteBase\]\[round0fallSource0\]/u);
  assert.match(visualFilter.script, /pad=w=iw:h=ih\+[0-9]+:x=0:y=0:color=0x00000000,crop=w=748:h=748:x=0:y=[0-9]+/u);
  assert.doesNotMatch(visualFilter.script, /progressTrack|progressFill|progressScaled/u);
  assert.match(watermarkedVisualFilter.script, /drawtext=text='@PokeGuesss'.*alpha='if\(lt\(t,1\.7\),0,if\(lt\(t,2\.15\),\(\(t-1\.7\)\/0\.45\)\*0\.5,0\.5\)\)'.*enable='gte\(t,1\.7\)'.*fontcolor=0xFFE45C.*bordercolor=0x2446B8.*y=1610/u);
  assert.equal((watermarkedVisualFilter.script.match(/drawtext=text='@PokeGuesss'/gu) || []).length, 2);
  assert.match(audioFilter, /reveal0/u);
  assert.match(audioFilter, /reveal2/u);
  assert.equal(cryCues.length, 3);
  assert.equal(cryCues[0].start_seconds, renderPlan.rounds[0].answer_start_seconds + 0.3);
  assert.match(audioFilter, /cry0/u);
  assert.match(audioFilter, /cry2/u);

  const fluidPlan = structuredClone(plan);
  fluidPlan.rounds = fluidPlan.rounds.map((round) => ({
    ...round,
    reveal_method: 'fluid_fill',
    reveal_config: { ...template.reveal.method_config.fluid_fill, progress_scale: 1 },
  }));
  const fluidRenderPlan = buildPokeQuizzRenderPlan({
    plan: fluidPlan,
    template,
    outputPath: '/tmp/progressive-reveal-fluid.mp4',
  });
  const fluidVisualFilter = buildVisualFilterScript(fluidPlan, template, fluidRenderPlan, {
    background: 0,
    rounds: fluidRenderPlan.rounds.map((_, index) => ({ sprite: index + 1 })),
  });
  assert.match(fluidVisualFilter.script, /split=13\[round0spriteBase\]\[round0fallSource0\]/u);
  assert.match(fluidVisualFilter.script, /round0fallSource11/u);
  assert.match(fluidVisualFilter.script, /crop=w=748:h=748:x=0:y=[0-9]+/u);

  const coverFilters = [];
  appendProgressiveCoverFilters(coverFilters, {
    inputLabel: 'cover',
    outputLabel: 'covered',
    method: 'strips',
    seed: 'cover-seed',
    startSeconds: 0.5,
    durationSeconds: 8.5,
    fps: 30,
    config: template.reveal.method_config.strips,
  });
  assert.match(coverFilters[0], /a='alpha\(X,Y\)\*\(255-\(if\(/u);
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
