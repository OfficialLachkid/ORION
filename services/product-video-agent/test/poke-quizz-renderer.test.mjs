import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountdownMoments,
  buildAudioFilterScript,
  escapeDrawtextText,
  formatEnableBetween,
  buildPhaseSchedule,
  buildPokeQuizzRenderPlan,
  buildTimerLayout,
  buildTypeIconLayout,
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
      spacing_px: 28,
      icon_size_px: 168,
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

test('type icon layout stays centered in the upper middle', () => {
  const layout = buildTypeIconLayout(template, 2);
  assert.deepEqual(layout[0], { x: 358, y: 320, width: 168, height: 168 });
  assert.deepEqual(layout[1], { x: 554, y: 320, width: 168, height: 168 });
});

test('timer layout stays lower-middle above the safe bottom zone', () => {
  const layout = buildTimerLayout(template);
  assert.equal(layout.x, 420);
  assert.equal(layout.y, 1360);
  assert.equal(layout.width, 240);
  assert.equal(layout.height, 240);
});

test('countdown moments include the 0 card at reveal time', () => {
  const schedule = buildPhaseSchedule(plan.timeline);
  const countdown = buildCountdownMoments(schedule, 5, 0);
  assert.equal(countdown.length, 6);
  assert.deepEqual(countdown[0], { value: '5', start_seconds: 2.8, end_seconds: 3.8 });
  assert.deepEqual(countdown.at(-1), { value: '0', start_seconds: 7.8, end_seconds: 8.15 });
});

test('render plan derives battle-music lead-in and preserves grid geometry', () => {
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  assert.equal(renderPlan.audio_cues.reveal_start_seconds, 7.8);
  assert.equal(renderPlan.audio_cues.battle_music_start_seconds, 7.2);
  assert.equal(renderPlan.grid.cells.length, 6);
  assert.equal(renderPlan.output_path.endsWith('grass-poison-preview.mp4'), true);
});

test('audio filter script chains labeled inputs directly into amix', () => {
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
});

test('escaped enable windows are safe for ffmpeg filter parsing', () => {
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Previews/Poke Quizz/grass-poison-preview.mp4',
  });
  assert.match(
    JSON.stringify(renderPlan.countdown_numbers),
    /7\.8/u,
  );
  assert.equal(
    formatEnableBetween(renderPlan.phases.type_prompt.start_seconds, renderPlan.phases.reveal.start_seconds),
    'between(t,1.2,7.8)',
  );
});

test('drawtext escaping preserves apostrophes for ffmpeg filter parsing', () => {
  assert.equal(
    escapeDrawtextText("Who's that Pokemon?"),
    "Who'\\''s that Pokemon?",
  );
});
