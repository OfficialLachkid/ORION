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

test('landscape compilation includes every Pokemon Short template except Tournament', () => {
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
  assert.equal(buildTeam.layout.timer.center_y, 300);
  assert.equal(buildTeam.layout.text.show_counter, false);
  assert.equal(buildTeam.layout.sprite_platform.alpha_grounding_enabled, true);

  const typeQuiz = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json',
  ));
  assert.equal(typeQuiz.layout.timer.enabled, false);

  const knowYourShiny = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
  ));
  assert.equal(knowYourShiny.question_contract.prompt_text, 'Which one is the Real Shiny?');
  assert.equal(knowYourShiny.layout.timer.center_y, 272);

  const memory = adaptPokemonShortTemplateToLandscape(await loadJson(
    'services/product-video-agent/config/templates/pokemon/memory.v1.json',
  ));
  assert.equal(memory.layout.rounds.reveal_hold_seconds, 2.1);
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
  assert.match(programFilter, /CURRENT DIFFICULTY/u);
  assert.equal(programFilter.includes('EASY ROUND  |  1 / 2'), true);
  assert.match(programFilter, /HOW DID YOU DO/u);
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
