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
  const baseLabel = `${workingLabelPrefix}base`;
  const whiteSourceLabel = `${workingLabelPrefix}whitesrc`;
  const whiteLabel = `${workingLabelPrefix}white`;
  const mixProgressExpression = `if(lt(T,${start}),0,if(gte(T,${end}),1,(T-${start})/${duration}))`;
  filters.push(
    `[${inputLabel}]split[${baseLabel}][${whiteSourceLabel}]`,
  );
  filters.push(
    `[${whiteSourceLabel}]lutrgb=r=255:g=255:b=255[${whiteLabel}]`,
  );
  filters.push(
    `[${whiteLabel}][${baseLabel}]blend=all_expr='A*(1-(${mixProgressExpression}))+B*(${mixProgressExpression})':shortest=1[${outputLabel}]`,
  );
}
