import sharp from 'sharp';

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function distanceSquared(data, offset, color) {
  return ((data[offset] - color.r) ** 2)
    + ((data[offset + 1] - color.g) ** 2)
    + ((data[offset + 2] - color.b) ** 2);
}

function parseHexColor(value) {
  const match = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/iu.exec(String(value || ''));
  if (!match) throw new Error(`Invalid chroma key: ${value}.`);
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
}

function borderOffsets(width, height) {
  const offsets = [];
  for (let x = 0; x < width; x += 1) {
    offsets.push(x * 4, (((height - 1) * width) + x) * 4);
  }
  for (let y = 1; y < height - 1; y += 1) {
    offsets.push((y * width) * 4, ((y * width) + width - 1) * 4);
  }
  return offsets;
}

export async function removeConnectedChromaBackground(inputBuffer, options = {}) {
  const decoded = await sharp(inputBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const rgba = Buffer.from(decoded.data);
  const borders = borderOffsets(width, height);
  const background = {
    r: median(borders.map((offset) => rgba[offset])),
    g: median(borders.map((offset) => rgba[offset + 1])),
    b: median(borders.map((offset) => rgba[offset + 2])),
  };
  const tolerance = Number(options.tolerance ?? 105);
  const threshold = tolerance ** 2;
  const interiorTolerance = Number(options.interiorTolerance ?? Math.min(tolerance, 105));
  const interiorThreshold = interiorTolerance ** 2;
  const chromaKey = parseHexColor(options.chromaKey || '#ff00ff');
  const chromaKeyTolerance = Number(options.chromaKeyTolerance ?? interiorTolerance);
  const chromaKeyThreshold = chromaKeyTolerance ** 2;
  const flatMatches = borders.filter((offset) => distanceSquared(rgba, offset, background) <= threshold).length;
  const flatRatio = flatMatches / Math.max(1, borders.length);
  if (flatRatio < 0.75) {
    throw new Error(`Transparent output requested, but the generated border was not flat enough (${flatRatio.toFixed(3)}).`);
  }

  const visited = new Uint8Array(width * height);
  const queue = [];
  for (const offset of borders) queue.push(offset / 4);
  let cursor = 0;
  let removedConnectedPixels = 0;
  while (cursor < queue.length) {
    const pixel = queue[cursor++];
    if (visited[pixel]) continue;
    visited[pixel] = 1;
    const offset = pixel * 4;
    if (distanceSquared(rgba, offset, background) > threshold) continue;
    rgba[offset] = 0;
    rgba[offset + 1] = 0;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 0;
    removedConnectedPixels += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) queue.push(pixel - 1);
    if (x + 1 < width) queue.push(pixel + 1);
    if (y > 0) queue.push(pixel - width);
    if (y + 1 < height) queue.push(pixel + width);
  }

  // Border flood-fill deliberately uses a broad tolerance so antialiased spill at
  // the subject edge is removed. Enclosed negative spaces cannot be reached by
  // that flood (trigger guards, chair backs, gaps between legs, and similar
  // holes), so clear chroma matches globally with a bounded threshold. This
  // mirrors the production asset processor: colors outside the configured key
  // tolerance remain artwork, while key-colored islands are always background.
  let removedInteriorPixels = 0;
  let removedReservedChromaPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    if (rgba[offset + 3] === 0) continue;
    const matchesInferredBackground = distanceSquared(rgba, offset, background) <= interiorThreshold;
    const matchesReservedChroma = distanceSquared(rgba, offset, chromaKey) <= chromaKeyThreshold;
    if (!matchesInferredBackground && !matchesReservedChroma) continue;
    rgba[offset] = 0;
    rgba[offset + 1] = 0;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 0;
    removedInteriorPixels += 1;
    if (matchesReservedChroma) removedReservedChromaPixels += 1;
  }
  const removedPixels = removedConnectedPixels + removedInteriorPixels;
  if (removedConnectedPixels === 0) throw new Error('Transparent output requested, but no connected background could be removed.');
  return {
    buffer: await sharp(rgba, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer(),
    removedPixels,
    removedConnectedPixels,
    removedInteriorPixels,
    width,
    height,
    background,
    borderMatchRatio: Number(flatRatio.toFixed(4)),
    interiorTolerance,
    chromaKey: options.chromaKey || '#ff00ff',
    chromaKeyTolerance,
    removedReservedChromaPixels,
  };
}
