import {
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_TIMER_END_VOLUME,
  DEFAULT_VOICE_VOLUME,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

export function buildAudioInputs(assets) {
  return assets.flatMap((asset) => ['-i', asset]);
}

export function buildAudioFilterScript({
  narrationPaths,
  musicPath,
  winnerRevealPath,
  renderPlan,
}) {
  const filters = [];
  const mixLabels = [];

  narrationPaths.forEach((_, index) => {
    const cue = renderPlan.narration_cues[index] || { start_seconds: 0 };
    const delayMs = Math.max(0, Math.round((cue.start_seconds || 0) * 1000));
    const label = `n${index}`;
    filters.push(`[${index}:a]adelay=${delayMs}|${delayMs},volume=${DEFAULT_VOICE_VOLUME}[${label}]`);
    mixLabels.push(label);
  });

  let inputIndex = narrationPaths.length;
  if (musicPath) {
    const delayMs = Math.max(0, Math.round((renderPlan.audio_cues?.battle_music_start_seconds || 0) * 1000));
    const musicDuration = Math.max(0.5, renderPlan.total_duration_seconds - (renderPlan.audio_cues?.battle_music_start_seconds || 0));
    filters.push(
      `[${inputIndex}:a]atrim=0:${musicDuration},afade=t=in:st=0:d=0.15,afade=t=out:st=${Math.max(0, roundTime(musicDuration - 0.6))}:d=0.6,adelay=${delayMs}|${delayMs},volume=${DEFAULT_MUSIC_VOLUME}[music]`,
    );
    mixLabels.push('music');
    inputIndex += 1;
  }

  if (winnerRevealPath) {
    const splitCount = Math.max(1, renderPlan.matches.length);
    filters.push(`[${inputIndex}:a]asplit=${splitCount}${Array.from({ length: splitCount }, (_, index) => `[wsrc${index}]`).join('')}`);
    renderPlan.matches.forEach((match, matchIndex) => {
      const delayMs = Math.max(0, Math.round(match.reveal_start_seconds * 1000));
      const label = `win${matchIndex}`;
      filters.push(`[wsrc${matchIndex}]adelay=${delayMs}|${delayMs},volume=${DEFAULT_TIMER_END_VOLUME}[${label}]`);
      mixLabels.push(label);
    });
  }

  filters.push(`${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[aout]`);
  return `${filters.join(';\n')}\n`;
}
