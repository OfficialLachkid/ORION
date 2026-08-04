import {
  DEFAULT_POKEBALL_INTRO_SECONDS,
  DEFAULT_TYPE_ICON_POP_IN_SECONDS,
  ensureNumber,
  roundTime,
} from './constants.mjs';

export function normalizeAnimationTimeExpression(timeExpression = 't') {
  return `(${String(timeExpression || 't').trim() || 't'})`;
}

export function formatEnableBetween(startSeconds, endSeconds) {
  return `between(t,${startSeconds},${endSeconds})`;
}

export function buildScaleFilterTimeExpression({ fps, streamStartSeconds = 0 }) {
  const normalizedFps = Math.max(1, ensureNumber(fps, 30));
  const start = roundTime(streamStartSeconds);
  return start === 0
    ? `(n/${normalizedFps})`
    : `(${start}+(n/${normalizedFps}))`;
}

export function buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds, timeExpression = 't') {
  const time = normalizeAnimationTimeExpression(timeExpression);
  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const fadeInDuration = roundTime(Math.min(0.18, Math.max(0.08, (end - start) * 0.3)));
  const fadeInEnd = roundTime(start + fadeInDuration);
  return `if(lt(${time},${start}),0,if(lt(${time},${fadeInEnd}),(${time}-${start})/${fadeInDuration},1))`;
}

export function buildAnimatedTextYExpression(baseY, startSeconds, timeExpression = 't') {
  const time = normalizeAnimationTimeExpression(timeExpression);
  const start = roundTime(startSeconds);
  const settleEnd = roundTime(start + 0.32);
  return `${baseY}+if(lt(${time},${settleEnd}),(1-((${time}-${start})/0.32))*18*sin((${time}-${start})*20),0)`;
}

export function buildAnimatedLerpExpression({
  fromValue,
  toValue,
  holdUntilSeconds,
  transitionDurationSeconds,
  timeExpression = 't',
}) {
  const time = normalizeAnimationTimeExpression(timeExpression);
  const start = roundTime(holdUntilSeconds);
  const duration = roundTime(Math.max(0.12, transitionDurationSeconds));
  const end = roundTime(start + duration);
  const progress = `min(max((${time}-${start})/${duration},0),1)`;
  return `if(lt(${time},${start}),${fromValue},if(lt(${time},${end}),${fromValue}+((${toValue}-${fromValue})*${progress}),${toValue}))`;
}

export function buildAnimatedPopSettleExpression(
  startSeconds,
  durationSeconds = DEFAULT_POKEBALL_INTRO_SECONDS,
  initialScale = 0.42,
  peakScale = 1.08,
  settleScale = 1,
  timeExpression = 't',
) {
  const time = normalizeAnimationTimeExpression(timeExpression);
  const start = roundTime(startSeconds);
  const duration = roundTime(Math.max(0.12, durationSeconds));
  const peak = roundTime(start + (duration * 0.36));
  const end = roundTime(start + duration);
  return `if(lt(${time},${start}),${initialScale},if(lt(${time},${peak}),${initialScale}+((${time}-${start})/${roundTime(peak - start)})*${roundTime(peakScale - initialScale)},if(lt(${time},${end}),${peakScale}-((${time}-${peak})/${roundTime(end - peak)})*${roundTime(peakScale - settleScale)},${settleScale})))`;
}

export function buildAnimatedLiftExpression(
  startSeconds,
  durationSeconds = DEFAULT_TYPE_ICON_POP_IN_SECONDS,
  distancePx = 42,
  timeExpression = 't',
) {
  const time = normalizeAnimationTimeExpression(timeExpression);
  const start = roundTime(startSeconds);
  const duration = roundTime(Math.max(0.16, durationSeconds));
  const end = roundTime(start + duration);
  return `if(lt(${time},${start}),${distancePx},if(lt(${time},${end}),${distancePx}*(1-((${time}-${start})/${duration})),0))`;
}

export function buildTimerAlarmExitScaleExpression(exitStartSeconds, exitEndSeconds, timeExpression = 't') {
  const time = normalizeAnimationTimeExpression(timeExpression);
  const start = roundTime(exitStartSeconds);
  const end = roundTime(exitEndSeconds);
  const duration = roundTime(Math.max(0.18, end - start));
  const peak = roundTime(start + (duration * 0.38));
  return `if(lt(${time},${start}),1,if(lt(${time},${peak}),1+((${time}-${start})/${roundTime(peak - start)})*0.18,if(lt(${time},${end}),max(0.01,1.18-((${time}-${peak})/${roundTime(end - peak)})*1.18),0.01)))`;
}

export function resolveRevealSpriteHoldSize({ gridItemSize, itemCount, configuredMultiplier }) {
  const desiredSize = gridItemSize * Math.max(1, configuredMultiplier);
  if (itemCount <= 2) return roundTime(desiredSize);
  if (itemCount <= 4) return roundTime(Math.min(desiredSize, gridItemSize * 1.38));
  if (itemCount <= 6) return roundTime(Math.min(desiredSize, gridItemSize * 1.26));
  return roundTime(Math.min(desiredSize, gridItemSize * 1.14));
}

export function buildCountdownNumberScaleMultiplierExpression(startSeconds, endSeconds) {
  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const duration = roundTime(Math.max(0.18, end - start));
  const popDuration = roundTime(Math.min(0.24, Math.max(0.16, duration * 0.28)));
  const peak = roundTime(start + (popDuration * 0.58));
  const settle = roundTime(start + popDuration);
  const outroDuration = roundTime(Math.min(0.18, Math.max(0.12, duration * 0.2)));
  const outroStart = roundTime(Math.max(settle, end - outroDuration));
  return `if(lt(t,${start}),0.78,if(lt(t,${peak}),0.78+((t-${start})/${roundTime(peak - start)})*0.44,if(lt(t,${settle}),1.22-((t-${peak})/${roundTime(settle - peak)})*0.22,if(lt(t,${outroStart}),1,if(lt(t,${end}),1-((t-${outroStart})/${outroDuration})*0.1,0.9)))))`;
}

export function buildCountdownNumberAlphaExpression(startSeconds, endSeconds) {
  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const duration = roundTime(Math.max(0.18, end - start));
  const fadeInDuration = roundTime(Math.min(0.16, Math.max(0.08, duration * 0.18)));
  const fadeOutDuration = roundTime(Math.min(0.12, Math.max(0.08, duration * 0.14)));
  const fadeInEnd = roundTime(start + fadeInDuration);
  const fadeOutStart = roundTime(Math.max(fadeInEnd, end - fadeOutDuration));
  return `if(lt(t,${start}),0,if(lt(t,${fadeInEnd}),(t-${start})/${fadeInDuration},if(lt(t,${fadeOutStart}),1,if(lt(t,${end}),(${end}-t)/${fadeOutDuration},0))))`;
}

export function buildCountdownNumberYExpression(baseY, startSeconds, endSeconds) {
  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const duration = roundTime(Math.max(0.18, end - start));
  const introDuration = roundTime(Math.min(0.22, Math.max(0.14, duration * 0.24)));
  const outroDuration = roundTime(Math.min(0.18, Math.max(0.1, duration * 0.18)));
  const introEnd = roundTime(start + introDuration);
  const outroStart = roundTime(Math.max(introEnd, end - outroDuration));
  return `${baseY}+if(lt(t,${introEnd}),(${introEnd}-t)/${introDuration}*20,if(lt(t,${outroStart}),sin((t-${start})*14)*2,-((t-${outroStart})/${outroDuration})*12))`;
}
