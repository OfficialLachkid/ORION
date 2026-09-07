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
  const progressExpression = `clip((T-${start})/${duration},0,1)`;
  const whiteSourceLabel = `${workingLabelPrefix}white`;
  const originalSourceLabel = `${workingLabelPrefix}orig`;
  filters.push(
    `[${inputLabel}]split=2[${whiteSourceLabel}src][${originalSourceLabel}]`,
  );
  filters.push(
    `[${whiteSourceLabel}src]lutrgb=r='255':g='255':b='255'[${whiteSourceLabel}]`,
  );
  filters.push(
    `[${whiteSourceLabel}][${originalSourceLabel}]blend=all_expr='A*(1-${progressExpression})+B*${progressExpression}'[${outputLabel}]`,
  );
}
