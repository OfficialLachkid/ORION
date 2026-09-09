import {
  DEFAULT_COUNTDOWN_VOLUME,
  DEFAULT_TIMER_END_VOLUME,
  DEFAULT_VOICE_VOLUME,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';
import { buildLoopingMusicFilter } from '../../shared/render/audio-looping.mjs';

const TYPE_SPEED_SHINY_SFX_VOLUME = 0.4;

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
    const musicFilter = buildLoopingMusicFilter({ inputIndex, renderPlan });
    filters.push(musicFilter.filter);
    mixLabels.push(musicFilter.label);
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

  if (shinyPath && renderPlan.audio_cues?.shiny_reveal_start_seconds != null) {
    const delayMs = Math.max(0, Math.round(renderPlan.audio_cues.shiny_reveal_start_seconds * 1000));
    filters.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${TYPE_SPEED_SHINY_SFX_VOLUME}[shiny]`);
    mixLabels.push('shiny');
  }

  filters.push(`${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[aout]`);
  return `${filters.join(';\n')}\n`;
}
