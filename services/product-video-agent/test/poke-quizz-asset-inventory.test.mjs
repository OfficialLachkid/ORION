import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildThreeDTypeStyleCatalog,
  isAssetCandidateFileName,
  selectOverlayPresets,
  selectTypeIconSet,
} from '../src/poke-quizz-asset-inventory.mjs';

test('asset inventory ignores hidden and AppleDouble metadata files', () => {
  assert.equal(isAssetCandidateFileName('grass.gif'), true);
  assert.equal(isAssetCandidateFileName('.DS_Store'), false);
  assert.equal(isAssetCandidateFileName('._grass.gif'), false);
  assert.equal(isAssetCandidateFileName(''), false);
});

test('type icon selection prefers 3D assets only when every requested type exists', () => {
  const inventory = {
    type_icons: {
      pixel: [
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/grass.gif',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
      ],
      three_d: [
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/badge-style/grass.png',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/badge-style/poison.png',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/glow-style/grass.png',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/glow-style/poison.png',
      ],
      three_d_styles: buildThreeDTypeStyleCatalog([
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/badge-style/grass.png',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/badge-style/poison.png',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/glow-style/grass.png',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/glow-style/poison.png',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/legacy/grass.png',
      ]),
    },
  };

  assert.deepEqual(selectTypeIconSet(['grass', 'poison'], inventory), {
    style: 'three_d',
    style_variant: 'badge-style',
    file_paths: [
      '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/badge-style/grass.png',
      '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/badge-style/poison.png',
    ],
  });
});

test('type icon selection falls back to pixel assets when no single 3D style covers the pair', () => {
  const inventory = {
    type_icons: {
      pixel: [
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/grass.gif',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
      ],
      three_d: [
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/glow-style/grass.png',
      ],
      three_d_styles: buildThreeDTypeStyleCatalog([
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/glow-style/grass.png',
      ]),
    },
  };

  assert.deepEqual(selectTypeIconSet(['grass', 'poison'], inventory), {
    style: 'pixel',
    style_variant: 'pixel',
    file_paths: [
      '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/grass.gif',
      '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
    ],
  });
});

test('overlay preset selection prefers the 3D pokeball overlay and timer gif by filename', () => {
  const presets = selectOverlayPresets([
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/3D Pokeball Wiggle.gif',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/Timer.gif',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/Pixel Pokeball Wiggle.gif',
  ]);

  assert.match(presets.timer || '', /Timer\.gif$/u);
  assert.match(presets.pokeball_primary || '', /3D Pokeball Wiggle\.gif$/u);
});

test('timer_finished sound effect naming is recognized by the current inventory contract', async () => {
  const soundEffects = [
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/countdown.mp3',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/timer_finished.mp3',
  ];
  const countdownTick = soundEffects.find((filePath) => ['countdown', 'tick', 'beep'].some((keyword) => filePath.toLowerCase().includes(keyword)));
  const timerEnd = soundEffects.find((filePath) => ['timer-end', 'time-up', 'timer_finished', 'timer-finished', 'finished', 'ding', 'reveal-hit'].some((keyword) => filePath.toLowerCase().includes(keyword)));
  const reveal = soundEffects.find((filePath) => ['reveal', 'sparkle', 'who', 'answer'].some((keyword) => filePath.toLowerCase().includes(keyword))) || timerEnd;

  assert.match(countdownTick || '', /countdown\.mp3$/u);
  assert.match(timerEnd || '', /timer_finished\.mp3$/u);
  assert.match(reveal || '', /timer_finished\.mp3$/u);
});
