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
  const stepMixes = [0, 0.28, 0.58, 0.82];
  let currentInputLabel = inputLabel;
  stepMixes.forEach((mixProgress, index) => {
    const stepStart = roundTime(start + ((duration / stepMixes.length) * index));
    const stepEnd = roundTime(index === stepMixes.length - 1
      ? end
      : start + ((duration / stepMixes.length) * (index + 1)));
    const label = index === stepMixes.length - 1
      ? outputLabel
      : `${workingLabelPrefix}step${index}`;
    const whiteness = Number((1 - mixProgress).toFixed(3));
    const channelExpression = `clip(val*${mixProgress}+255*${whiteness},0,255)`;
    filters.push(
      `[${currentInputLabel}]lutrgb=r='${channelExpression}':g='${channelExpression}':b='${channelExpression}':enable='between(t,${stepStart},${stepEnd})'[${label}]`,
    );
    currentInputLabel = label;
  });
}
