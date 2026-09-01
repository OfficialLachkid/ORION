import {
  DEFAULT_COUNTDOWN_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_TIMER_END_VOLUME,
  DEFAULT_VOICE_VOLUME,
  ensureNumber,
} from '../../dual-type-reveal/render/constants.mjs';

const DEFAULT_STAT_CLASH_POKEBALL_VOLUME = Number((DEFAULT_TIMER_END_VOLUME * 0.125).toFixed(3));
const DEFAULT_STAT_CLASH_CRY_VOLUME = Number((DEFAULT_TIMER_END_VOLUME * 0.125).toFixed(3));

export function buildAudioInputs(assets) {
  return assets.flatMap((asset) => ['-i', asset]);
}

export function buildStatClashCryCues(plan, renderPlan) {
  const cues = [];
  for (const round of Array.isArray(renderPlan?.rounds) ? renderPlan.rounds : []) {
    for (const candidate of Array.isArray(round?.candidates) ? round.candidates : []) {
      const cryPath = String(candidate?.subject?.cry_path || '').trim();
      if (!cryPath) {
        continue;
      }
      cues.push({
        path: cryPath,
        start_seconds: ensureNumber(candidate?.intro_start_seconds, 0) + 0.02,
        volume: DEFAULT_STAT_CLASH_CRY_VOLUME,
      });
    }
    const correctCandidate = (Array.isArray(round?.candidates) ? round.candidates : [])
      .find((candidate) => candidate?.is_correct);
    const revealCryPath = String(correctCandidate?.subject?.cry_path || '').trim();
    if (revealCryPath) {
      cues.push({
        path: revealCryPath,
        start_seconds: ensureNumber(round?.reveal_visual_start_seconds, 0) + 0.02,
        volume: DEFAULT_STAT_CLASH_CRY_VOLUME,
      });
    }
  }
  return cues;
}

export function buildAudioFilterScript({
  narrationPaths,
  musicPath,
  countdownPath,
  timerEndPath,
  introSlotRevealPath,
  cryCues = [],
  renderPlan,
  mediaDurations = {},
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
        const atempo = countdownAssetDurationSeconds / Math.max(0.1, round.countdown_duration_seconds);
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

  if (introSlotRevealPath) {
    const revealMoments = renderPlan.rounds.flatMap((round) => (
      round.candidates.map((candidate) => candidate.pokeball_start_seconds)
    ));
    const splitCount = Math.max(1, revealMoments.length);
    filters.push(`[${inputIndex}:a]asplit=${splitCount}${Array.from({ length: splitCount }, (_, index) => `[osrc${index}]`).join('')}`);
    revealMoments.forEach((startSeconds, revealIndex) => {
      const delayMs = Math.max(0, Math.round(ensureNumber(startSeconds, 0) * 1000));
      const label = `open${revealIndex}`;
      filters.push(`[osrc${revealIndex}]adelay=${delayMs}|${delayMs},volume=${DEFAULT_STAT_CLASH_POKEBALL_VOLUME}[${label}]`);
      mixLabels.push(label);
    });
    inputIndex += 1;
  }

  const normalizedCryCues = (Array.isArray(cryCues) ? cryCues : [])
    .map((cue) => ({
      path: String(cue?.path || '').trim(),
      start_seconds: ensureNumber(cue?.start_seconds, 0),
      volume: ensureNumber(cue?.volume, DEFAULT_STAT_CLASH_CRY_VOLUME),
    }))
    .filter((cue) => cue.path);
  normalizedCryCues.forEach((cue, cueIndex) => {
    const delayMs = Math.max(0, Math.round(cue.start_seconds * 1000));
    const label = `cry${cueIndex}`;
    filters.push(`[${inputIndex + cueIndex}:a]adelay=${delayMs}|${delayMs},volume=${cue.volume}[${label}]`);
    mixLabels.push(label);
  });

  filters.push(`${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[aout]`);
  return `${filters.join(';\n')}\n`;
}
