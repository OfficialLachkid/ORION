import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTextArtifacts } from '../src/domains/pokemon/templates/dual-type-reveal/render/drawtext-artifacts.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/dual-type-reveal/render/visual-inputs.mjs';

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
};

test('visual inputs choose loop strategy by media type and preserve reveal sprite timing', () => {
  const renderPlan = {
    total_duration_seconds: 10.2,
    canvas: {
      fps: 30,
    },
    phases: {
      reveal: {
        duration_seconds: 2.4,
      },
    },
  };
  const baseAssets = {
    type_icons: [
      { type: 'water', local_path: '/tmp/water.png' },
    ],
    overlays: {
      selected_timer_path: '/tmp/timer.gif',
      selected_primary_pokeball_overlay_path: '/tmp/pokeballs.gif',
    },
    pokemon: [
      { national_dex_number: 7, sprite_path: '/tmp/squirtle.png' },
    ],
  };

  const gifInputs = buildVisualInputs({
    assets: {
      ...baseAssets,
      background: { selected_path: '/tmp/beach.gif' },
    },
  }, renderPlan);
  assert.deepEqual(gifInputs[0].args, ['-ignore_loop', '0', '-t', '10.2', '-i', '/tmp/beach.gif']);

  const videoInputs = buildVisualInputs({
    assets: {
      ...baseAssets,
      background: { selected_path: '/tmp/beach.mp4' },
    },
  }, renderPlan);
  assert.deepEqual(videoInputs[0].args, ['-stream_loop', '-1', '-t', '10.2', '-i', '/tmp/beach.mp4']);

  const stillInputs = buildVisualInputs({
    assets: {
      ...baseAssets,
      background: { selected_path: '/tmp/beach.png' },
    },
  }, renderPlan);
  assert.deepEqual(stillInputs[0].args, ['-loop', '1', '-framerate', '30', '-t', '10.2', '-i', '/tmp/beach.png']);
  assert.deepEqual(stillInputs.at(-1).args, ['-loop', '1', '-framerate', '30', '-t', '2.4', '-i', '/tmp/squirtle.png']);
});

test('drawtext artifacts expose progressive word-by-word segments per phase', () => {
  const renderPlan = {
    text: {
      hook: 'Guess the Pokemon',
      prompt: 'Which Pokemon matches these two types?',
      reveal: "Who's that Pokemon?",
    },
    phases: {
      hook: { start_seconds: 0, end_seconds: 1.2 },
      type_prompt: { start_seconds: 1.2 },
      countdown: { start_seconds: 2.8 },
      reveal: { start_seconds: 7.8 },
    },
    audio_cues: {
      prompt_end_seconds: 2.8,
    },
    total_duration_seconds: 10.2,
  };

  const artifacts = buildTextArtifacts({ renderPlan, template });
  assert.equal(artifacts.hook.segments[0].text, 'Guess');
  assert.equal(artifacts.hook.segments.at(-1).text, 'Pokemon');
  assert.equal(artifacts.prompt.segments[0].text, 'Which');
  assert.equal(artifacts.prompt.segments.at(-1).text, 'types?');
  assert.equal(artifacts.reveal.segments.at(-1).text, 'Pokemon?');
  assert.equal(artifacts.prompt.segments[0].start_seconds < artifacts.prompt.segments.at(-1).start_seconds, true);
});
