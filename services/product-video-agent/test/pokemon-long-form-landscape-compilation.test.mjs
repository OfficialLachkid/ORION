import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  adaptPokemonShortTemplateToLandscape,
  LANDSCAPE_POKEMON_TEMPLATE_SPECS,
  listLandscapePokemonTemplateKeys,
} from '../src/domains/pokemon/long-form/landscape-template-adapter.mjs';
import { buildLongFormBackgroundPreparationFilter } from '../src/domains/pokemon/long-form/background-motion.mjs';
import {
  assignMixedChallengeDifficulty,
  buildMixedChallengePlan,
  orderLandscapeTemplateSpecs,
  selectLandscapeBackground,
  selectMixedChallengeIntroMusic,
  selectMixedChallengeIntroPokeballs,
} from '../src/domains/pokemon/long-form/mixed-challenge/planner.mjs';
import {
  buildMixedChallengeConcatFilter,
  buildMixedChallengeProgramFilter,
} from '../src/domains/pokemon/long-form/mixed-challenge/renderer.mjs';
import { calculateTransparentBottomRatio } from '../src/domains/pokemon/templates/shared/render/sprite-alpha-grounding.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');

async function loadJson(relativePath) {
  return JSON.parse(await readFile(resolve(PROJECT_ROOT, relativePath), 'utf8'));
}

test('landscape compilation supports every Pokemon Short template except Tournament', async () => {
  assert.deepEqual(listLandscapePokemonTemplateKeys(), [
    'dual-type-reveal',
    'find-the-shiny',
    'know-your-shiny',
    'progressive-reveal',
    'stat-clash',
    'build-your-team',
    'memory',
    'type-quiz',
    'cry-match',
  ]);
  assert.equal(LANDSCAPE_POKEMON_TEMPLATE_SPECS.some((entry) => entry.key === 'tournament'), false);
  const first = orderLandscapeTemplateSpecs(LANDSCAPE_POKEMON_TEMPLATE_SPECS, 'same-seed');
  const second = orderLandscapeTemplateSpecs(LANDSCAPE_POKEMON_TEMPLATE_SPECS, 'same-seed');
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((entry) => entry.key)).size, 9);
  const longTemplate = await loadJson(
    'services/product-video-agent/config/templates/pokemon/long/mixed-challenge.v1.json',
  );
  const episodeSpecs = orderLandscapeTemplateSpecs(
    LANDSCAPE_POKEMON_TEMPLATE_SPECS,
    'same-seed',
    false,
    longTemplate.episode.excluded_template_keys,
  );
  assert.equal(episodeSpecs.length, 8);
  assert.equal(episodeSpecs.some((entry) => entry.key === 'build-your-team'), false);
  assert.equal(longTemplate.layout.background.blur_sigma, 8);
  assert.equal(longTemplate.layout.progress_tracker.enabled, true);
  assert.equal(longTemplate.layout.progress_tracker.marker_size_px, 42);
  const backgrounds = [{ path: 'one' }, { path: 'two' }, { path: 'three' }];
  const selected = [0, 1, 2].map((index) => (
    selectLandscapeBackground(backgrounds, 'same-seed', index).path
  ));
  assert.equal(new Set(selected).size, 3);
});

test('landscape adapters clone source templates and preserve native renderer contracts', async () => {
  for (const spec of LANDSCAPE_POKEMON_TEMPLATE_SPECS) {
    const source = await loadJson(spec.path);
    const snapshot = structuredClone(source);
    const adapted = adaptPokemonShortTemplateToLandscape(source);
    assert.deepEqual(source, snapshot, `${spec.key} source template must remain untouched`);
    assert.equal(adapted.template_key, source.template_key);
    assert.equal(adapted.canvas.width, 1920);
    assert.equal(adapted.canvas.height, 1080);
    assert.equal(adapted.canvas.aspect_ratio, '16:9');
    assert.equal(adapted.layout.background.blur_sigma, 0);
    assert.equal(adapted.layout.background.motion.enabled, false);
    assert.equal(adapted.long_form_adapter.preserves_short_template, true);
  }
  const buildTeam = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/build-your-team.v1.json',
  ));
  assert.equal(buildTeam.layout.sprite_grid.rows, 1);
  assert.equal(buildTeam.layout.sprite_grid.columns, 4);
  assert.equal(buildTeam.layout.sprite_grid.sprite_center_y_offset_px, 84);
  assert.equal(buildTeam.layout.timer.center_y, 500);
  assert.equal(buildTeam.layout.timer.bar_horizontal_inset_px, 250);
  assert.equal(buildTeam.layout.text.show_counter, false);
  assert.equal(buildTeam.layout.sprite_platform.alpha_grounding_enabled, true);

  const statClash = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/stat-clash.v1.json',
  ));
  assert.equal(statClash.layout.sprite_grid.sprite_center_y_offset_px, 84);
  assert.equal(statClash.layout.sprite_grid.column_gap_px, 150);

  const cryMatch = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/cry-match.v1.json',
  ));
  assert.equal(cryMatch.layout.sprite_grid.sprite_center_y_offset_px, 84);
  assert.equal(cryMatch.layout.sprite_grid.column_gap_px, 150);

  const findTheShiny = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
  ));
  assert.equal(findTheShiny.layout.timer.hp_bar_y_offset_px, -150);

  const typeQuiz = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json',
  ));
  assert.equal(typeQuiz.layout.timer.enabled, false);

  const knowYourShiny = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
  ));
  assert.equal(knowYourShiny.question_contract.prompt_text, 'Which one is the Real Shiny?');
  assert.equal(knowYourShiny.layout.timer.center_y, 272);
  assert.equal(knowYourShiny.layout.timer.bar_horizontal_inset_px, 190);
  assert.equal(knowYourShiny.layout.sprite_grid.column_gap_px, 150);
  assert.equal(knowYourShiny.layout.sprite_platform.visible_bottom_alignment_enabled, true);

  const memory = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/memory.v1.json',
  ));
  assert.equal(memory.layout.rounds.reveal_hold_seconds, 2.1);
  assert.equal(memory.layout.sprite_grid.column_gap_px, 90);
  assert.equal(memory.layout.sprite_grid.sprite_scale_multiplier, 1.32);
  assert.equal(memory.layout.option_grid.column_gap_px, 160);
  assert.equal(memory.layout.option_grid.sprite_scale_multiplier, 1.4);
  assert.equal(memory.layout.option_grid.stage_bounds_px.width, 1760);
  assert.equal(memory.layout.timer.hp_bar_title_gap_px, 50);
});

test('long-form intro Pokeballs remain deterministic without a Build Your Team section', () => {
  const paths = [
    '/overlays/pokeball-01.png',
    '/overlays/pokeball-02.png',
    '/overlays/pokeball-03.png',
    '/overlays/pokeball-04.png',
    '/overlays/pokeball-05.png',
  ];
  const first = selectMixedChallengeIntroPokeballs(paths, 'intro-seed', 4);
  const second = selectMixedChallengeIntroPokeballs(paths, 'intro-seed', 4);
  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(new Set(first.map((entry) => entry.path)).size, 4);
  assert.equal(first.every((entry) => entry.speed_multiplier >= 0.92), true);
  assert.equal(first.every((entry) => entry.speed_multiplier <= 1.08), true);
  assert.equal(first.every((entry) => [-1, 1].includes(entry.direction_multiplier)), true);
});

test('long-form background motion is smooth and does not use sharp triangle-wave reversals', () => {
  const filter = buildLongFormBackgroundPreparationFilter({
    inputRef: 0,
    width: 1920,
    height: 1080,
    fps: 30,
    blurSigma: 6,
    template: {
      layout: {
        background: {
          motion: { enabled: true, zoom_scale: 1.3 },
        },
      },
    },
    chapterIndex: 2,
    startSeconds: 0,
    endSeconds: 40,
  });
  assert.match(filter, /sin\(2\*PI/u);
  assert.match(filter, /crop=w=2496:h=1404:x='\(iw-ow\)\/2'/u);
  assert.match(filter, /flags=lanczos/u);
  assert.match(filter, /gblur=sigma=6/u);
  assert.doesNotMatch(filter, /acos\(cos/u);
  assert.doesNotMatch(filter, /eq=/u);
});

test('mixed compilation plan and concat filter keep watch-page semantics', async () => {
  const template = await loadJson(
    'services/product-video-agent/config/templates/pokemon/long/mixed-challenge.v1.json',
  );
  const sections = [
    {
      template_key: 'cry-match',
      duration_seconds: 30.5,
      selected_subjects: [{ id: '25', name: 'Pikachu' }],
      background_source_path: '/backgrounds/one.png',
      previews_directory: '/previews',
    },
    {
      template_key: 'memory',
      duration_seconds: 24.25,
      selected_subjects: [
        { id: '25', name: 'Pikachu' },
        { id: '6', name: 'Charizard' },
      ],
      background_source_path: '/backgrounds/two.png',
      previews_directory: '/previews',
    },
  ];
  const plan = buildMixedChallengePlan({
    template,
    seed: 'mixed-seed',
    channelProfile: { id: 'channel', name: 'Poke Quizz', account_key: 'poke-quizz-youtube' },
    sections,
    selectionState: { sections: {} },
    programAssets: {
      intro_music_path: '/music/intro.mp3',
      intro_pokeballs: [{ path: '/overlays/pokeball.png' }],
    },
  });
  assert.equal(plan.content_format, 'long_form');
  assert.equal(plan.content_surface, 'youtube_watch');
  assert.equal(plan.timing.sections_duration_seconds, 54.75);
  assert.equal(plan.timing.total_duration_seconds, 74.75);
  assert.equal(plan.selection.selected_subjects.length, 2);
  assert.equal(plan.sections[0].difficulty.label, 'EASY ROUND');
  assert.equal(plan.sections[1].difficulty.label, 'MEDIUM ROUND');
  assert.equal(plan.publication_policy.related_video_enabled, false);
  assert.equal(plan.publication_policy.watermark_enabled, false);
  assert.equal(plan.assets.program.intro_music_path, '/music/intro.mp3');
  assert.equal(plan.assets.program.intro_pokeballs.length, 1);
  assert.equal(
    selectMixedChallengeIntroMusic(['/music/one.mp3', '/music/two.mp3'], '/music/one.mp3', 'seed'),
    '/music/two.mp3',
  );

  const concatFilter = buildMixedChallengeConcatFilter(2);
  assert.match(concatFilter, /\[0:v\]setpts=PTS-STARTPTS\[v0\]/u);
  assert.match(concatFilter, /\[1:a\]aresample=48000/u);
  assert.match(concatFilter, /concat=n=2:v=1:a=1\[vout\]\[aout\]/u);

  const programFilter = buildMixedChallengeProgramFilter(2, {
    template,
    sections: assignMixedChallengeDifficulty(sections, template),
    fontPath: '/tmp/font.ttf',
  });
  assert.match(programFilter, /THE ULTIMATE POKEMON CHALLENGE/u);
  assert.match(programFilter, /introtitle/u);
  assert.match(programFilter, /enable='gte\(t,0\.22\)'/u);
  assert.match(programFilter, /CURRENT DIFFICULTY/u);
  assert.equal(programFilter.includes('EASY ROUND  |  1 / 2'), true);
  assert.equal((programFilter.match(/color=0x0A1726@0\.82:t=fill/gu) || []).length, 4);
  assert.match(
    programFilter,
    /color=0x45D483@0\.96:t=fill:enable='gte\(t,0\.55\)'/u,
  );
  assert.match(programFilter, /HOW DID YOU DO/u);

  const animatedProgramFilter = buildMixedChallengeProgramFilter(2, {
    template,
    sections: assignMixedChallengeDifficulty(sections, template),
    fontPath: '/tmp/font.ttf',
    programAssets: {
      intro_music_input_ref: 3,
      intro_pokeballs: [{ input_ref: 2, speed_multiplier: 1.05, direction_multiplier: -1 }],
    },
  });
  assert.match(animatedProgramFilter, /\[2:v\].*rotate=/u);
  assert.match(animatedProgramFilter, /\[3:a\].*volume=0\.24/u);
  assert.match(animatedProgramFilter, /1\+0\.45\*\(1-abs/u);
});

test('transparent bottom padding is measured independently of animation frame stacking', () => {
  const width = 2;
  const pageHeight = 4;
  const frameCount = 2;
  const channels = 4;
  const data = Buffer.alloc(width * pageHeight * frameCount * channels);
  const setAlpha = (frame, x, y, alpha) => {
    const stackedY = (frame * pageHeight) + y;
    data[((stackedY * width + x) * channels) + 3] = alpha;
  };
  setAlpha(0, 0, 1, 255);
  setAlpha(1, 1, 2, 255);
  assert.equal(calculateTransparentBottomRatio(data, {
    width,
    height: pageHeight * frameCount,
    channels,
    pageHeight,
  }), 0.25);
});
