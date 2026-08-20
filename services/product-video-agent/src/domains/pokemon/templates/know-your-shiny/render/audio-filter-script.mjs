import {
  DEFAULT_COUNTDOWN_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SHINY_SFX_VOLUME,
  DEFAULT_TIMER_END_VOLUME,
  DEFAULT_VOICE_VOLUME,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

export function buildAudioInputs(assets) {
  return assets.flatMap((asset) => ['-i', asset]);
}

export function buildAudioFilterScript({
  narrationPaths,
  musicPath,
  countdownPath,
  timerEndPath,
  shinyPath,
  renderPlan,
  mediaDurations = {},
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
    const delayMs = Math.max(0, Math.round((renderPlan.audio_cues?.battle_music_start_seconds || 0) * 1000));
    const musicDuration = Math.max(0.5, renderPlan.total_duration_seconds - (renderPlan.audio_cues?.battle_music_start_seconds || 0));
    filters.push(
      `[${inputIndex}:a]atrim=0:${musicDuration},afade=t=in:st=0:d=0.15,afade=t=out:st=${Math.max(0, musicDuration - 0.6)}:d=0.6,adelay=${delayMs}|${delayMs},volume=${DEFAULT_MUSIC_VOLUME}[music]`,
    );
    mixLabels.push('music');
    inputIndex += 1;
  }

  if (countdownPath) {
    const allCountdownMoments = renderPlan.rounds.flatMap((round) => (
      round.countdown_numbers.filter((moment) => moment.value !== '0')
    ));
    const countdownAssetDurationSeconds = ensureNumber(mediaDurations.countdown_audio_duration_seconds, 0);
    if (countdownAssetDurationSeconds > 1.5) {
      const splitCount = Math.max(1, renderPlan.rounds.length);
      filters.push(`[${inputIndex}:a]asplit=${splitCount}${Array.from({ length: splitCount }, (_, index) => `[csrc${index}]`).join('')}`);
      renderPlan.rounds.forEach((round, roundIndex) => {
        const delayMs = Math.max(0, Math.round(round.countdown_start_seconds * 1000));
        const atempo = roundTime(countdownAssetDurationSeconds / Math.max(0.1, round.countdown_duration_seconds));
        const label = `countdown${roundIndex}`;
        filters.push(
          `[csrc${roundIndex}]atrim=0:${countdownAssetDurationSeconds},atempo=${atempo},atrim=0:${round.countdown_duration_seconds},afade=t=out:st=${Math.max(0, round.countdown_duration_seconds - 0.08)}:d=0.08,adelay=${delayMs}|${delayMs},volume=${DEFAULT_COUNTDOWN_VOLUME}[${label}]`,
        );
        mixLabels.push(label);
      });
    } else if (allCountdownMoments.length > 0) {
      filters.push(`[${inputIndex}:a]asplit=${allCountdownMoments.length}${allCountdownMoments.map((_, index) => `[c${index}]`).join('')}`);
      allCountdownMoments.forEach((moment, momentIndex) => {
        const delayMs = Math.max(0, Math.round(moment.start_seconds * 1000));
        const clipDurationSeconds = Math.max(0.12, Math.min(0.95, moment.end_seconds - moment.start_seconds));
        const label = `cd${momentIndex}`;
        filters.push(`[c${momentIndex}]atrim=0:${clipDurationSeconds},adelay=${delayMs}|${delayMs},volume=${DEFAULT_COUNTDOWN_VOLUME}[${label}]`);
        mixLabels.push(label);
      });
    }
    inputIndex += 1;
  }

  if (timerEndPath) {
    const splitCount = Math.max(1, renderPlan.rounds.length);
    filters.push(`[${inputIndex}:a]asplit=${splitCount}${Array.from({ length: splitCount }, (_, index) => `[tsrc${index}]`).join('')}`);
    renderPlan.rounds.forEach((round, roundIndex) => {
      const delayMs = Math.max(0, Math.round(round.reveal_start_seconds * 1000));
      const label = `timerend${roundIndex}`;
      filters.push(`[tsrc${roundIndex}]adelay=${delayMs}|${delayMs},volume=${DEFAULT_TIMER_END_VOLUME}[${label}]`);
      mixLabels.push(label);
    });
    inputIndex += 1;
  }

  if (shinyPath) {
    const splitCount = Math.max(1, renderPlan.rounds.length);
    filters.push(`[${inputIndex}:a]asplit=${splitCount}${Array.from({ length: splitCount }, (_, index) => `[ssrc${index}]`).join('')}`);
    renderPlan.rounds.forEach((round, roundIndex) => {
      const delayMs = Math.max(0, Math.round(round.reveal_visual_start_seconds * 1000));
      const label = `shiny${roundIndex}`;
      filters.push(`[ssrc${roundIndex}]adelay=${delayMs}|${delayMs},volume=${DEFAULT_SHINY_SFX_VOLUME}[${label}]`);
      mixLabels.push(label);
    });
  }

  filters.push(`${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[aout]`);
  return `${filters.join(';\n')}\n`;
}
