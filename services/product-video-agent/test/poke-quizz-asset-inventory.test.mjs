import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKGROUND_EXTENSIONS,
  buildThreeDTypeStyleCatalog,
  isAssetCandidateFileName,
  selectOverlayPresets,
  selectSoundEffectPresets,
  selectTypeIconSet,
} from '../src/poke-quizz-asset-inventory.mjs';

test('asset inventory ignores hidden and AppleDouble metadata files', () => {
  assert.equal(isAssetCandidateFileName('grass.gif'), true);
  assert.equal(isAssetCandidateFileName('.DS_Store'), false);
  assert.equal(isAssetCandidateFileName('._grass.gif'), false);
  assert.equal(isAssetCandidateFileName(''), false);
});

test('background inventory excludes avif assets until the renderer supports them', () => {
  assert.equal(BACKGROUND_EXTENSIONS.has('.avif'), false);
  assert.equal(BACKGROUND_EXTENSIONS.has('.jpg'), true);
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

test('overlay preset selection exposes open-close pokeball separately while keeping 3D as the primary generic pokeball', () => {
  const presets = selectOverlayPresets([
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/3D Pokeball Wiggle.gif',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/disappear.gif',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/Open and Close Pokeball.gif',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/long-hp-bar-countdown-1s.mp4',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/long-hp-bar.png',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/shiny_sparkle.gif',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/Timer Countdown.gif',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/Timer Alarm.gif',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/Pixel Pokeball Wiggle.gif',
  ]);

  assert.match(presets.timer || '', /Timer Countdown\.gif$/u);
  assert.match(presets.timer_countdown || '', /Timer Countdown\.gif$/u);
  assert.match(presets.timer_alarm || '', /Timer Alarm\.gif$/u);
  assert.match(presets.long_hp_bar || '', /long-hp-bar-countdown-1s\.mp4$/u);
  assert.match(presets.hp_bar || '', /long-hp-bar-countdown-1s\.mp4$/u);
  assert.match(presets.long_hp_bar_frame || '', /long-hp-bar\.png$/u);
  assert.match(presets.hp_bar_frame || '', /long-hp-bar\.png$/u);
  assert.match(presets.shiny_sparkle || '', /shiny_sparkle\.gif$/u);
  assert.match(presets.disappear || '', /disappear\.gif$/u);
  assert.match(presets.pokeball_open_close || '', /Open and Close Pokeball\.gif$/u);
  assert.match(presets.pokeball_primary || '', /3D Pokeball Wiggle\.gif$/u);
});

test('overlay preset selection prefers greenscreen hp-bar videos when present', () => {
  const presets = selectOverlayPresets([
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/long-hp-bar-countdown-1s.mp4',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/long-hp-bar-countdown-1s-greenscreen.mp4',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/long-hp-bar.png',
  ]);

  assert.match(presets.long_hp_bar || '', /long-hp-bar-countdown-1s-greenscreen\.mp4$/u);
  assert.match(presets.hp_bar || '', /long-hp-bar-countdown-1s-greenscreen\.mp4$/u);
  assert.match(presets.long_hp_bar_frame || '', /long-hp-bar\.png$/u);
});

test('timer_finished stays the shared timer-end default when a ding file is also present', async () => {
  const soundEffectPresets = selectSoundEffectPresets([
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/countdown.mp3',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/ding-sound.mp3',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/disappear-sound.mp3',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/enlarge-pokeball.mp3',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/shiny-sound.mp3',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/timer_finished.mp3',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/pokeball_wiggle.mp3',
  ]);

  assert.match(soundEffectPresets.countdown_tick || '', /countdown\.mp3$/u);
  assert.match(soundEffectPresets.timer_end || '', /timer_finished\.mp3$/u);
  assert.match(soundEffectPresets.reveal || '', /timer_finished\.mp3$/u);
  assert.match(soundEffectPresets.shiny || '', /shiny-sound\.mp3$/u);
  assert.match(soundEffectPresets.disappear || '', /disappear-sound\.mp3$/u);
  assert.match(soundEffectPresets.pokeball_intro || '', /enlarge-pokeball\.mp3$/u);
  assert.match(soundEffectPresets.pokeball_wiggle || '', /pokeball_wiggle\.mp3$/u);
});

test('disappear-sound files are detected as the disappear cue', async () => {
  const soundEffectPresets = selectSoundEffectPresets([
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/countdown.mp3',
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Audio/Sound Effects/disappear-sound.mp3',
  ]);

  assert.match(soundEffectPresets.disappear || '', /disappear-sound\.mp3$/u);
});
