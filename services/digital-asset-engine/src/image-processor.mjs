import sharp from 'sharp';

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

function removeConnectedChroma(data, width, height, key, tolerance) {
  const matched = new Uint8Array(width * height);
  const queued = new Uint8Array(width * height);
  const queue = [];
  const threshold = tolerance ** 2;

  function enqueue(x, y) {
    const pixel = (y * width) + x;
    if (queued[pixel]) return;
    const offset = pixel * 4;
    if (colorDistanceSquared(data[offset], data[offset + 1], data[offset + 2], key) > threshold) return;
    queued[pixel] = 1;
    queue.push(pixel);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor];
    matched[pixel] = 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }

  for (let pixel = 0; pixel < matched.length; pixel += 1) {
    if (matched[pixel]) data[(pixel * 4) + 3] = 0;
  }
  return matched;
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
  removeConnectedChroma(rgba, width, height, detected.color, options.chromaTolerance);
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
    source: { width, height },
    extracted_bounds: bounds,
    detected_chroma_key: detected.hex,
    border_chroma_match_ratio: Number(detected.matchRatio.toFixed(4)),
    requested_chroma_distance: Number(detected.expectedDistance.toFixed(2)),
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
