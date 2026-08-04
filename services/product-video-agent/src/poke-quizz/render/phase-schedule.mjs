import { ensureNumber, roundTime } from './constants.mjs';

export function buildPhaseSchedule(timeline = []) {
  const phases = {};
  let currentStart = 0;
  for (const entry of timeline) {
    const duration = ensureNumber(entry.duration_seconds, 0);
    phases[entry.phase] = {
      phase: entry.phase,
      start_seconds: roundTime(currentStart),
      duration_seconds: roundTime(duration),
      end_seconds: roundTime(currentStart + duration),
    };
    currentStart += duration;
  }
  return {
    phases,
    total_duration_seconds: roundTime(currentStart),
  };
}

export function buildCountdownMoments(schedule, countdownFrom, countdownTo = 0) {
  const countdownPhase = schedule.phases.countdown;
  if (!countdownPhase) return [];
  const values = [];
  let current = ensureNumber(countdownFrom, 5);
  const configuredTarget = ensureNumber(countdownTo, 0);
  const target = current > configuredTarget && configuredTarget <= 0
    ? 1
    : configuredTarget;
  const direction = current >= target ? -1 : 1;
  let offset = 0;
  while ((direction === -1 && current >= target) || (direction === 1 && current <= target)) {
    const start = countdownPhase.start_seconds + offset;
    const isLast = current === target;
    values.push({
      value: String(current),
      start_seconds: roundTime(start),
      end_seconds: roundTime(isLast ? countdownPhase.end_seconds + 0.35 : start + 1),
    });
    current += direction;
    offset += 1;
  }
  return values;
}
