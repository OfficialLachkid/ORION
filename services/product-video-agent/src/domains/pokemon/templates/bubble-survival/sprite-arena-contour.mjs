import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const TWO_PI = Math.PI * 2;

function circularValue(values, index) {
  return values[(index + values.length) % values.length];
}

function fillMissingRadii(radii) {
  const populated = radii.filter((value) => value > 0);
  if (populated.length === 0) return [];
  return radii.map((radius, index) => {
    if (radius > 0) return radius;
    for (let offset = 1; offset < radii.length; offset += 1) {
      const previous = circularValue(radii, index - offset);
      const next = circularValue(radii, index + offset);
      if (previous > 0 && next > 0) return (previous + next) / 2;
      if (previous > 0) return previous;
      if (next > 0) return next;
    }
    return populated[0];
  });
}

function smoothRadii(radii, radius = 2) {
  return radii.map((_value, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const weight = radius + 1 - Math.abs(offset);
      total += circularValue(radii, index + offset) * weight;
      weightTotal += weight;
    }
    return total / weightTotal;
  });
}

export async function buildPokemonSpriteArenaContour(spritePath, {
  pointCount = 96,
  alphaThreshold = 24,
  minimumRadiusRatio = 0.56,
} = {}) {
  const source = await readFile(spritePath);
  const decoded = await sharp(source, { animated: false })
    .ensureAlpha()
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  const visible = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = decoded.data[((y * width) + x) * channels + 3];
      if (alpha >= alphaThreshold) visible.push({ x, y });
    }
  }
  if (visible.length < 32) {
    throw new Error(`Pokemon silhouette source has only ${visible.length} visible pixels.`);
  }
  const minimumX = Math.min(...visible.map((point) => point.x));
  const maximumX = Math.max(...visible.map((point) => point.x));
  const minimumY = Math.min(...visible.map((point) => point.y));
  const maximumY = Math.max(...visible.map((point) => point.y));
  const centerX = (minimumX + maximumX) / 2;
  const centerY = (minimumY + maximumY) / 2;
  const bins = Array.from({ length: Math.max(24, Math.round(pointCount)) }, () => 0);
  for (const point of visible) {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const angle = Math.atan2(dy, dx);
    const normalizedAngle = (angle + TWO_PI) % TWO_PI;
    const index = Math.min(bins.length - 1, Math.floor((normalizedAngle / TWO_PI) * bins.length));
    bins[index] = Math.max(bins[index], Math.hypot(dx, dy));
  }
  const smoothed = smoothRadii(fillMissingRadii(bins));
  const maximumRadius = Math.max(...smoothed);
  if (!(maximumRadius > 0)) throw new Error('Pokemon silhouette contour has no measurable radius.');
  const radiusFloor = Math.min(0.8, Math.max(0.35, Number(minimumRadiusRatio) || 0.56));
  const points = smoothed.map((radius, index) => {
    const angle = (index / smoothed.length) * TWO_PI;
    const sourceRatio = radius / maximumRadius;
    const safeRatio = radiusFloor + ((1 - radiusFloor) * sourceRatio);
    return {
      x: Number((Math.cos(angle) * safeRatio).toFixed(6)),
      y: Number((Math.sin(angle) * safeRatio).toFixed(6)),
    };
  });
  return {
    points,
    visible_pixel_count: visible.length,
    source_bounds: {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
    },
  };
}
