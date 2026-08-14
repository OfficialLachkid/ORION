import {
  DEFAULT_COUNTDOWN_VOLUME,
  DEFAULT_DISAPPEAR_SFX_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_TIMER_END_VOLUME,
  DEFAULT_VOICE_VOLUME,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

export { buildAudioInputs } from '../../dual-type-reveal/render/audio-filter-script.mjs';

export function buildAudioFilterScript({
  narrationPaths,
  musicPath,
  countdownPath,
  timerEndPath,
  disappearPath,
  renderPlan,
  mediaDurations = {},
}) {
  const filters = [];
  const mixLabels = [];

  narrationPaths.forEach((path, index) => {
    const cueKey = index === 0
      ? 'hook_start_seconds'
      : index === 1
        ? 'question_start_seconds'
        : 'reveal_start_seconds';
    const delayMs = Math.max(0, Math.round((renderPlan.audio_cues[cueKey] || 0) * 1000));
    const label = `n${index}`;
    filters.push(`[${index}:a]adelay=${delayMs}|${delayMs},volume=${DEFAULT_VOICE_VOLUME}[${label}]`);
    mixLabels.push(label);
  });

  let inputIndex = narrationPaths.length;
  if (musicPath) {
    const delayMs = Math.max(0, Math.round(renderPlan.audio_cues.battle_music_start_seconds * 1000));
    const musicDuration = Math.max(0.5, renderPlan.total_duration_seconds - renderPlan.audio_cues.battle_music_start_seconds);
    filters.push(
      `[${inputIndex}:a]atrim=0:${musicDuration},afade=t=in:st=0:d=0.15,afade=t=out:st=${Math.max(0, musicDuration - 0.6)}:d=0.6,adelay=${delayMs}|${delayMs},volume=${DEFAULT_MUSIC_VOLUME}[music]`,
    );
    mixLabels.push('music');
    inputIndex += 1;
  }

  if (countdownPath) {
    const countdownDurationSeconds = Math.max(
      0,
      renderPlan.audio_cues.timer_end_seconds - renderPlan.audio_cues.countdown_start_seconds,
    );
    const countdownAssetDurationSeconds = Number(mediaDurations.countdown_audio_duration_seconds || 0);
    if (countdownAssetDurationSeconds > 1.5) {
      const countdownDelayMs = Math.max(0, Math.round(renderPlan.audio_cues.countdown_start_seconds * 1000));
      const atempo = roundTime(countdownAssetDurationSeconds / Math.max(0.1, countdownDurationSeconds));
      filters.push(
        `[${inputIndex}:a]atrim=0:${countdownAssetDurationSeconds},atempo=${atempo},atrim=0:${countdownDurationSeconds},afade=t=out:st=${Math.max(0, countdownDurationSeconds - 0.08)}:d=0.08,adelay=${countdownDelayMs}|${countdownDelayMs},volume=${DEFAULT_COUNTDOWN_VOLUME}[countdown]`,
      );
      mixLabels.push('countdown');
    } else {
      const tickCount = Math.max(1, Math.round(countdownDurationSeconds));
      filters.push(`[${inputIndex}:a]asplit=${tickCount}${Array.from({ length: tickCount }, (_, splitIndex) => `[c${splitIndex}]`).join('')}`);
      for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
        const delayMs = Math.max(0, Math.round((renderPlan.audio_cues.countdown_start_seconds + tickIndex) * 1000));
        const remainingWindowSeconds = renderPlan.audio_cues.timer_end_seconds - (renderPlan.audio_cues.countdown_start_seconds + tickIndex);
        const clipDurationSeconds = Math.max(0.12, Math.min(0.95, remainingWindowSeconds - 0.03));
        const label = `cd${tickIndex}`;
        filters.push(`[c${tickIndex}]atrim=0:${clipDurationSeconds},adelay=${delayMs}|${delayMs},volume=${DEFAULT_COUNTDOWN_VOLUME}[${label}]`);
        mixLabels.push(label);
      }
    }
    inputIndex += 1;
  }

  if (timerEndPath) {
    const delayMs = Math.max(0, Math.round(renderPlan.audio_cues.timer_end_seconds * 1000));
    filters.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${DEFAULT_TIMER_END_VOLUME}[timerend]`);
    mixLabels.push('timerend');
    inputIndex += 1;
  }

  if (disappearPath) {
    const delayMs = Math.max(0, Math.round((renderPlan.audio_cues.intro_disappear_start_seconds || 0) * 1000));
    filters.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${DEFAULT_DISAPPEAR_SFX_VOLUME}[disappear]`);
    mixLabels.push('disappear');
  }

  filters.push(`${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[aout]`);
  return `${filters.join(';\n')}\n`;
}
