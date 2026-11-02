export const MIN_VISIBLE_SPRITE_ALPHA = 8;

export function findVisibleSpriteBounds(
  data,
  info,
  {
    frameHeight,
    alphaThreshold = MIN_VISIBLE_SPRITE_ALPHA,
  } = {},
) {
  const sourceWidth = Number(info?.width || 0);
  const totalHeight = Number(info?.height || 0);
  const hintedFrameHeight = Number(frameHeight || 0);
  const sourceHeight = hintedFrameHeight > 0
    ? Math.min(totalHeight, Math.round(hintedFrameHeight))
    : Number(info?.pageHeight || totalHeight);
  const channels = Number(info?.channels || 4);
  if (
    sourceWidth <= 0
    || sourceHeight <= 0
    || totalHeight <= 0
    || channels < 4
    || !data?.length
  ) {
    return null;
  }

  const visibleMask = new Uint8Array(sourceWidth * sourceHeight);
  let minX = sourceWidth;
  let minY = sourceHeight;
  let maxX = -1;
  let maxY = -1;
  for (let sourceY = 0; sourceY < totalHeight; sourceY += 1) {
    const localY = sourceY % sourceHeight;
    for (let x = 0; x < sourceWidth; x += 1) {
      const alphaIndex = ((sourceY * sourceWidth) + x) * channels + 3;
      if ((data[alphaIndex] || 0) < alphaThreshold) continue;
      visibleMask[(localY * sourceWidth) + x] = 1;
      if (x < minX) minX = x;
      if (localY < minY) minY = localY;
      if (x > maxX) maxX = x;
      if (localY > maxY) maxY = localY;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    sourceWidth,
    sourceHeight,
    visibleMask,
    minX,
    minY,
    maxX,
    maxY,
  };
}

export function expandVisibleSpriteBounds(bounds, padding = 0) {
  if (!bounds) return null;
  const normalizedPadding = Math.max(0, Math.round(Number(padding) || 0));
  const x = Math.max(0, bounds.minX - normalizedPadding);
  const y = Math.max(0, bounds.minY - normalizedPadding);
  const right = Math.min(bounds.sourceWidth - 1, bounds.maxX + normalizedPadding);
  const bottom = Math.min(bounds.sourceHeight - 1, bounds.maxY + normalizedPadding);
  return {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
    source_width: bounds.sourceWidth,
    source_height: bounds.sourceHeight,
  };
}
