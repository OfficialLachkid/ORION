import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  adaptPokemonShortTemplateToLandscape,
  LANDSCAPE_POKEMON_REVEAL_TEMPLATE_SPECS,
} from '../src/domains/pokemon/long-form/landscape-template-adapter.mjs';
import {
  assignRevealChallengeBackgrounds,
  buildRevealChallengePlan,
  filterUnusedRevealSubjects,
  selectNextRevealTemplateSpec,
  selectRevealChallengeMusicSchedule,
  shouldAppendRevealSection,
} from '../src/domains/pokemon/long-form/reveal-challenge/planner.mjs';
import {
  isRevealChallengeTemplate,
  listRevealChallengeTemplateSpecs,
  resolveRevealChallengeStrategies,
} from '../src/domains/pokemon/long-form/reveal-challenge/registry.mjs';
import { buildRevealChallengeProgramFilter } from '../src/domains/pokemon/long-form/reveal-challenge/renderer.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/progressive-reveal/render/visual-inputs.mjs';
import { buildAudioFilterScript } from '../src/domains/pokemon/templates/progressive-reveal/renderer.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');

async function loadJson(relativePath) {
  return JSON.parse(await readFile(resolve(PROJECT_ROOT, relativePath), 'utf8'));
}

test('reveal-only registry discovers methods from the production Short templates', async () => {
  const specs = listRevealChallengeTemplateSpecs();
  assert.deepEqual(specs, LANDSCAPE_POKEMON_REVEAL_TEMPLATE_SPECS);
  assert.deepEqual(specs.map((entry) => entry.key), [
    'progressive-reveal',
    'pixelated-reveal',
  ]);

  const progressive = await loadJson(specs[0].path);
  const pixelated = await loadJson(specs[1].path);
  assert.equal(isRevealChallengeTemplate(progressive), true);
  assert.equal(isRevealChallengeTemplate(pixelated), true);
  assert.equal(resolveRevealChallengeStrategies(pixelated)[0].reveal_method, 'pixelated');
  assert.equal(resolveRevealChallengeStrategies(progressive).length, progressive.reveal.methods.length);

  const withAnotherCompatibleMethod = structuredClone(progressive);
  withAnotherCompatibleMethod.reveal.methods.push('pixelated');
  assert.equal(
    resolveRevealChallengeStrategies(withAnotherCompatibleMethod).some(
      (strategy) => strategy.reveal_method === 'pixelated',
    ),
    true,
  );
});

test('reveal landscape adapters preserve source Shorts while producing native 16:9 templates', async () => {
  for (const spec of LANDSCAPE_POKEMON_REVEAL_TEMPLATE_SPECS) {
    const source = await loadJson(spec.path);
    const snapshot = structuredClone(source);
    const adapted = adaptPokemonShortTemplateToLandscape(source);
    assert.deepEqual(source, snapshot);
    assert.equal(adapted.canvas.width, 1920);
    assert.equal(adapted.canvas.height, 1080);
    assert.equal(adapted.canvas.aspect_ratio, '16:9');
    assert.equal(adapted.template_key, source.template_key);
    assert.equal(adapted.long_form_adapter.preserves_short_template, true);
  }
});

test('reveal episode selection is varied, deterministic, and avoids immediate template repeats', async () => {
  const template = await loadJson(
    'services/product-video-agent/config/templates/pokemon/long/reveal-challenge.v1.json',
  );
  const specs = listRevealChallengeTemplateSpecs();
  const run = () => {
    const keys = [];
    const usageCounts = {};
    let previousTemplateKey = '';
    for (let sectionIndex = 0; sectionIndex < 12; sectionIndex += 1) {
      const selected = selectNextRevealTemplateSpec({
        specs,
        template,
        seed: 'selection-seed',
        sectionIndex,
        previousTemplateKey,
        usageCounts,
      });
      keys.push(selected.key);
      usageCounts[selected.key] = Number(usageCounts[selected.key] || 0) + 1;
      previousTemplateKey = selected.key;
    }
    return keys;
  };
  const selected = run();
  assert.deepEqual(selected, run());
  assert.equal(new Set(selected).size, 2);
  assert.equal(selected.every((key, index) => index === 0 || key !== selected[index - 1]), true);
});

test('reveal episode planning enforces duration, subject de-duplication, and grouped backgrounds', async () => {
  const template = await loadJson(
    'services/product-video-agent/config/templates/pokemon/long/reveal-challenge.v1.json',
  );
  let duration = template.episode.intro_duration_seconds + template.episode.outro_duration_seconds;
  const sections = [];
  while (duration < template.episode.target_duration_seconds) {
    const nextDuration = 31;
    if (!shouldAppendRevealSection({
      currentDurationSeconds: duration,
      nextSectionDurationSeconds: nextDuration,
      template,
    })) break;
    sections.push({ template_key: 'progressive-reveal', duration_seconds: nextDuration });
    duration += nextDuration;
  }
  assert.equal(duration >= template.episode.minimum_duration_seconds, true);
  assert.equal(duration <= template.episode.maximum_duration_seconds, true);

  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(filterUnusedRevealSubjects(rows, new Set(['1']), 2), [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(filterUnusedRevealSubjects(rows, new Set(['1', '2']), 2), rows);

  const assigned = assignRevealChallengeBackgrounds({
    sections: sections.slice(0, 6),
    backgrounds: ['/bg/one.png', '/bg/two.png', '/bg/three.png'],
    template,
    seed: 'background-seed',
    previousBackgroundPath: '/bg/one.png',
  });
  assert.equal(assigned[0].background_source_path, assigned[1].background_source_path);
  assert.notEqual(assigned[1].background_source_path, assigned[2].background_source_path);
  assert.equal(assigned[2].background_source_path, assigned[3].background_source_path);
  assert.notEqual(assigned[3].background_source_path, assigned[4].background_source_path);
});

test('music schedule covers the episode with crossfades and no immediate repeat', () => {
  const schedule = selectRevealChallengeMusicSchedule({
    tracks: [
      { path: '/music/one.mp3', duration_seconds: 150 },
      { path: '/music/two.mp3', duration_seconds: 120 },
      { path: '/music/three.mp3', duration_seconds: 180 },
    ],
    totalDurationSeconds: 390,
    crossfadeSeconds: 2,
    endingFadeSeconds: 2.5,
    seed: 'music-seed',
  });
  assert.equal(schedule[0].start_seconds, 0);
  assert.equal(schedule.at(-1).end_seconds, 390);
  assert.equal(schedule.every((entry, index) => (
    index === 0 || entry.path !== schedule[index - 1].path
  )), true);
  assert.equal(schedule.every((entry, index) => (
    index === 0 || entry.start_seconds === schedule[index - 1].end_seconds - 2
  )), true);
});

test('reveal plan and assembly filter retain watch-page semantics and gameplay audio', async () => {
  const template = await loadJson(
    'services/product-video-agent/config/templates/pokemon/long/reveal-challenge.v1.json',
  );
  const sections = [
    {
      template_key: 'progressive-reveal',
      duration_seconds: 30,
      round_count: 3,
      reveal_methods: ['wipe', 'spiral', 'checkerboard'],
      selected_subjects: [{ id: 25, name: 'Pikachu' }],
      background_source_path: '/bg/one.png',
      previews_directory: '/previews',
    },
    {
      template_key: 'pixelated-reveal',
      duration_seconds: 36,
      round_count: 4,
      reveal_methods: ['pixelated', 'pixelated', 'pixelated', 'pixelated'],
      selected_subjects: [{ id: 6, name: 'Charizard' }],
      background_source_path: '/bg/two.png',
      previews_directory: '/previews',
    },
  ];
  const musicSchedule = [{
    path: '/music/one.mp3',
    start_seconds: 0,
    end_seconds: 77,
    duration_seconds: 77,
    fade_in_seconds: 0.6,
    fade_out_seconds: 2.5,
  }];
  const plan = buildRevealChallengePlan({
    template,
    seed: 'plan-seed',
    channelProfile: { id: 'channel', name: 'Poke Quizz', account_key: 'poke-quizz-youtube' },
    sections,
    musicSchedule,
  });
  assert.equal(plan.content_format, 'long_form');
  assert.equal(plan.content_surface, 'youtube_watch');
  assert.equal(plan.selection.round_count, 7);
  assert.equal(plan.selection.selected_subject_count, 2);
  assert.equal(plan.timing.total_duration_seconds, 77);
  assert.equal(plan.publication_policy.related_video_enabled, false);
  assert.equal(plan.publication_policy.auto_comment_enabled, false);
  assert.equal(plan.publication_policy.watermark_enabled, false);

  const filter = buildRevealChallengeProgramFilter(2, {
    sections,
    template,
    fontPath: '/tmp/font.ttf',
    musicSchedule,
    musicInputStartIndex: 2,
    transitionInputs: [
      { input_ref: 3, duration_seconds: 1.15, direction_multiplier: -1 },
      { input_ref: 4, duration_seconds: 1.15, direction_multiplier: 1 },
    ],
  });
  assert.match(filter, /GUESS THE POKEMON/u);
  assert.match(filter, /concat=n=4:v=1:a=1\[programbase\]\[gameaudio\]/u);
  assert.match(filter, /\[2:a\].*adelay=0\|0\[music0\]/u);
  assert.match(filter, /\[gameaudio\]\[musicbed\]amix=inputs=2/u);
  assert.match(filter, /\[3:v\].*rotate=/u);
});

test('reveal sections can seek through one continuous rendered background group', () => {
  const inputs = buildVisualInputs({
    assets: {
      background: {
        selected_path: '/tmp/group-01.mp4',
        start_seconds: 31.25,
      },
    },
    rounds: [{
      round_number: 1,
      subject: { sprite_path: '/tmp/pikachu.png' },
    }],
  }, {
    total_duration_seconds: 29.5,
    canvas: { fps: 30 },
    rounds: [{
      round_number: 1,
      scene_duration_seconds: 29.5,
      subject: { sprite_path: '/tmp/pikachu.png' },
    }],
  });
  assert.deepEqual(inputs[0].args, [
    '-stream_loop',
    '-1',
    '-ss',
    '31.25',
    '-t',
    '29.5',
    '-i',
    '/tmp/group-01.mp4',
  ]);
});

test('long-form reveal audio is padded to the planned section boundary', () => {
  const filter = buildAudioFilterScript({
    narrationPaths: [],
    musicPath: null,
    revealSoundPath: '/tmp/ding.mp3',
    cryCues: [],
    renderPlan: {
      total_duration_seconds: 28.6,
      rounds: [{ answer_start_seconds: 6 }],
    },
    padToDuration: true,
  });
  assert.match(filter, /apad,atrim=duration=28\.6\[aout\]/u);

  const shortFilter = buildAudioFilterScript({
    narrationPaths: [],
    musicPath: null,
    revealSoundPath: '/tmp/ding.mp3',
    cryCues: [],
    renderPlan: {
      total_duration_seconds: 28.6,
      rounds: [{ answer_start_seconds: 6 }],
    },
  });
  assert.doesNotMatch(shortFilter, /apad/u);
});
