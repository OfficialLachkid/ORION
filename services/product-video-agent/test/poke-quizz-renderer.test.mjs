import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNarrationDurationsToRenderPlan,
  buildCountdownMoments,
  buildAudioFilterScript,
  buildHookTypeIconLayout,
  buildVisualFilterScript,
  escapeDrawtextText,
  formatEnableBetween,
  buildPhaseSchedule,
  buildPokeQuizzRenderPlan,
  buildTimerLayout,
  buildTypeIconLayout,
  estimateWrapCharacterLimit,
  wrapTextBlock,
} from '../src/poke-quizz-renderer.mjs';

const template = {
  canvas: {
    width: 1080,
    height: 1920,
    fps: 30,
    safe_zone: {
      top: 160,
      right: 100,
      bottom: 260,
      left: 100,
    },
  },
  layout: {
    type_icons: {
      spacing_px: 42,
      icon_size_px: 252,
    },
    pokeball_grid: {
      item_size_px: 300,
      stage_bounds_px: {
        left: 20,
        top: 760,
        width: 1040,
        height: 1040,
      },
    },
    timer: {
      countdown_from: 5,
      countdown_to: 0,
    },
  },
};

const plan = {
  seed: 'venusaur-grass-poison',
  timeline: [
    { phase: 'hook', duration_seconds: 1.2, on_screen_text: 'Guess the Pokemon' },
    { phase: 'type_prompt', duration_seconds: 1.6, on_screen_text: 'Which Pokemon matches these two types?' },
    { phase: 'countdown', duration_seconds: 5 },
    { phase: 'reveal', duration_seconds: 2.4, spoken_text: "Who's that Pokemon?" },
  ],
  selection: {
    type_pair: ['grass', 'poison'],
  },
  narration: {
    lines: [
      { role: 'hook', text: 'Guess the Pokemon' },
      { role: 'prompt', text: 'Which Pokemon matches these two types?' },
      { role: 'reveal', text: "Who's that Pokemon?" },
    ],
  },
  assets: {
    type_icons: [
      { type: 'grass', local_path: '/tmp/grass.png' },
      { type: 'poison', local_path: '/tmp/poison.png' },
    ],
    overlays: {
      pokeball_grid: {
        item_size_px: 180,
        cells: [
          { x: 138, y: 562 },
          { x: 346, y: 562 },
          { x: 554, y: 562 },
          { x: 762, y: 562 },
          { x: 242, y: 770 },
          { x: 450, y: 770 },
        ],
      },
    },
  },
};

test('phase schedule accumulates the Poke Quizz timeline deterministically', () => {
  const schedule = buildPhaseSchedule(plan.timeline);
  assert.equal(schedule.total_duration_seconds, 10.2);
  assert.equal(schedule.phases.type_prompt.start_seconds, 1.2);
  assert.equal(schedule.phases.countdown.start_seconds, 2.8);
  assert.equal(schedule.phases.reveal.start_seconds, 7.8);
});

test('prompt wrapping keeps long quiz text inside a centered two-line block', () => {
  const wrapped = wrapTextBlock('Which Pokemon matches these two types?', {
    maxCharactersPerLine: estimateWrapCharacterLimit(template, 81),
    maxLines: 3,
  });
  assert.deepEqual(wrapped.lines, [
    'Which Pokemon',
    'matches these two',
    'types?',
  ]);
});

test('type icon layout stays centered in the upper middle', () => {
  const layout = buildTypeIconLayout(template, 2);
  assert.deepEqual(layout[0], { x: 267, y: 320, width: 252, height: 252 });
  assert.deepEqual(layout[1], { x: 561, y: 320, width: 252, height: 252 });
});

test('hook type icon layout starts larger and centered before settling', () => {
  const layout = buildHookTypeIconLayout(template, 2);
  assert.deepEqual(layout[0], { x: 119, y: 620, width: 391, height: 391 });
  assert.deepEqual(layout[1], { x: 570, y: 620, width: 391, height: 391 });
});

test('badge-style hook icons skip the synthetic white backdrop path', () => {
  const badgePlan = {
    ...plan,
    assets: {
      ...plan.assets,
      type_icons: [
        { type: 'grass', local_path: '/tmp/grass.png', style_variant: 'badge-style' },
        { type: 'poison', local_path: '/tmp/poison.png', style_variant: 'badge-style' },
      ],
      pokemon: [],
      overlays: {
        ...plan.assets.overlays,
        pokeball_grid: {
          cells: [],
          item_count: 0,
          columns: 0,
          rows: 0,
          item_size_px: 180,
        },
      },
    },
  };
  const renderPlan = buildPokeQuizzRenderPlan({
    plan: badgePlan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  const visualFilter = buildVisualFilterScript(
    badgePlan,
    template,
    renderPlan,
    {
      background: 0,
      typeIcons: [1, 2],
      timerCountdown: 3,
      timerAlarm: null,
      pokeball: 4,
      pokemon: [],
    },
    null,
    {
      hook: { lines: [] },
      prompt: { lines: [] },
      reveal: { lines: [] },
    },
  );
  assert.doesNotMatch(visualFilter.script, /color=c=white:s=640x640/u);
  assert.doesNotMatch(visualFilter.script, /typeoutline/u);
});

test('timer layout sits above the pokeball grid with centered number anchors', () => {
  const layout = buildTimerLayout(template, {
    item_size_px: 240,
    stage_bounds_px: {
      left: 20,
      top: 760,
      width: 1040,
      height: 1040,
    },
  });
  assert.equal(layout.x, 450);
  assert.equal(layout.y, 596);
  assert.equal(layout.width, 180);
  assert.equal(layout.height, 180);
  assert.equal(layout.number_center_x, 540);
  assert.equal(layout.number_center_y, 686);
});

test('countdown moments stop at 1 instead of showing a 0 card', () => {
  const schedule = buildPhaseSchedule(plan.timeline);
  const countdown = buildCountdownMoments(schedule, 5, 0);
  assert.equal(countdown.length, 5);
  assert.deepEqual(countdown[0], { value: '5', start_seconds: 2.8, end_seconds: 3.8 });
  assert.deepEqual(countdown.at(-1), { value: '1', start_seconds: 6.8, end_seconds: 8.15 });
});

test('render plan derives battle-music lead-in and preserves grid geometry', () => {
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  assert.equal(renderPlan.audio_cues.reveal_start_seconds, 7.8);
  assert.equal(renderPlan.audio_cues.reveal_visual_start_seconds, 8.3);
  assert.equal(renderPlan.audio_cues.battle_music_start_seconds, 0);
  assert.equal(renderPlan.grid.cells.length, 6);
  assert.equal(renderPlan.type_icon_intro_layout[0].width > renderPlan.type_icon_layout[0].width, true);
  assert.equal(renderPlan.transitions.type_icon_settle_seconds, 0.256);
  assert.equal(renderPlan.timer_layout.y > renderPlan.type_icon_layout[0].y, true);
  assert.equal(renderPlan.timer_layout.y < template.layout.pokeball_grid.stage_bounds_px.top, true);
  assert.equal(renderPlan.output_path.endsWith('grass-poison-preview.mp4'), true);
});

test('visual filter script starts pokeballs earlier and enlarges the timer visual around the same center', () => {
  const visualPlan = {
    ...plan,
    assets: {
      ...plan.assets,
      pokemon: [],
    },
  };
  const renderPlan = buildPokeQuizzRenderPlan({
    plan: visualPlan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  const visualFilter = buildVisualFilterScript(
    visualPlan,
    template,
    renderPlan,
    {
      background: 0,
      typeIcons: [1, 2],
      timerCountdown: 3,
      timerAlarm: 4,
      pokeball: 5,
      pokemon: [],
    },
    null,
    {
      hook: { lines: [] },
      prompt: { lines: [] },
      reveal: { lines: [] },
    },
  );

  assert.match(visualFilter.script, /setpts=PTS-STARTPTS\+2\.3\/TB,scale=216:216/u);
  assert.match(visualFilter.script, /scale=234:234:force_original_aspect_ratio=decrease/u);
  assert.match(visualFilter.script, /overlay=x='540-w\/2':y='686-h\/2'/u);
  assert.match(visualFilter.script, /if\(lt\(t,0\),0\.56,if\(lt\(t,0\.12\),0\.56\+\(\(t-0\)\/0\.12\)\*0\.60/u);
  assert.match(visualFilter.script, /\(t-1\.2\)\/0\.192/u);
  assert.match(visualFilter.script, /\(t-1\.2\)\/0\.256/u);
});

test('prompt cue window can extend to the measured narration duration', () => {
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  const adjusted = applyNarrationDurationsToRenderPlan(renderPlan, {
    prompt_seconds: 2.6,
  });
  assert.equal(adjusted.audio_cues.prompt_end_seconds, 3.8);
  assert.equal(adjusted.audio_cues.countdown_start_seconds, 3.8);
  assert.equal(adjusted.audio_cues.reveal_start_seconds, 8.8);
  assert.equal(adjusted.total_duration_seconds, 11.2);
  assert.deepEqual(adjusted.countdown_numbers[0], { value: '5', start_seconds: 3.8, end_seconds: 4.8 });
});

test('audio filter script repeats short tick assets when no long countdown bed exists', () => {
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  const script = buildAudioFilterScript({
    narrationPaths: ['/tmp/hook.wav', '/tmp/prompt.wav', '/tmp/reveal.wav'],
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/timer_finished.mp3',
    renderPlan,
  });
  assert.doesNotMatch(script, /\]\]amix/u);
  assert.match(script, /\[n0\]\[n1\]\[n2\]\[music\]\[cd0\]\[cd1\]\[cd2\]\[cd3\]\[cd4\]\[timerend\]amix/u);
  assert.match(script, /\[c4\]atrim=0:0\.95,adelay=6800\|6800,volume=0\.72\[cd4\]/u);
});

test('audio filter script time-warps a full countdown bed to the reveal boundary', () => {
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  const script = buildAudioFilterScript({
    narrationPaths: ['/tmp/hook.wav', '/tmp/prompt.wav', '/tmp/reveal.wav'],
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/timer_finished.mp3',
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 5.533,
    },
  });
  assert.doesNotMatch(script, /asplit=5/u);
  assert.match(script, /\[4:a\]atrim=0:5\.533,atempo=1\.107,atrim=0:5/u);
  assert.match(script, /\[n0\]\[n1\]\[n2\]\[music\]\[countdown\]\[timerend\]amix/u);
});

test('escaped enable windows are safe for ffmpeg filter parsing', () => {
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  assert.match(
    JSON.stringify(renderPlan.countdown_numbers),
    /6\.8/u,
  );
  assert.equal(
    formatEnableBetween(renderPlan.phases.type_prompt.start_seconds, renderPlan.phases.reveal.start_seconds),
    'between(t,1.2,7.8)',
  );
});

test('drawtext escaping preserves apostrophes for ffmpeg filter parsing', () => {
  assert.equal(
    escapeDrawtextText("Who's that Pokemon?"),
    "Who\\'s that Pokemon?",
  );
});
