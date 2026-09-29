const alphaBoundsCache = new Map();
let sharpModulePromise = null;

async function loadSharp() {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp').then((module) => module.default || module);
  }
  return sharpModulePromise;
}

function clampRatio(value) {
  return Number(Math.max(0, Math.min(0.95, Number(value) || 0)).toFixed(6));
}

export function calculateTransparentBottomRatio(data, {
  width,
  height,
  channels,
  pageHeight = height,
  alphaThreshold = 8,
} = {}) {
  const imageWidth = Math.max(0, Number.parseInt(String(width), 10) || 0);
  const stackedHeight = Math.max(0, Number.parseInt(String(height), 10) || 0);
  const channelCount = Math.max(0, Number.parseInt(String(channels), 10) || 0);
  const frameHeight = Math.max(1, Number.parseInt(String(pageHeight), 10) || stackedHeight || 1);
  if (!data || imageWidth === 0 || stackedHeight === 0 || channelCount < 4) return 0;

  let lowestVisibleLocalY = -1;
  const alphaChannel = channelCount - 1;
  for (let y = 0; y < stackedHeight; y += 1) {
    const localY = y % frameHeight;
    if (localY <= lowestVisibleLocalY) continue;
    const rowStart = y * imageWidth * channelCount;
    for (let x = 0; x < imageWidth; x += 1) {
      if (data[rowStart + (x * channelCount) + alphaChannel] > alphaThreshold) {
        lowestVisibleLocalY = localY;
        break;
      }
    }
  }
  if (lowestVisibleLocalY < 0) return 0;
  return clampRatio((frameHeight - lowestVisibleLocalY - 1) / frameHeight);
}

export async function measureTransparentBottomRatio(filePath, options = {}) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) return 0;
  const cacheKey = `${normalizedPath}:${Number(options.alphaThreshold || 8)}`;
  if (alphaBoundsCache.has(cacheKey)) return alphaBoundsCache.get(cacheKey);

  const pending = (async () => {
    try {
      const sharp = await loadSharp();
      const image = sharp(normalizedPath, { animated: true, pages: -1 }).ensureAlpha();
      const metadata = await image.metadata();
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      return calculateTransparentBottomRatio(data, {
        width: info.width,
        height: info.height,
        channels: info.channels,
        pageHeight: metadata.pageHeight || info.pageHeight || info.height,
        alphaThreshold: options.alphaThreshold,
      });
    } catch {
      return 0;
    }
  })();
  alphaBoundsCache.set(cacheKey, pending);
  return pending;
}

export async function buildVisualInputGroundingRatios(visualInputs = [], {
  enabled = false,
  rolePattern = /candidate|sprite/iu,
} = {}) {
  if (!enabled) return new Map();
  const entries = await Promise.all(visualInputs.map(async (input, index) => {
    if (!rolePattern.test(String(input?.role || ''))) return [index, 0];
    return [index, await measureTransparentBottomRatio(input?.path)];
  }));
  return new Map(entries);
}
