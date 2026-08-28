import {
  DEFAULT_DISAPPEAR_SFX_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_TIMER_END_VOLUME,
  DEFAULT_VOICE_VOLUME,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

const DEFAULT_TOURNAMENT_POKEBALL_VOLUME = Number((DEFAULT_TIMER_END_VOLUME * 0.125).toFixed(3));
const DEFAULT_TOURNAMENT_BRACKET_PROGRESS_VOLUME = Number((DEFAULT_TIMER_END_VOLUME * 0.25).toFixed(3));
const DEFAULT_TOURNAMENT_CRY_VOLUME = Number((DEFAULT_TIMER_END_VOLUME * 0.18).toFixed(3));

export function buildAudioInputs(assets) {
  return assets.flatMap((asset) => ['-i', asset]);
}

export function buildTournamentCryCues(plan, renderPlan) {
  const participants = Array.isArray(plan?.tournament?.participants) ? plan.tournament.participants : [];
  const matches = Array.isArray(renderPlan?.matches) ? renderPlan.matches : [];
  const participantCryById = new Map(
    participants
      .filter((participant) => String(participant?.cry_path || '').trim())
      .map((participant) => [participant.id, String(participant.cry_path || '').trim()]),
  );
  const introRevealTimes = Array.isArray(renderPlan?.intro_sequence?.participant_reveal_times)
    ? renderPlan.intro_sequence.participant_reveal_times
    : [];
  const cues = [];

  participants.forEach((participant, index) => {
    const cryPath = participantCryById.get(participant.id);
    if (!cryPath) {
      return;
    }
    cues.push({
      path: cryPath,
      start_seconds: ensureNumber(introRevealTimes[index], 0) + 0.02,
      volume: DEFAULT_TOURNAMENT_CRY_VOLUME,
    });
  });

  matches.forEach((match) => {
    const leftCryPath = participantCryById.get(match?.participant_a?.id);
    const rightCryPath = participantCryById.get(match?.participant_b?.id);
    const winnerCryPath = participantCryById.get(match?.winner?.id);
    if (leftCryPath) {
      cues.push({
        path: leftCryPath,
        start_seconds: ensureNumber(match?.intro_start_seconds, 0) + 0.02,
        volume: DEFAULT_TOURNAMENT_CRY_VOLUME,
      });
    }
    if (rightCryPath) {
      cues.push({
        path: rightCryPath,
        start_seconds: ensureNumber(match?.intro_start_seconds, 0) + 0.2,
        volume: DEFAULT_TOURNAMENT_CRY_VOLUME,
      });
    }
    if (winnerCryPath) {
      cues.push({
        path: winnerCryPath,
        start_seconds: ensureNumber(match?.reveal_start_seconds, 0) + 0.08,
        volume: DEFAULT_TOURNAMENT_CRY_VOLUME,
      });
    }
  });

  const championCryPath = participantCryById.get(plan?.tournament?.champion?.id);
  if (championCryPath) {
    cues.push({
      path: championCryPath,
      start_seconds: ensureNumber(renderPlan?.champion_scene?.start_seconds, 0) + 0.02,
      volume: DEFAULT_TOURNAMENT_CRY_VOLUME,
    });
  }

  return cues;
}

export function buildAudioFilterScript({
  narrationPaths,
  introSlotRevealPath,
  musicPath,
  bracketProgressPath,
  winnerRevealPath,
  disappearPath,
  cryCues = [],
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

  if (introSlotRevealPath) {
    const revealTimes = Array.isArray(renderPlan?.intro_sequence?.participant_reveal_times)
      ? renderPlan.intro_sequence.participant_reveal_times
      : [];
    const splitCount = Math.max(1, revealTimes.length);
    filters.push(`[${inputIndex}:a]asplit=${splitCount}${Array.from({ length: splitCount }, (_, index) => `[osrc${index}]`).join('')}`);
    revealTimes.forEach((startSeconds, revealIndex) => {
      const delayMs = Math.max(0, Math.round(ensureNumber(startSeconds, 0) * 1000));
      const label = `open${revealIndex}`;
      filters.push(`[osrc${revealIndex}]adelay=${delayMs}|${delayMs},volume=${DEFAULT_TOURNAMENT_POKEBALL_VOLUME}[${label}]`);
      mixLabels.push(label);
    });
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
    inputIndex += 1;
  }

  if (bracketProgressPath) {
    const splitCount = Math.max(1, renderPlan.matches.length);
    filters.push(`[${inputIndex}:a]asplit=${splitCount}${Array.from({ length: splitCount }, (_, index) => `[psrc${index}]`).join('')}`);
    renderPlan.matches.forEach((match, matchIndex) => {
      const delayMs = Math.max(0, Math.round(match.bracket_progress_end_seconds * 1000));
      const label = `progress${matchIndex}`;
      filters.push(`[psrc${matchIndex}]adelay=${delayMs}|${delayMs},volume=${DEFAULT_TOURNAMENT_BRACKET_PROGRESS_VOLUME}[${label}]`);
      mixLabels.push(label);
    });
    inputIndex += 1;
  }

  if (disappearPath) {
    const splitCount = Math.max(1, renderPlan.matches.length);
    const disappearDurationSeconds = Math.max(
      0.12,
      ensureNumber(renderPlan?.audio_cues?.battle_disappear_duration_seconds, 0.42),
    );
    filters.push(`[${inputIndex}:a]asplit=${splitCount}${Array.from({ length: splitCount }, (_, index) => `[dsrc${index}]`).join('')}`);
    renderPlan.matches.forEach((match, matchIndex) => {
      const startSeconds = Math.max(
        ensureNumber(match?.reveal_start_seconds, 0),
        ensureNumber(match?.scene_end_seconds, 0) - disappearDurationSeconds,
      );
      const delayMs = Math.max(0, Math.round(startSeconds * 1000));
      const label = `disp${matchIndex}`;
      filters.push(`[dsrc${matchIndex}]adelay=${delayMs}|${delayMs},volume=${DEFAULT_DISAPPEAR_SFX_VOLUME}[${label}]`);
      mixLabels.push(label);
    });
    inputIndex += 1;
  }

  const normalizedCryCues = (Array.isArray(cryCues) ? cryCues : [])
    .map((cue) => ({
      path: String(cue?.path || '').trim(),
      start_seconds: ensureNumber(cue?.start_seconds, 0),
      volume: ensureNumber(cue?.volume, DEFAULT_TOURNAMENT_CRY_VOLUME),
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
