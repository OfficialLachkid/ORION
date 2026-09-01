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
  const baseLabel = `${workingLabelPrefix}base`;
  const whiteSourceLabel = `${workingLabelPrefix}whitesrc`;
  const whiteFadeLabel = `${workingLabelPrefix}white`;
  filters.push(
    `[${inputLabel}]split[${baseLabel}][${whiteSourceLabel}]`,
  );
  filters.push(
    `[${whiteSourceLabel}]lutrgb=r=255:g=255:b=255,fade=t=out:st=${start}:d=${duration}:alpha=1[${whiteFadeLabel}]`,
  );
  filters.push(
    `[${baseLabel}][${whiteFadeLabel}]overlay=x=0:y=0[${outputLabel}]`,
  );
}
