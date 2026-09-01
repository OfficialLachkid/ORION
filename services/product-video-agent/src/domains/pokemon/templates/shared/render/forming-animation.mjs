import { ensureNumber, roundTime } from '../../dual-type-reveal/render/constants.mjs';

export function appendFormingSpriteFilters(filters, {
  inputLabel,
  outputLabel,
  workingLabelPrefix,
  startSeconds,
  durationSeconds = 1,
} = {}) {
  const start = roundTime(Math.max(0, ensureNumber(startSeconds, 0)));
  const duration = roundTime(Math.max(0.08, ensureNumber(durationSeconds, 1)));
  const end = roundTime(start + duration);
  const mixProgressExpression = `if(lt(T,${start}),0,if(gte(T,${end}),1,(T-${start})/${duration}))`;
  const channelExpression = `clip(val*(${mixProgressExpression})+255*(1-(${mixProgressExpression})),0,255)`;
  filters.push(
    `[${inputLabel}]lutrgb=r='${channelExpression}':g='${channelExpression}':b='${channelExpression}'[${outputLabel}]`,
  );
}
