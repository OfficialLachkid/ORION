import {
  expandVisibleSpriteBounds,
  findVisibleSpriteBounds,
} from '../../shared/render/sprite-visible-bounds.mjs';

const DEFAULT_VISIBLE_MARGIN_PX = 24;
const DEFAULT_CROP_PADDING_PX = 4;
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

function buildVisibleAnalysis(bounds, layout) {
  const crop = expandVisibleSpriteBounds(bounds, layout.cropPadding);
  const cropX = crop.x;
  const cropY = crop.y;
  const cropWidth = crop.width;
  const cropHeight = crop.height;
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
    spriteCrop: crop,
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
      const bounds = findVisibleSpriteBounds(data, info, { frameHeight });
      return bounds ? buildVisibleAnalysis(bounds, layout) : createEmptyAnalysis(layout);
    } catch {
      return createEmptyAnalysis(layout);
    }
  })();
  spriteAnalysisCache.set(cacheKey, analysisPromise);
  return analysisPromise;
}
