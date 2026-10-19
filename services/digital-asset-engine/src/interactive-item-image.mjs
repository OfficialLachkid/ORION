import sharp from 'sharp';

function parseHex(value) {
  const normalized = value.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function colorDistanceSquared(pixel, color) {
  return ((pixel[0] - color[0]) ** 2)
    + ((pixel[1] - color[1]) ** 2)
    + ((pixel[2] - color[2]) ** 2);
}

function summarizeComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let cursor = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let xTotal = 0;
    let yTotal = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      xTotal += x;
      yTotal += y;
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = (nextY * width) + nextX;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    components.push({
      pixels: queue.length,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      centroid: {
        x: Math.round(xTotal / queue.length),
        y: Math.round(yTotal / queue.length),
      },
    });
  }
  return components.sort((left, right) => right.pixels - left.pixels);
}

export async function detectDynamicEnergyRegion(assetBuffer, options) {
  const decoded = await sharp(assetBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = options.colors.map(parseHex);
  const threshold = options.tolerance ** 2;
  const mask = new Uint8Array(decoded.info.width * decoded.info.height);
  let xTotal = 0;
  let yTotal = 0;
  let matchedPixels = 0;
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const pixelIndex = (y * decoded.info.width) + x;
      const offset = pixelIndex * 4;
      if (decoded.data[offset + 3] < (options.alphaThreshold ?? 128)) continue;
      const pixel = [decoded.data[offset], decoded.data[offset + 1], decoded.data[offset + 2]];
      if (!colors.some((color) => colorDistanceSquared(pixel, color) <= threshold)) continue;
      mask[pixelIndex] = 1;
      matchedPixels += 1;
      xTotal += x;
      yTotal += y;
    }
  }
  if (matchedPixels < (options.minimumPixels ?? 4)) {
    throw new Error(`Dynamic energy-region detection found only ${matchedPixels} matching pixels.`);
  }
  const components = summarizeComponents(mask, decoded.info.width, decoded.info.height);
  return {
    mask,
    decoded,
    report: {
      strategy: 'palette_connected_components',
      colors: options.colors,
      tolerance: options.tolerance,
      matched_pixels: matchedPixels,
      centroid: { x: Math.round(xTotal / matchedPixels), y: Math.round(yTotal / matchedPixels) },
      components,
    },
  };
}

export async function detectOpaqueObjectAnchor(assetBuffer, alphaThreshold = 128) {
  const decoded = await sharp(assetBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = decoded.info.width;
  let top = decoded.info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      if (decoded.data[(((y * decoded.info.width) + x) * 4) + 3] < alphaThreshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('Cannot detect an anchor for an empty asset.');
  const bounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  return {
    strategy: 'opaque_bounds_center',
    bounds,
    anchor: {
      x: Math.round(left + ((bounds.width - 1) / 2)),
      y: Math.round(top + ((bounds.height - 1) / 2)),
    },
  };
}

export async function createEnergyPulseFrame(assetBuffer, detection, intensity) {
  const overlay = Buffer.alloc(detection.decoded.data.length);
  for (let pixel = 0; pixel < detection.mask.length; pixel += 1) {
    if (!detection.mask[pixel] || intensity <= 0) continue;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const source = detection.decoded.data[offset + channel];
      overlay[offset + channel] = Math.round(source + ((255 - source) * intensity));
    }
    overlay[offset + 3] = detection.decoded.data[offset + 3];
  }
  const overlayBuffer = await sharp(overlay, {
    raw: { width: detection.decoded.info.width, height: detection.decoded.info.height, channels: 4 },
  }).png({ palette: true, colours: 32, dither: 0, compressionLevel: 9 }).toBuffer();
  const compositeBuffer = intensity <= 0
    ? assetBuffer
    : await sharp(assetBuffer).composite([{ input: overlayBuffer }]).png({ compressionLevel: 9 }).toBuffer();
  return { overlayBuffer, compositeBuffer };
}

export async function inspectPulseIsolation(baseBuffer, compositeBuffer, mask) {
  const [base, composite] = await Promise.all([
    sharp(baseBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(compositeBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (base.info.width !== composite.info.width || base.info.height !== composite.info.height) {
    return { passed: false, changed_pixels: 0, outside_region_changes: 1 };
  }
  let changedPixels = 0;
  let outsideRegionChanges = 0;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    const bothTransparent = base.data[offset + 3] === 0 && composite.data[offset + 3] === 0;
    const changed = !bothTransparent
      && [0, 1, 2, 3].some((channel) => base.data[offset + channel] !== composite.data[offset + channel]);
    if (!changed) continue;
    changedPixels += 1;
    if (!mask[pixel]) outsideRegionChanges += 1;
  }
  return {
    passed: changedPixels > 0 && outsideRegionChanges === 0,
    changed_pixels: changedPixels,
    outside_region_changes: outsideRegionChanges,
  };
}

export async function alignEffectCoreToAnchor(effectBuffer, options) {
  const decoded = await sharp(effectBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const detection = await detectDynamicEnergyRegion(effectBuffer, {
    colors: options.colors,
    tolerance: options.tolerance,
    minimumPixels: options.minimumPixels ?? 2,
    alphaThreshold: 1,
  });
  const detected = detection.report.components[0]?.centroid || detection.report.centroid;
  const translation = {
    x: Math.round(options.target.x - detected.x),
    y: Math.round(options.target.y - detected.y),
  };
  const output = Buffer.alloc(decoded.data.length);
  let opaquePixels = 0;
  let clippedPixels = 0;
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const sourceOffset = ((y * decoded.info.width) + x) * 4;
      if (decoded.data[sourceOffset + 3] === 0) continue;
      opaquePixels += 1;
      const targetX = x + translation.x;
      const targetY = y + translation.y;
      if (targetX < 0 || targetX >= decoded.info.width || targetY < 0 || targetY >= decoded.info.height) {
        clippedPixels += 1;
        continue;
      }
      decoded.data.copy(output, ((targetY * decoded.info.width) + targetX) * 4, sourceOffset, sourceOffset + 4);
    }
  }
  const buffer = await sharp(output, {
    raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 },
  }).png({ palette: true, colours: options.maxPaletteColors, dither: 0, compressionLevel: 9 }).toBuffer();
  const alignedDetection = await detectDynamicEnergyRegion(buffer, {
    colors: options.colors,
    tolerance: options.tolerance,
    minimumPixels: options.minimumPixels ?? 2,
    alphaThreshold: 1,
  });
  const aligned = alignedDetection.report.components[0]?.centroid || alignedDetection.report.centroid;
  const error = Math.hypot(aligned.x - options.target.x, aligned.y - options.target.y);
  return {
    buffer,
    report: {
      strategy: 'primary_energy_component_translation',
      detected_origin: detected,
      expected_origin: options.target,
      aligned_origin: aligned,
      translation,
      alignment_error_pixels: Number(error.toFixed(3)),
      opaque_pixels: opaquePixels,
      clipped_pixels: clippedPixels,
      passed: error <= (options.maximumError ?? 1) && clippedPixels === 0,
    },
  };
}
