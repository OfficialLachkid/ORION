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

function seededUnit(seed, index) {
  const mixed = Math.sin(((index + 1) * 12.9898) + (seed * 0.017)) * 43_758.5453;
  return mixed - Math.floor(mixed);
}

function opaqueBounds(data, width, height) {
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
  return { left, top, right, bottom };
}

export async function clearDenseShieldInterior(baseBuffer, options = {}) {
  const decoded = await sharp(baseBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const output = Buffer.from(decoded.data);
  const bounds = opaqueBounds(output, width, height);
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const shieldRadius = Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) / 2;
  const clearRadius = shieldRadius * (options.clearRadiusRatio ?? 0.24);
  const sampleRadius = options.sampleRadius ?? 2;
  const densityThreshold = options.densityThreshold ?? 0.68;
  let clearedPixels = 0;
  for (let y = Math.max(0, Math.floor(centerY - clearRadius)); y <= Math.min(height - 1, Math.ceil(centerY + clearRadius)); y += 1) {
    for (let x = Math.max(0, Math.floor(centerX - clearRadius)); x <= Math.min(width - 1, Math.ceil(centerX + clearRadius)); x += 1) {
      if (Math.hypot(x - centerX, y - centerY) > clearRadius) continue;
      const offset = ((y * width) + x) * 4;
      if (output[offset + 3] === 0) continue;
      let opaque = 0;
      let sampled = 0;
      for (let sampleY = Math.max(0, y - sampleRadius); sampleY <= Math.min(height - 1, y + sampleRadius); sampleY += 1) {
        for (let sampleX = Math.max(0, x - sampleRadius); sampleX <= Math.min(width - 1, x + sampleRadius); sampleX += 1) {
          sampled += 1;
          if (decoded.data[((sampleY * width) + sampleX) * 4 + 3] > 0) opaque += 1;
        }
      }
      if ((opaque / sampled) < densityThreshold) continue;
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 0;
      clearedPixels += 1;
    }
  }
  const minimumCorrectionPixels = options.minimumCorrectionPixels
    ?? Math.max(32, Math.floor(width * height * 0.002));
  if (clearedPixels < minimumCorrectionPixels) return baseBuffer;
  return sharp(output, { raw: { width, height, channels: 4 } })
    .png({ palette: false, compressionLevel: 9 })
    .toBuffer();
}

function crackSegments(bounds, seed) {
  const center = {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  };
  const radius = Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) / 2;
  const sites = 8;
  const paths = [];
  for (let site = 0; site < sites; site += 1) {
    const angle = ((Math.PI * 2 * site) / sites) + (seededUnit(seed, site) * 0.28);
    let point = {
      x: center.x + (Math.cos(angle) * radius * 0.76),
      y: center.y + (Math.sin(angle) * radius * 0.76),
    };
    const segments = [];
    for (let depth = 0; depth < 5; depth += 1) {
      const inward = angle + Math.PI + ((seededUnit(seed + site, depth + 20) - 0.5) * 0.75);
      const length = radius * (0.075 + (seededUnit(seed + depth, site + 40) * 0.045));
      const next = {
        x: point.x + (Math.cos(inward) * length),
        y: point.y + (Math.sin(inward) * length),
      };
      segments.push({ from: point, to: next, site, depth, branch: false });
      if (depth >= 1) {
        const branchAngle = inward + (site % 2 === 0 ? 0.85 : -0.85);
        const branchLength = length * (0.55 + (seededUnit(seed + 90, (site * 5) + depth) * 0.35));
        segments.push({
          from: next,
          to: {
            x: next.x + (Math.cos(branchAngle) * branchLength),
            y: next.y + (Math.sin(branchAngle) * branchLength),
          },
          site,
          depth,
          branch: true,
        });
      }
      point = next;
    }
    paths.push(segments);
  }
  const ordered = [];
  const maximumDepth = Math.max(...paths.map((path) => path.length));
  for (let depth = 0; depth < maximumDepth; depth += 1) {
    for (let site = 0; site < paths.length; site += 1) {
      if (paths[site][depth]) ordered.push(paths[site][depth]);
    }
  }
  return { center, radius, segments: ordered };
}

function drawCrackLine(data, width, height, segment, center, radius, color, missingMask) {
  let x = Math.round(segment.from.x);
  let y = Math.round(segment.from.y);
  const endX = Math.round(segment.to.x);
  const endY = Math.round(segment.to.y);
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    const pixel = (y * width) + x;
    if (x >= 0 && x < width && y >= 0 && y < height
      && !missingMask[pixel]
      && Math.hypot(x - center.x, y - center.y) <= radius * 0.9) {
      const offset = ((y * width) + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
    if (x === endX && y === endY) break;
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

function angularDistance(left, right) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

function createDistributedBreakMask(width, height, fractures, damage, seed) {
  const mask = new Uint8Array(width * height);
  const siteOrder = [0, 4, 2, 6, 1, 5, 3, 7];
  const siteAngles = siteOrder.map((site) => {
    const segment = fractures.segments.find((candidate) => candidate.site === site);
    return Math.atan2(
      segment.from.y - fractures.center.y,
      segment.from.x - fractures.center.x,
    );
  });
  for (let rank = 0; rank < siteAngles.length; rank += 1) {
    const activationThreshold = 0.12 + (rank * 0.085);
    const progress = Math.max(0, Math.min(1, (damage - activationThreshold) / 0.5));
    if (progress === 0) continue;
    const halfWidth = 0.025 + (progress * 0.2);
    const innerRadius = fractures.radius * (0.94 - (progress * 0.62));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x - fractures.center.x;
        const dy = y - fractures.center.y;
        const radius = Math.hypot(dx, dy);
        if (radius < innerRadius || radius > fractures.radius * 1.04) continue;
        const angle = Math.atan2(dy, dx);
        const irregularity = Math.sin((angle * 9) + (seed * 0.01) + rank) * fractures.radius * 0.025;
        if (radius < innerRadius + irregularity) continue;
        const radialProgress = (radius - innerRadius) / Math.max(1, fractures.radius - innerRadius);
        const edgeNoise = Math.sin((radialProgress * 19) + (rank * 2.3) + (seed * 0.003));
        const localCenter = siteAngles[rank] + (edgeNoise * 0.035 * progress);
        const localWidth = halfWidth
          * (0.72 + (radialProgress * 0.38))
          * (0.88 + (Math.sin((radialProgress * 31) + rank) * 0.12));
        if (angularDistance(angle, localCenter) <= localWidth) mask[(y * width) + x] = 1;
      }
    }
  }
  return mask;
}

export async function createShieldIntegrityFrame(baseBuffer, integrityPercent, options = {}) {
  const integrity = Math.max(0, Math.min(100, Math.round(integrityPercent)));
  if (integrity === 100) return baseBuffer;
  const decoded = await sharp(baseBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const output = Buffer.from(decoded.data);
  const fractures = crackSegments(opaqueBounds(decoded.data, width, height), options.seed ?? 0);
  const damage = (100 - integrity) / 100;
  const missingMask = createDistributedBreakMask(width, height, fractures, damage, options.seed ?? 0);
  for (let pixel = 0; pixel < missingMask.length; pixel += 1) {
    if (!missingMask[pixel]) continue;
    const offset = pixel * 4;
    output[offset] = 0;
    output[offset + 1] = 0;
    output[offset + 2] = 0;
    output[offset + 3] = 0;
  }
  const visibleSegments = Math.max(1, Math.ceil(fractures.segments.length * damage));
  for (let index = 0; index < visibleSegments; index += 1) {
    const segment = fractures.segments[index];
    const color = segment.branch ? [53, 217, 255, 230] : [200, 212, 236, 255];
    drawCrackLine(output, width, height, segment, fractures.center, fractures.radius, color, missingMask);
  }
  return sharp(output, { raw: { width, height, channels: 4 } })
    .png({
      palette: false,
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
