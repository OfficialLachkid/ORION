import sharp from 'sharp';

export const PIXEL_ART_PROCESSING_VERSION = '2.0';
export const PIXEL_ART_EFFECT_PROCESSING_VERSION = '1.0';

function parseHexColor(value) {
  const normalized = value.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function colorDistanceSquared(r, g, b, key) {
  return ((r - key.r) ** 2) + ((g - key.g) ** 2) + ((b - key.b) ** 2);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function colorToHex(color) {
  return `#${[color.r, color.g, color.b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function detectBorderChroma(data, width, height, expectedKey, tolerance) {
  const samples = [];
  function sample(x, y) {
    const offset = ((y * width) + x) * 4;
    samples.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
  }
  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(0, y);
    sample(width - 1, y);
  }
  const detected = {
    r: median(samples.map((item) => item.r)),
    g: median(samples.map((item) => item.g)),
    b: median(samples.map((item) => item.b)),
  };
  const threshold = tolerance ** 2;
  const matched = samples.filter((item) => (
    colorDistanceSquared(item.r, item.g, item.b, detected) <= threshold
  )).length;
  const matchRatio = matched / samples.length;
  const expectedDistance = Math.sqrt(colorDistanceSquared(
    detected.r,
    detected.g,
    detected.b,
    expectedKey,
  ));
  if (matchRatio < 0.9) {
    throw new Error(`Generated image border is not a sufficiently flat chroma background (${matchRatio.toFixed(3)} match ratio).`);
  }
  if (expectedDistance > Math.max(180, tolerance * 2)) {
    throw new Error(`Generated image border ${colorToHex(detected)} does not resemble requested chroma ${colorToHex(expectedKey)}.`);
  }
  return { color: detected, hex: colorToHex(detected), matchRatio, expectedDistance };
}

function removeChroma(data, width, height, key, tolerance) {
  const threshold = tolerance ** 2;
  let removedPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    if (data[offset + 3] === 0) continue;
    if (colorDistanceSquared(data[offset], data[offset + 1], data[offset + 2], key) <= threshold) {
      data[offset + 3] = 0;
      removedPixels += 1;
    }
  }
  return removedPixels;
}

function findOpaqueBounds(data, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[((y * width) + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('Chroma removal produced an empty asset.');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export async function processPixelArtAsset(inputBuffer, options) {
  const decoded = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const rgba = Buffer.from(decoded.data);
  const expectedKey = parseHexColor(options.chromaKey);
  const detected = detectBorderChroma(
    rgba,
    width,
    height,
    expectedKey,
    options.chromaTolerance,
  );
  const removedChromaPixels = removeChroma(
    rgba,
    width,
    height,
    detected.color,
    options.chromaTolerance,
  );
  const bounds = findOpaqueBounds(rgba, width, height);

  const output = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract(bounds)
    .resize(options.width, options.height, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({
      palette: true,
      colours: options.maxPaletteColors,
      dither: 0,
      compressionLevel: 9,
    })
    .toBuffer();

  return {
    buffer: output,
    processing_version: PIXEL_ART_PROCESSING_VERSION,
    source: { width, height },
    extracted_bounds: bounds,
    removed_chroma_pixels: removedChromaPixels,
    detected_chroma_key: detected.hex,
    border_chroma_match_ratio: Number(detected.matchRatio.toFixed(4)),
    requested_chroma_distance: Number(detected.expectedDistance.toFixed(2)),
  };
}

function placedCoordinates(placement, canvas, image) {
  const top = Math.round((canvas.height - image.height) / 2);
  if (placement === 'west_center') return { left: canvas.padding, top };
  return {
    left: Math.round((canvas.width - image.width) / 2),
    top,
  };
}

export async function processPixelArtEffectFrame(inputBuffer, options) {
  const decoded = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const rgba = Buffer.from(decoded.data);
  const expectedKey = parseHexColor(options.chromaKey);
  const detected = detectBorderChroma(
    rgba,
    width,
    height,
    expectedKey,
    options.chromaTolerance,
  );
  const removedChromaPixels = removeChroma(
    rgba,
    width,
    height,
    detected.color,
    options.chromaTolerance,
  );
  const extractedBounds = findOpaqueBounds(rgba, width, height);
  const availableWidth = options.width - (options.padding * 2);
  const availableHeight = options.height - (options.padding * 2);
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error('Effect frame padding leaves no drawable canvas area.');
  }
  const resized = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract(extractedBounds)
    .resize(availableWidth, availableHeight, {
      fit: 'inside',
      kernel: sharp.kernel.nearest,
      withoutEnlargement: false,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const position = placedCoordinates(options.placement, {
    width: options.width,
    height: options.height,
    padding: options.padding,
  }, resized.info);
  let output = await sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized.data, ...position }])
    .png({
      palette: true,
      colours: options.maxPaletteColors,
      dither: 0,
      compressionLevel: 9,
    })
    .toBuffer();
  let anchorCorrection = null;
  if (options.origin && Number.isFinite(options.maximumOriginGap)) {
    const contact = await inspectAnchorContact(output, options.origin, 0);
    if (contact.nearest_opaque_distance > 0
      && contact.nearest_opaque_distance <= options.maximumOriginGap) {
      const decodedOutput = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const nearest = findNearestOpaquePixel(decodedOutput.data, decodedOutput.info, options.origin);
      drawPixelLine(decodedOutput.data, decodedOutput.info, options.origin, nearest);
      output = await sharp(decodedOutput.data, {
        raw: {
          width: decodedOutput.info.width,
          height: decodedOutput.info.height,
          channels: 4,
        },
      }).png({
        palette: true,
        colours: options.maxPaletteColors,
        dither: 0,
        compressionLevel: 9,
      }).toBuffer();
      anchorCorrection = {
        applied: true,
        distance: contact.nearest_opaque_distance,
        from: options.origin,
        to: { x: nearest.x, y: nearest.y },
      };
    }
  }

  return {
    buffer: output,
    processing_version: PIXEL_ART_PROCESSING_VERSION,
    effect_processing_version: PIXEL_ART_EFFECT_PROCESSING_VERSION,
    source: { width, height },
    extracted_bounds: extractedBounds,
    placed_bounds: {
      left: position.left,
      top: position.top,
      width: resized.info.width,
      height: resized.info.height,
    },
    removed_chroma_pixels: removedChromaPixels,
    detected_chroma_key: detected.hex,
    border_chroma_match_ratio: Number(detected.matchRatio.toFixed(4)),
    requested_chroma_distance: Number(detected.expectedDistance.toFixed(2)),
    anchor_correction: anchorCorrection,
  };
}

function findNearestOpaquePixel(data, info, origin) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = ((y * info.width) + x) * 4;
      if (data[offset + 3] === 0) continue;
      const distance = Math.hypot(x - origin.x, y - origin.y);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      nearest = {
        x,
        y,
        color: [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]],
      };
    }
  }
  return nearest;
}

function drawPixelLine(data, info, from, to) {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    const offset = ((y * info.width) + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) data[offset + channel] = to.color[channel];
    if (x === to.x && y === to.y) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

export async function inspectAnchorContact(assetBuffer, origin, tolerance) {
  const decoded = await sharp(assetBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const nearest = findNearestOpaquePixel(decoded.data, decoded.info, origin);
  const nearestDistance = Math.hypot(
    nearest.x - origin.x,
    nearest.y - origin.y,
  );
  return {
    passed: nearestDistance <= tolerance,
    nearest_opaque_distance: Number(nearestDistance.toFixed(2)),
    tolerance,
  };
}

export async function createTransparencyPreview(assetBuffer, options = {}) {
  const tileSize = options.tileSize || 8;
  const metadata = await sharp(assetBuffer).metadata();
  const width = metadata.width;
  const height = metadata.height;
  const svg = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    '<defs><pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">',
    '<rect width="16" height="16" fill="#d8d8d8"/>',
    `<rect width="${tileSize}" height="${tileSize}" fill="#f5f5f5"/>`,
    `<rect x="${tileSize}" y="${tileSize}" width="${tileSize}" height="${tileSize}" fill="#f5f5f5"/>`,
    '</pattern></defs><rect width="100%" height="100%" fill="url(#checker)"/></svg>',
  ].join(''));
  return sharp(svg).composite([{ input: assetBuffer }]).png().toBuffer();
}
