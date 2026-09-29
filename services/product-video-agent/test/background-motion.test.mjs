import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBackgroundPreparationFilter,
  calculatePanCycleSeconds,
} from '../src/domains/pokemon/templates/shared/render/background-motion.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const TEMPLATE_ROOT = resolve(HERE, '..', 'config', 'templates', 'pokemon');

const motionTemplate = {
  layout: {
    background: {
      motion: {
        enabled: true,
        zoom_scale: 1.12,
        subpixel_scale: 2,
        pan_speed_px_per_second: 22,
        vertical_pan_speed_px_per_second: 16,
        minimum_pan_cycle_seconds: 18,
        vertical_pan_ratio: 0.72,
      },
    },
  },
};

test('dimension-aware pan keeps the same peak speed and lengthens wide-image cycles', () => {
  const portraitCycle = calculatePanCycleSeconds({
    travelDistancePx: 130,
    speedPxPerSecond: 22,
    minimumCycleSeconds: 18,
  });
  const landscapeCycle = calculatePanCycleSeconds({
    travelDistancePx: 2740,
    speedPxPerSecond: 22,
    minimumCycleSeconds: 18,
  });

  assert.ok(Math.abs(portraitCycle - 18.564) < 0.01);
  assert.ok(Math.abs(landscapeCycle - 391.272) < 0.01);
  assert.ok(Math.abs((Math.PI * 130) / portraitCycle - 22) < 0.01);
  assert.ok(Math.abs((Math.PI * 2740) / landscapeCycle - 22) < 0.01);
});

test('background filter derives angular speed from actual scaled overflow', () => {
  const filter = buildBackgroundPreparationFilter({
    inputRef: 0,
    width: 1080,
    height: 1920,
    fps: 30,
    blurSigma: 6,
    template: motionTemplate,
    seed: 'ratio-safe-video',
  });

  assert.match(filter, /iw-2160/u);
  assert.match(filter, /\(ih-3840\)\*0\.72/u);
  assert.match(filter, /abs\(\(iw-2160\)-/u);
  assert.match(filter, /abs\(\(\(ih-3840\)\*0\.72\)-/u);
  assert.doesNotMatch(filter, /t\*0\.349066/u);
});

test('background motion starts at a stable seed-specific source position', () => {
  const build = (seed) => buildBackgroundPreparationFilter({
    inputRef: 0,
    width: 1080,
    height: 1920,
    fps: 30,
    blurSigma: 6,
    template: motionTemplate,
    seed,
  });

  assert.equal(build('video-a'), build('video-a'));
  assert.notEqual(build('video-a'), build('video-b'));
});

test('every roaming Shorts template uses the shared safe-speed contract', async () => {
  for (const templateName of ['build-your-team', 'progressive-reveal', 'pixelated-reveal']) {
    const template = JSON.parse(await readFile(resolve(TEMPLATE_ROOT, `${templateName}.v1.json`), 'utf8'));
    const motion = template.layout.background.motion;
    assert.equal(motion.pan_speed_px_per_second, 22, templateName);
    assert.equal(motion.vertical_pan_speed_px_per_second, 16, templateName);
    assert.equal(motion.minimum_pan_cycle_seconds, 18, templateName);
  }
});
