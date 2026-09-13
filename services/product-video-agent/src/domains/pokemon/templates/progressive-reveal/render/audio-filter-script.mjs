import {
  DEFAULT_TIMER_END_VOLUME,
  DEFAULT_VOICE_VOLUME,
  ensureNumber,
} from '../../dual-type-reveal/render/constants.mjs';
import { buildLoopingMusicFilter } from '../../shared/render/audio-looping.mjs';

export function buildAudioInputs(assets) {
  return assets.flatMap((asset) => ['-i', asset]);
}

export function buildAudioFilterScript({
  narrationPaths,
  musicPath,
  revealSoundPath,
  renderPlan,
  revealSoundVolumeMultiplier = 1,
}) {
  const filters = [];
  const mixLabels = [];

  narrationPaths.forEach((_, index) => {
    const label = `n${index}`;
    filters.push(`[${index}:a]adelay=0|0,volume=${DEFAULT_VOICE_VOLUME}[${label}]`);
    mixLabels.push(label);
  });

  let inputIndex = narrationPaths.length;
  if (musicPath) {
    const musicFilter = buildLoopingMusicFilter({ inputIndex, renderPlan });
    filters.push(musicFilter.filter);
    mixLabels.push(musicFilter.label);
    inputIndex += 1;
  }

  if (revealSoundPath && renderPlan.rounds.length > 0) {
    const splitLabels = renderPlan.rounds.map((_, index) => `[rsrc${index}]`).join('');
    filters.push(`[${inputIndex}:a]asplit=${renderPlan.rounds.length}${splitLabels}`);
    const volume = Number((
      DEFAULT_TIMER_END_VOLUME * Math.max(0, ensureNumber(revealSoundVolumeMultiplier, 1))
    ).toFixed(3));
    renderPlan.rounds.forEach((round, index) => {
      const delayMs = Math.max(0, Math.round(round.answer_start_seconds * 1000));
      const label = `reveal${index}`;
      filters.push(`[rsrc${index}]adelay=${delayMs}|${delayMs},volume=${volume}[${label}]`);
      mixLabels.push(label);
    });
  }

  if (mixLabels.length === 0) {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${renderPlan.total_duration_seconds}[silence]`);
    mixLabels.push('silence');
  }
  filters.push(`${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[aout]`);
  return `${filters.join(';\n')}\n`;
}
