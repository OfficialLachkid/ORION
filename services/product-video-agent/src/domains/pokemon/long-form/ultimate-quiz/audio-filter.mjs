function delayMilliseconds(seconds) {
  return Math.max(0, Math.round(Number(seconds || 0) * 1000));
}

function fixed(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

export function buildUltimateQuizAudioInputs({ narrationPaths, plan }) {
  const inputs = [];
  narrationPaths.forEach((path, index) => {
    inputs.push({ role: `narration-${index}`, path, loop: false });
  });
  plan.chapters.forEach((chapter, index) => {
    inputs.push({ role: `music-${index}`, path: chapter.music_path, loop: true });
  });
  const dingPath = String(plan?.assets?.audio?.ding_path || '').trim();
  if (dingPath) inputs.push({ role: 'ding', path: dingPath, loop: false });
  plan.rounds.forEach((round, index) => {
    const cryPath = String(round?.subject?.cry_path || '').trim();
    if (cryPath) inputs.push({ role: `cry-${index}`, path: cryPath, loop: false });
  });
  return inputs;
}

export function buildUltimateQuizAudioInputArgs(inputs = []) {
  return inputs.flatMap((input) => (
    input.loop ? ['-stream_loop', '-1', '-i', input.path] : ['-i', input.path]
  ));
}

export function buildUltimateQuizAudioFilter({
  plan,
  template,
  renderPlan,
  inputs,
}) {
  const roleIndex = new Map(inputs.map((input, index) => [input.role, index]));
  const filters = [];
  const mixLabels = [];
  const voiceVolume = Math.max(0, Number(template?.audio?.voice_volume ?? 1));
  const musicVolume = Math.max(0, Number(template?.audio?.music_volume ?? 0.12));
  const dingVolume = Math.max(0, Number(template?.audio?.ding_volume ?? 0.72));
  const cryVolume = Math.max(0, Number(template?.audio?.cry_volume ?? 0.28));
  const crossfade = Math.max(0.1, Number(template?.audio?.music_crossfade_seconds || 2));
  const cryDelay = Math.max(0, Number(template?.audio?.cry_delay_after_ding_seconds || 0.3));

  (plan?.narration?.cues || []).forEach((cue, index) => {
    const inputIndex = roleIndex.get(`narration-${index}`);
    if (inputIndex == null) return;
    const label = `voice${index}`;
    filters.push(
      `[${inputIndex}:a]aresample=48000,adelay=${delayMilliseconds(cue.start_seconds)}|${delayMilliseconds(cue.start_seconds)},volume=${voiceVolume}[${label}]`,
    );
    mixLabels.push(label);
  });

  renderPlan.chapters.forEach((chapter, index) => {
    const inputIndex = roleIndex.get(`music-${index}`);
    if (inputIndex == null) return;
    const segmentStart = index === 0
      ? 0
      : Math.max(0, Number(chapter.start_seconds) - crossfade);
    const segmentEnd = index === renderPlan.chapters.length - 1
      ? renderPlan.total_duration_seconds
      : Number(chapter.end_seconds) + crossfade;
    const duration = Math.max(0.1, segmentEnd - segmentStart);
    const fadeOutStart = Math.max(0, duration - crossfade);
    const label = `music${index}`;
    filters.push(
      `[${inputIndex}:a]aresample=48000,atrim=0:${fixed(duration)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${crossfade},afade=t=out:st=${fixed(fadeOutStart)}:d=${crossfade},adelay=${delayMilliseconds(segmentStart)}|${delayMilliseconds(segmentStart)},volume=${musicVolume}[${label}]`,
    );
    mixLabels.push(label);
  });

  const dingIndex = roleIndex.get('ding');
  if (dingIndex != null && renderPlan.rounds.length > 0) {
    const splitLabels = renderPlan.rounds.map((_, index) => `[dingsrc${index}]`).join('');
    filters.push(`[${dingIndex}:a]aresample=48000,asplit=${renderPlan.rounds.length}${splitLabels}`);
    renderPlan.rounds.forEach((round, index) => {
      const label = `ding${index}`;
      const delay = delayMilliseconds(round.answer_start_seconds);
      filters.push(`[dingsrc${index}]atrim=0:2.5,adelay=${delay}|${delay},volume=${dingVolume}[${label}]`);
      mixLabels.push(label);
    });
  }

  renderPlan.rounds.forEach((round, index) => {
    const inputIndex = roleIndex.get(`cry-${index}`);
    if (inputIndex == null) return;
    const startSeconds = round.mode === 'cry_clue'
      ? Number(round.start_seconds) + 1.1
      : Number(round.answer_start_seconds) + cryDelay;
    const label = `cry${index}`;
    const delay = delayMilliseconds(startSeconds);
    filters.push(
      `[${inputIndex}:a]aresample=48000,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB,atrim=0:4.5,adelay=${delay}|${delay},volume=${cryVolume}[${label}]`,
    );
    mixLabels.push(label);
  });

  filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${renderPlan.total_duration_seconds}[bed]`);
  mixLabels.push('bed');
  filters.push(
    `${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]`,
  );
  return `${filters.join(';\n')}\n`;
}
