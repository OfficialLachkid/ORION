const DEFAULT_VISIBLE_MARGIN_PX = 24;
const DEFAULT_CROP_PADDING_PX = 4;
const MIN_VISIBLE_ALPHA = 8;
const MAX_OPAQUE_ANALYSIS_POINTS = 18000;

const spriteAnalysisCache = new Map();
let sharpModulePromise = null;

function ensurePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ensureNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function loadSharp() {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp')
      .then((module) => module.default || module)
      .catch(() => null);
  }
  return sharpModulePromise;
}

export function resolveRevealSpriteAnalysisLayout(template) {
  const box = template?.layout?.reveal_box || {};
  const width = Math.max(320, Math.round(ensurePositiveNumber(box.width_px, 760)));
  const height = Math.max(320, Math.round(ensurePositiveNumber(box.height_px, 760)));
  const border = Math.max(0, Math.round(Number(box.border_width_px) || 0));
  const innerWidth = Math.max(2, width - (border * 2));
  const innerHeight = Math.max(2, height - (border * 2));
  const maximumMargin = Math.max(0, Math.floor((Math.min(innerWidth, innerHeight) - 2) / 2));
  const visibleMargin = clamp(
    Math.round(ensureNonNegativeNumber(
      box.sprite_visible_margin_px,
      DEFAULT_VISIBLE_MARGIN_PX,
    )),
    0,
    maximumMargin,
  );
  return {
    width: innerWidth,
    height: innerHeight,
    spriteSize: Math.max(240, Math.round(ensurePositiveNumber(box.sprite_size_px, 650))),
    visibleMargin,
    visibleWidth: Math.max(2, innerWidth - (visibleMargin * 2)),
    visibleHeight: Math.max(2, innerHeight - (visibleMargin * 2)),
    cropPadding: Math.max(
      0,
      Math.round(ensureNonNegativeNumber(
        box.sprite_crop_padding_px,
        DEFAULT_CROP_PADDING_PX,
      )),
    ),
  };
}

function createEmptyAnalysis(layout) {
  return {
    ...layout,
    opaquePoints: [],
    spriteCrop: null,
  };
}

export function resolveSpriteFrameHeight(metadata, info) {
  const totalHeight = Number(info?.height || 0);
  const pageHeight = Number(metadata?.pageHeight || info?.pageHeight || 0);
  if (pageHeight > 0) return Math.min(totalHeight || pageHeight, Math.round(pageHeight));

  const metadataHeight = Number(metadata?.height || 0);
  const pages = Math.max(1, Math.round(Number(metadata?.pages || info?.pages || 1)));
  if (metadataHeight > 0) {
    if (pages > 1 && totalHeight > 0 && metadataHeight >= totalHeight) {
      return Math.max(1, Math.round(metadataHeight / pages));
    }
    return Math.min(totalHeight || metadataHeight, Math.round(metadataHeight));
  }
  return totalHeight > 0 ? Math.max(1, Math.round(totalHeight / pages)) : 0;
}

function findVisibleBounds(data, info, frameHeightHint) {
  const sourceWidth = Number(info?.width || 0);
  const totalHeight = Number(info?.height || 0);
  const hintedFrameHeight = Number(frameHeightHint || 0);
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
      if ((data[alphaIndex] || 0) < MIN_VISIBLE_ALPHA) continue;
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

function buildVisibleAnalysis(bounds, layout) {
  const cropX = Math.max(0, bounds.minX - layout.cropPadding);
  const cropY = Math.max(0, bounds.minY - layout.cropPadding);
  const cropRight = Math.min(bounds.sourceWidth - 1, bounds.maxX + layout.cropPadding);
  const cropBottom = Math.min(bounds.sourceHeight - 1, bounds.maxY + layout.cropPadding);
  const cropWidth = cropRight - cropX + 1;
  const cropHeight = cropBottom - cropY + 1;
  const displayScale = Math.min(
    layout.visibleWidth / cropWidth,
    layout.visibleHeight / cropHeight,
  );
  const displayWidth = cropWidth * displayScale;
  const displayHeight = cropHeight * displayScale;
  const offsetX = (layout.width - displayWidth) / 2;
  const offsetY = (layout.height - displayHeight) / 2;
  const sampleStride = Math.max(
    1,
    Math.ceil(Math.sqrt(
      (bounds.sourceWidth * bounds.sourceHeight) / MAX_OPAQUE_ANALYSIS_POINTS,
    )),
  );
  const opaquePoints = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += sampleStride) {
    for (let x = bounds.minX; x <= bounds.maxX; x += sampleStride) {
      if (bounds.visibleMask[(y * bounds.sourceWidth) + x] !== 1) continue;
      opaquePoints.push({
        x: offsetX + ((x - cropX + 0.5) * displayScale),
        y: offsetY + ((y - cropY + 0.5) * displayScale),
      });
    }
  }
  return {
    ...layout,
    opaquePoints,
    spriteCrop: {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
      source_width: bounds.sourceWidth,
      source_height: bounds.sourceHeight,
    },
  };
}

export async function loadOpaqueSpriteAnalysis(spritePath, template) {
  const normalizedPath = String(spritePath || '').trim();
  const layout = resolveRevealSpriteAnalysisLayout(template);
  if (!normalizedPath) return createEmptyAnalysis(layout);
  const cacheKey = [
    normalizedPath,
    layout.width,
    layout.height,
    layout.visibleMargin,
    layout.cropPadding,
  ].join(':');
  if (spriteAnalysisCache.has(cacheKey)) {
    return spriteAnalysisCache.get(cacheKey);
  }

  const analysisPromise = (async () => {
    const sharp = await loadSharp();
    if (!sharp) return createEmptyAnalysis(layout);
    try {
      const image = sharp(normalizedPath, { animated: true, pages: -1 });
      const metadata = await image.metadata();
      const { data, info } = await image
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const frameHeight = resolveSpriteFrameHeight(metadata, info);
      const bounds = findVisibleBounds(data, info, frameHeight);
      return bounds ? buildVisibleAnalysis(bounds, layout) : createEmptyAnalysis(layout);
    } catch {
      return createEmptyAnalysis(layout);
    }
  })();
  spriteAnalysisCache.set(cacheKey, analysisPromise);
  return analysisPromise;
}
