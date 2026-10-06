import {
  DEFAULT_MUSIC_VOLUME,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

const LOOP_SAMPLE_WINDOW = 2000000000;

export function buildLoopingMusicFilter({
  inputIndex,
  renderPlan,
  outputLabel = 'music',
  volume = DEFAULT_MUSIC_VOLUME,
  startSeconds = null,
  fadeInSeconds = 0.15,
  fadeOutSeconds = 0.6,
} = {}) {
  const musicStartSeconds = roundTime(Math.max(
    0,
    ensureNumber(startSeconds ?? renderPlan?.audio_cues?.battle_music_start_seconds, 0),
  ));
  const totalDurationSeconds = roundTime(Math.max(
    0,
    ensureNumber(renderPlan?.total_duration_seconds, 0),
  ));
  const musicDuration = roundTime(Math.max(0.5, totalDurationSeconds - musicStartSeconds));
  const delayMs = Math.max(0, Math.round(musicStartSeconds * 1000));
  const fadeOutStart = roundTime(Math.max(0, musicDuration - Math.max(0, ensureNumber(fadeOutSeconds, 0.6))));

  return {
    label: outputLabel,
    filter: `[${inputIndex}:a]aloop=loop=-1:size=${LOOP_SAMPLE_WINDOW},atrim=0:${musicDuration},afade=t=in:st=0:d=${Math.max(0, ensureNumber(fadeInSeconds, 0.15))},afade=t=out:st=${fadeOutStart}:d=${Math.max(0, ensureNumber(fadeOutSeconds, 0.6))},adelay=${delayMs}|${delayMs},volume=${ensureNumber(volume, DEFAULT_MUSIC_VOLUME)}[${outputLabel}]`,
  };
}
