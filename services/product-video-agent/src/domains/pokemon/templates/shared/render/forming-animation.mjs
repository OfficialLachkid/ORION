import { normalizeAnimationTimeExpression } from '../../dual-type-reveal/render/animation-expressions.mjs';
import { ensureNumber, roundTime } from '../../dual-type-reveal/render/constants.mjs';

function buildClampedProgressExpression(startSeconds, durationSeconds, timeExpression = 't') {
  const time = normalizeAnimationTimeExpression(timeExpression);
  const start = roundTime(startSeconds);
  const duration = roundTime(Math.max(0.08, ensureNumber(durationSeconds, 1)));
  const end = roundTime(start + duration);
  return `if(lt(${time},${start}),0,if(lt(${time},${end}),(${time}-${start})/${duration},1))`;
}

export function buildFormingSpriteFilterChain({
  startSeconds,
  durationSeconds = 1,
  timeExpression = 't',
} = {}) {
  const progress = buildClampedProgressExpression(startSeconds, durationSeconds, timeExpression);
  const whiteMix = `1-(${progress})`;
  return [
    `lutrgb=r='val+((255-val)*(${whiteMix}))'`,
    `g='val+((255-val)*(${whiteMix}))'`,
    `b='val+((255-val)*(${whiteMix}))'`,
  ].join(':');
}
