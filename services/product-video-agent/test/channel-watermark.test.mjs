import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applyChannelWatermarkToVisualFilter,
  resolvePokemonChannelIdentity,
  resolveWatermarkStartSeconds,
} from '../src/domains/pokemon/templates/shared/render/channel-watermark.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const SHARED_RENDER_EXECUTORS = Object.freeze([
  'dual-type-reveal',
  'find-the-shiny',
  'know-your-shiny',
  'memory',
  'stat-clash',
  'tournament',
  'type-speed-quiz',
  'cry-match',
]);

test('channel identity prefers a configured handle and otherwise derives one from the channel name', () => {
  assert.deepEqual(resolvePokemonChannelIdentity({
    id: 'video-channel-trivamon-youtube',
    name: 'TrivaMon',
    account_key: 'trivamon-youtube',
    metadata: { youtube_handle: '@TriviaMaster' },
  }), {
    id: 'video-channel-trivamon-youtube',
    name: 'TrivaMon',
    account_key: 'trivamon-youtube',
    handle: '@TriviaMaster',
  });
  assert.equal(resolvePokemonChannelIdentity({ name: 'Poke Quizz' }).handle, '@PokeQuizz');
});

test('watermark timing follows the shared hook boundary shapes used by Pokemon render plans', () => {
  assert.equal(resolveWatermarkStartSeconds({
    phases: { hook: { end_seconds: 1.8 } },
  }), 1.8);
  assert.equal(resolveWatermarkStartSeconds({
    intro_hook: { scene_duration_seconds: 2.42, round_start_seconds: 2 },
  }), 2.42);
  assert.equal(resolveWatermarkStartSeconds({
    matches: [{ hook_visible_until_seconds: 1.1 }],
  }), 1.1);
  assert.equal(resolveWatermarkStartSeconds({
    rounds: [{ local: { countdown_start_seconds: 1.25 } }],
  }), 1.25);
  assert.equal(resolveWatermarkStartSeconds({
    phases: { hook: { end_seconds: null } },
    rounds: [{ local: { reveal_start_seconds: 1.7 } }],
  }), 1.7);
});

test('shared filter injection adds one dynamic layered watermark after the hook', () => {
  const transformed = applyChannelWatermarkToVisualFilter({
    script: '[0:v]format=yuv420p[vout]\n',
  }, {
    plan: {
      channel: { name: 'ProffMon', handle: '@ProffMon' },
    },
    renderPlan: {
      canvas: { height: 1920 },
      phases: { hook: { end_seconds: 1.8 } },
    },
    fontPath: '/fonts/pokemon.ttf',
  });

  assert.match(transformed.script, /\[channelwatermarkbase\]/u);
  assert.match(transformed.script, /drawtext=text='@ProffMon'/u);
  assert.match(transformed.script, /fontcolor=0xFFE45C/u);
  assert.match(transformed.script, /bordercolor=0x2446B8/u);
  assert.match(transformed.script, /y=1760/u);
  assert.match(transformed.script, /enable='gte\(t,1\.8\)'/u);
  assert.equal((transformed.script.match(/\[vout\]/gu) || []).length, 1);
});

test('every current Pokemon renderer writes its filter through the shared watermark helper', async () => {
  for (const templateKey of SHARED_RENDER_EXECUTORS) {
    const sourcePath = resolve(
      PROJECT_ROOT,
      'services/product-video-agent/src/domains/pokemon/templates',
      templateKey,
      'render/render-executor.mjs',
    );
    const source = await readFile(sourcePath, 'utf8');
    assert.match(
      source,
      /writeChannelWatermarkedVisualFilterScript\(/u,
      `${templateKey} must use the shared watermark writer`,
    );
  }
});
