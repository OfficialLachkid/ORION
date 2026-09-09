import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoopingMusicFilter } from '../src/domains/pokemon/templates/shared/render/audio-looping.mjs';

test('buildLoopingMusicFilter loops short music across the render duration', () => {
  const result = buildLoopingMusicFilter({
    inputIndex: 2,
    renderPlan: {
      total_duration_seconds: 12,
      audio_cues: {
        battle_music_start_seconds: 1.5,
      },
    },
  });

  assert.equal(result.label, 'music');
  assert.match(result.filter, /^\[2:a\]aloop=loop=-1:size=2000000000,atrim=0:10\.5,/u);
  assert.match(result.filter, /afade=t=in:st=0:d=0\.15/u);
  assert.match(result.filter, /afade=t=out:st=9\.9:d=0\.6/u);
  assert.match(result.filter, /adelay=1500\|1500/u);
  assert.match(result.filter, /volume=0\.18\[music\]$/u);
});
