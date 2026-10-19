import sharp from 'sharp';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function transparentFrame(canvas) {
  return sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
}

export async function compositeItemFrame(baseBuffer, overlays = [], options = {}) {
  const inputs = overlays.map((input) => ({ input }));
  if (options.baseOnTop) inputs.push({ input: baseBuffer });
  return sharp(options.baseOnTop ? await transparentFrame(options.canvas) : baseBuffer)
    .composite(inputs)
    .png({
      palette: true,
      colours: options.maxPaletteColors ?? 32,
      dither: 0,
      compressionLevel: 9,
    })
    .toBuffer();
}

export async function createEnergyLevelFrame(baseBuffer, detection, level) {
  const output = Buffer.from(detection.decoded.data);
  const overlay = Buffer.alloc(output.length);
  for (let pixel = 0; pixel < detection.mask.length; pixel += 1) {
    if (!detection.mask[pixel]) continue;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const source = detection.decoded.data[offset + channel];
      const target = level >= 0
        ? source + ((255 - source) * level)
        : source * (1 + level);
      output[offset + channel] = Math.max(0, Math.min(255, Math.round(target)));
      overlay[offset + channel] = output[offset + channel];
    }
    output[offset + 3] = detection.decoded.data[offset + 3];
    overlay[offset + 3] = detection.decoded.data[offset + 3];
  }
  const raw = { width: detection.decoded.info.width, height: detection.decoded.info.height, channels: 4 };
  return {
    compositeBuffer: level === 0
      ? baseBuffer
      : await sharp(output, { raw }).png({ palette: true, colours: 32, dither: 0 }).toBuffer(),
    overlayBuffer: await sharp(overlay, { raw }).png({ palette: true, colours: 32, dither: 0 }).toBuffer(),
  };
}

function integrityCellScore(cellX, cellY, columns, rows, seed) {
  const normalizedX = columns <= 1 ? 0 : cellX / (columns - 1);
  const normalizedY = rows <= 1 ? 0 : cellY / (rows - 1);
  const spatial = ((1 - normalizedX) * 0.55) + (normalizedY * 0.45);
  const mixed = Math.sin(((cellX + 1) * 12.9898) + ((cellY + 1) * 78.233) + (seed * 0.017));
  const noise = mixed - Math.floor(mixed);
  return spatial + (noise * 0.22);
}

export async function createShieldIntegrityFrame(baseBuffer, integrityPercent, options = {}) {
  const integrity = Math.max(0, Math.min(100, Math.round(integrityPercent)));
  if (integrity === 100) return baseBuffer;
  const decoded = await sharp(baseBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const cellSize = Math.max(4, options.cellSize ?? 8);
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const occupied = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      if (decoded.data[offset + 3] === 0) continue;
      occupied.add(`${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`);
    }
  }
  const cells = [...occupied].map((key) => {
    const [cellX, cellY] = key.split(':').map(Number);
    return {
      key,
      score: integrityCellScore(cellX, cellY, columns, rows, options.seed ?? 0),
    };
  }).sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
  const keepCount = Math.ceil(cells.length * (integrity / 100));
  const retained = new Set(cells.slice(0, keepCount).map((cell) => cell.key));
  const output = Buffer.from(decoded.data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
      if (retained.has(key)) continue;
      output[((y * width) + x) * 4 + 3] = 0;
    }
  }
  return sharp(output, { raw: { width, height, channels: 4 } })
    .png({
      palette: true,
      colours: options.maxPaletteColors ?? 32,
      dither: 0,
      compressionLevel: 9,
    })
    .toBuffer();
}

export async function buildStateContactSheet(states, canvas) {
  const cellWidth = Math.max(180, canvas.width + 48);
  const cellHeight = canvas.height + 76;
  const columns = Math.min(4, states.length);
  const rows = Math.ceil(states.length / columns);
  const width = cellWidth * columns;
  const height = cellHeight * rows;
  const cards = [];
  const images = [];
  for (let index = 0; index < states.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    cards.push(
      `<rect x="${left + 8}" y="${top + 8}" width="${cellWidth - 16}" height="${cellHeight - 16}" rx="12" fill="#111827" stroke="#30405e"/>`,
      `<text x="${left + (cellWidth / 2)}" y="${top + cellHeight - 25}" text-anchor="middle" fill="#e6eefc" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(states[index].name)}</text>`,
    );
    images.push({
      input: states[index].buffer,
      left: left + Math.floor((cellWidth - canvas.width) / 2),
      top: top + 18,
    });
  }
  const background = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0c1019"/>${cards.join('')}</svg>`);
  return sharp({ create: { width, height, channels: 3, background: '#0c1019' } })
    .composite([{ input: background }, ...images])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
