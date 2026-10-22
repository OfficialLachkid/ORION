import sharp from 'sharp';

async function encode(data, info, maxPaletteColors = 32) {
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png({ palette: true, colours: maxPaletteColors, dither: 0, compressionLevel: 9 }).toBuffer();
}

function insideBounds(x, y, bounds, padding = 0) {
  return x >= bounds.x - padding
    && x < bounds.x + bounds.width + padding
    && y >= bounds.y - padding
    && y < bounds.y + bounds.height + padding;
}

function primaryComponent(detection) {
  return detection.report.components[0] || {
    bounds: {
      x: detection.report.centroid.x,
      y: detection.report.centroid.y,
      width: 1,
      height: 1,
    },
    centroid: detection.report.centroid,
    pixels: detection.report.matched_pixels,
  };
}

export async function createExtinguishedCandleFrame(assetBuffer, detection, options = {}) {
  const flame = primaryComponent(detection);
  const output = Buffer.from(detection.decoded.data);
  const overlay = Buffer.alloc(output.length);
  const bottom = flame.bounds.y + flame.bounds.height - 1;
  let residualWarmPixelsRemoved = 0;
  const clearBottom = Math.min(detection.decoded.info.height - 1, bottom + 5);
  for (let y = Math.max(0, flame.bounds.y - 1); y <= clearBottom; y += 1) {
    for (let x = Math.max(0, flame.bounds.x - 1); x < Math.min(detection.decoded.info.width, flame.bounds.x + flame.bounds.width + 1); x += 1) {
      const pixel = (y * detection.decoded.info.width) + x;
      const offset = pixel * 4;
      if (output[offset + 3] === 0) continue;
      const [red, green, blue] = output.subarray(offset, offset + 3);
      const insideDetectedFlame = y <= bottom;
      const looksLikeResidualFlame = red >= 70
        && red > green * 1.08
        && red > blue * 1.28;
      if (!insideDetectedFlame && !looksLikeResidualFlame) continue;
      if (!insideDetectedFlame) residualWarmPixelsRemoved += 1;
      output.fill(0, offset, offset + 4);
    }
  }
  return {
    compositeBuffer: await encode(output, detection.decoded.info, options.maxPaletteColors),
    overlayBuffer: await encode(overlay, detection.decoded.info, options.maxPaletteColors),
    wick: {
      x: Math.round(flame.bounds.x + ((flame.bounds.width - 1) / 2)),
      y: Math.min(detection.decoded.info.height - 1, bottom + 1),
    },
    report: {
      strategy: 'energy_component_and_connected_warm_residual_clear',
      flame_component: flame,
      residual_warm_pixels_removed: residualWarmPixelsRemoved,
    },
  };
}

export async function createFacetedCrystalTurnFrame(assetBuffer, phase, options = {}) {
  const decoded = await sharp(assetBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const opaque = [];
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const offset = ((y * decoded.info.width) + x) * 4;
      if (decoded.data[offset + 3] > 0) opaque.push({ x, y });
    }
  }
  if (!opaque.length) return encode(decoded.data, decoded.info, options.maxPaletteColors);
  const minX = Math.min(...opaque.map((pixel) => pixel.x));
  const maxX = Math.max(...opaque.map((pixel) => pixel.x));
  const minY = Math.min(...opaque.map((pixel) => pixel.y));
  const maxY = Math.max(...opaque.map((pixel) => pixel.y));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const facing = Math.cos(phase);
  const widthScale = 0.56 + (Math.abs(facing) * 0.44);
  const targetWidth = Math.max(2, Math.round(width * widthScale));
  const left = Math.round(((minX + maxX) / 2) - ((targetWidth - 1) / 2));
  const output = Buffer.alloc(decoded.data.length);
  for (let y = minY; y <= maxY; y += 1) {
    for (let targetOffsetX = 0; targetOffsetX < targetWidth; targetOffsetX += 1) {
      const normalized = targetWidth === 1 ? 0.5 : targetOffsetX / (targetWidth - 1);
      const sourceNormalized = facing < 0 ? 1 - normalized : normalized;
      const sourceX = minX + Math.min(width - 1, Math.round(sourceNormalized * (width - 1)));
      const normalizedY = (y - minY) / Math.max(1, height - 1);
      const shear = Math.round(Math.sin(phase) * (0.5 - normalizedY) * 4);
      const targetX = left + targetOffsetX + shear;
      if (targetX < 0 || targetX >= decoded.info.width) continue;
      const sourceOffset = ((y * decoded.info.width) + sourceX) * 4;
      const targetOffset = ((y * decoded.info.width) + targetX) * 4;
      decoded.data.copy(output, targetOffset, sourceOffset, sourceOffset + 4);
      const highlightCenter = 0.5 + (Math.sin(phase) * 0.28);
      const highlight = Math.max(0, 1 - (Math.abs(normalized - highlightCenter) / 0.2));
      if (highlight > 0 && output[targetOffset + 3] > 0) {
        const highlightColor = [185, 255, 241];
        for (let channel = 0; channel < 3; channel += 1) {
          output[targetOffset + channel] = Math.round(
            output[targetOffset + channel]
              + ((highlightColor[channel] - output[targetOffset + channel]) * highlight * 0.42),
          );
        }
      }
    }
  }
  return encode(output, decoded.info, options.maxPaletteColors);
}

export async function createFlameDanceFrame(assetBuffer, detection, phase, options = {}) {
  const flame = primaryComponent(detection);
  const output = Buffer.from(detection.decoded.data);
  const overlay = Buffer.alloc(output.length);
  const bottom = flame.bounds.y + flame.bounds.height - 1;
  const amplitude = options.amplitude ?? 3;
  const stretch = 1 + (Math.sin(phase + 0.6) * 0.09);
  for (let y = Math.max(0, flame.bounds.y - 1); y <= Math.min(detection.decoded.info.height - 1, bottom); y += 1) {
    for (let x = Math.max(0, flame.bounds.x - 1); x < Math.min(detection.decoded.info.width, flame.bounds.x + flame.bounds.width + 1); x += 1) {
      const offset = ((y * detection.decoded.info.width) + x) * 4;
      if (output[offset + 3] > 0) output.fill(0, offset, offset + 4);
    }
  }
  for (let y = flame.bounds.y; y <= bottom; y += 1) {
    const distanceFromWick = bottom - y;
    const normalizedHeight = distanceFromWick / Math.max(1, flame.bounds.height - 1);
    for (let x = flame.bounds.x; x < flame.bounds.x + flame.bounds.width; x += 1) {
      const sourceOffset = ((y * detection.decoded.info.width) + x) * 4;
      if (detection.decoded.data[sourceOffset + 3] === 0) continue;
      const sway = Math.round(
        Math.sin(phase + (normalizedHeight * 1.7)) * amplitude * normalizedHeight,
      );
      const targetX = x + sway;
      const targetY = bottom - Math.round(distanceFromWick * stretch);
      if (targetX < 0 || targetX >= detection.decoded.info.width || targetY < 0 || targetY >= detection.decoded.info.height) continue;
      const targetOffset = ((targetY * detection.decoded.info.width) + targetX) * 4;
      detection.decoded.data.copy(output, targetOffset, sourceOffset, sourceOffset + 4);
      detection.decoded.data.copy(overlay, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return {
    compositeBuffer: await encode(output, detection.decoded.info, options.maxPaletteColors),
    overlayBuffer: await encode(overlay, detection.decoded.info, options.maxPaletteColors),
    report: { strategy: 'wick_anchored_flame_sway_and_stretch', phase, amplitude, stretch },
  };
}

export async function orientSmokeAboveWick(effectBuffer, wick, options = {}) {
  const decoded = await sharp(effectBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let above = 0;
  let below = 0;
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const offset = ((y * decoded.info.width) + x) * 4;
      if (decoded.data[offset + 3] === 0) continue;
      if (y <= wick.y) above += 1;
      else below += 1;
    }
  }
  const flipVertically = below > above;
  const output = Buffer.alloc(decoded.data.length);
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const sourceOffset = ((y * decoded.info.width) + x) * 4;
      if (decoded.data[sourceOffset + 3] === 0) continue;
      const targetY = flipVertically ? wick.y - Math.abs(y - wick.y) : y;
      if (targetY < 0 || targetY > wick.y) continue;
      const targetOffset = ((targetY * decoded.info.width) + x) * 4;
      decoded.data.copy(output, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return {
    buffer: await encode(output, decoded.info, options.maxPaletteColors),
    report: { strategy: 'wick_anchored_upward_smoke', flipped_vertically: flipVertically, above_pixels: above, below_pixels: below },
  };
}

export async function createArcaneAuraFrame(baseBuffer, detection, intensity, phase, options = {}) {
  const output = Buffer.from(detection.decoded.data);
  const overlay = Buffer.alloc(output.length);
  const center = primaryComponent(detection).centroid;
  if (intensity <= 0) {
    return {
      compositeBuffer: await encode(output, detection.decoded.info, options.maxPaletteColors),
      overlayBuffer: await encode(overlay, detection.decoded.info, options.maxPaletteColors),
      report: { strategy: 'broken_arcane_aura_ring', intensity, phase, center },
    };
  }
  const radiusX = Math.max(10, Math.round((options.radiusX ?? 18) * intensity));
  const radiusY = Math.max(8, Math.round((options.radiusY ?? 14) * intensity));
  const colors = [[68, 198, 191, 255], [185, 255, 241, 255], [180, 129, 209, 255]];
  const points = Math.max(8, Math.round(18 * intensity));
  for (let index = 0; index < points; index += 1) {
    if ((index + phase) % 4 === 3) continue;
    const angle = ((Math.PI * 2 * index) / points) + (phase * 0.32);
    const x = Math.round(center.x + (Math.cos(angle) * radiusX));
    const y = Math.round(center.y + (Math.sin(angle) * radiusY));
    if (x < 0 || y < 0 || x >= detection.decoded.info.width || y >= detection.decoded.info.height) continue;
    const color = colors[index % colors.length];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
      const targetX = x + dx;
      const targetY = y + dy;
      if (targetX >= detection.decoded.info.width || targetY >= detection.decoded.info.height) continue;
      const targetOffset = ((targetY * detection.decoded.info.width) + targetX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[targetOffset + channel] = color[channel];
        overlay[targetOffset + channel] = color[channel];
      }
    }
  }
  return {
    compositeBuffer: await encode(output, detection.decoded.info, options.maxPaletteColors),
    overlayBuffer: await encode(overlay, detection.decoded.info, options.maxPaletteColors),
    report: { strategy: 'broken_arcane_aura_ring', intensity, phase, center },
  };
}

export async function createRestorativeReleaseFrame(assetBuffer, detection, progress, options = {}) {
  const decoded = await sharp(assetBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(decoded.data.length);
  const anchor = primaryComponent(detection).centroid;
  const salt = options.salt ?? 0;
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const sourceOffset = ((y * decoded.info.width) + x) * 4;
      if (decoded.data[sourceOffset + 3] === 0) continue;
      const hash = hashPixel(x, y, salt);
      const dissolveThreshold = Math.round(progress * 72);
      if (hash % 100 >= dissolveThreshold) {
        decoded.data.copy(output, sourceOffset, sourceOffset, sourceOffset + 4);
      }
      if (!detection.mask[(y * decoded.info.width) + x]) continue;
      if (hash % 100 > Math.round(35 + (progress * 50))) continue;
      const rise = Math.max(1, Math.round(progress * (8 + (hash % 7))));
      const spread = Math.round(((x - anchor.x) * progress * 0.35) + (((hash % 5) - 2) * progress));
      const targetX = x + spread;
      const targetY = y - rise;
      if (targetX < 0 || targetX >= decoded.info.width || targetY < 0 || targetY >= decoded.info.height) continue;
      const targetOffset = ((targetY * decoded.info.width) + targetX) * 4;
      decoded.data.copy(output, targetOffset, sourceOffset, sourceOffset + 4);
      if (hash % 11 === 0 && targetX + 1 < decoded.info.width) {
        output.copy(output, targetOffset + 4, targetOffset, targetOffset + 4);
      }
    }
  }
  return encode(output, decoded.info, options.maxPaletteColors);
}

export async function createEnergyScatterFrame(detection, anchor, progress, options = {}) {
  const output = Buffer.alloc(detection.decoded.data.length);
  const distance = Math.max(1, Math.round((options.distance ?? 9) * progress));
  const salt = options.salt ?? 0;
  for (let pixel = 0; pixel < detection.mask.length; pixel += 1) {
    if (!detection.mask[pixel]) continue;
    const x = pixel % detection.decoded.info.width;
    const y = Math.floor(pixel / detection.decoded.info.width);
    const sourceOffset = pixel * 4;
    const hash = hashPixel(x, y, salt);
    if (hash % 100 < Math.round(progress * 58)) continue;
    const angle = Math.atan2(y - anchor.y, x - anchor.x) + (((hash % 9) - 4) * 0.1);
    const targetX = x + Math.round(Math.cos(angle) * distance);
    const targetY = y + Math.round(Math.sin(angle) * distance);
    if (targetX < 0 || targetX >= detection.decoded.info.width || targetY < 0 || targetY >= detection.decoded.info.height) continue;
    const targetOffset = ((targetY * detection.decoded.info.width) + targetX) * 4;
    detection.decoded.data.copy(output, targetOffset, sourceOffset, sourceOffset + 4);
  }
  return encode(output, detection.decoded.info, options.maxPaletteColors);
}

export async function createTwinkleFrame(assetBuffer, detection, phase, options = {}) {
  const output = Buffer.from(detection.decoded.data);
  const overlay = Buffer.alloc(output.length);
  const main = primaryComponent(detection);
  const maximumPixels = Math.max(2, Math.floor(main.pixels * 0.18));
  const twinkles = detection.report.components.filter((component, index) => (
    index > 0 && component.pixels <= maximumPixels
  ));
  const offsets = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  const shift = offsets[Math.abs(phase) % offsets.length];
  for (let pixel = 0; pixel < detection.mask.length; pixel += 1) {
    if (!detection.mask[pixel]) continue;
    const x = pixel % detection.decoded.info.width;
    const y = Math.floor(pixel / detection.decoded.info.width);
    const index = twinkles.findIndex((component) => insideBounds(x, y, component.bounds));
    if (index < 0) continue;
    const sourceOffset = pixel * 4;
    output.fill(0, sourceOffset, sourceOffset + 4);
    if ((index + phase) % 3 === 2) continue;
    const targetX = x + shift.x;
    const targetY = y + shift.y;
    if (targetX < 0 || targetX >= detection.decoded.info.width || targetY < 0 || targetY >= detection.decoded.info.height) continue;
    const targetOffset = ((targetY * detection.decoded.info.width) + targetX) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const source = detection.decoded.data[sourceOffset + channel];
      const value = Math.round(source + ((255 - source) * 0.5));
      output[targetOffset + channel] = value;
      overlay[targetOffset + channel] = value;
    }
    output[targetOffset + 3] = detection.decoded.data[sourceOffset + 3];
    overlay[targetOffset + 3] = detection.decoded.data[sourceOffset + 3];
  }
  return {
    compositeBuffer: await encode(output, detection.decoded.info, options.maxPaletteColors),
    overlayBuffer: await encode(overlay, detection.decoded.info, options.maxPaletteColors),
    report: { strategy: 'small_energy_component_phase_shift', twinkle_components: twinkles.length },
  };
}

export async function createLiquidSwirlFrame(assetBuffer, detection, phase, options = {}) {
  const output = Buffer.from(detection.decoded.data);
  const overlay = Buffer.alloc(output.length);
  const liquid = primaryComponent(detection);
  const amplitude = options.amplitude ?? 2;
  for (let pixel = 0; pixel < detection.mask.length; pixel += 1) {
    if (!detection.mask[pixel]) continue;
    const x = pixel % detection.decoded.info.width;
    const y = Math.floor(pixel / detection.decoded.info.width);
    if (!insideBounds(x, y, liquid.bounds)) continue;
    const sourceOffset = pixel * 4;
    output.fill(0, sourceOffset, sourceOffset + 4);
    const normalizedY = (y - liquid.bounds.y) / Math.max(1, liquid.bounds.height - 1);
    const shift = Math.round(Math.sin((normalizedY * Math.PI * 2) + phase) * amplitude);
    const targetX = x + shift;
    if (!insideBounds(targetX, y, liquid.bounds) || targetX < 0 || targetX >= detection.decoded.info.width) continue;
    const targetOffset = ((y * detection.decoded.info.width) + targetX) * 4;
    detection.decoded.data.copy(output, targetOffset, sourceOffset, sourceOffset + 4);
    for (let channel = 0; channel < 3; channel += 1) {
      const source = detection.decoded.data[sourceOffset + channel];
      overlay[targetOffset + channel] = Math.round(source + ((255 - source) * 0.28));
    }
    overlay[targetOffset + 3] = detection.decoded.data[sourceOffset + 3];
  }
  const orbitRadiusX = Math.max(2, Math.floor(liquid.bounds.width * 0.32));
  const orbitRadiusY = Math.max(2, Math.floor(liquid.bounds.height * 0.28));
  const brightColors = [
    [185, 255, 241, 255],
    [68, 198, 191, 255],
    [234, 215, 255, 255],
  ];
  for (let mote = 0; mote < 3; mote += 1) {
    const angle = phase + ((Math.PI * 2 * mote) / 3);
    const moteX = Math.round(liquid.centroid.x + (Math.cos(angle) * orbitRadiusX));
    const moteY = Math.round(liquid.centroid.y + (Math.sin(angle) * orbitRadiusY));
    const color = brightColors[mote];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
      const x = moteX + dx;
      const y = moteY + dy;
      if (!insideBounds(x, y, liquid.bounds) || x < 0 || y < 0 || x >= detection.decoded.info.width || y >= detection.decoded.info.height) continue;
      const targetOffset = ((y * detection.decoded.info.width) + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[targetOffset + channel] = color[channel];
        overlay[targetOffset + channel] = color[channel];
      }
    }
  }
  return {
    compositeBuffer: await encode(output, detection.decoded.info, options.maxPaletteColors),
    overlayBuffer: await encode(overlay, detection.decoded.info, options.maxPaletteColors),
    report: { strategy: 'fixed_region_sine_swirl_with_orbiting_liquid_highlights', liquid_component: liquid },
  };
}

function hashPixel(x, y, salt) {
  let value = ((x + 1) * 73856093) ^ ((y + 1) * 19349663) ^ ((salt + 1) * 83492791);
  value ^= value >>> 13;
  return Math.abs(value);
}

export async function createFracturedObjectFrame(assetBuffer, anchor, progress, options = {}) {
  const decoded = await sharp(assetBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(decoded.data.length);
  const distance = Math.max(0, Math.round((options.distance ?? 6) * progress));
  const salt = options.salt ?? 0;
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const sourceOffset = ((y * decoded.info.width) + x) * 4;
      if (decoded.data[sourceOffset + 3] === 0) continue;
      const hash = hashPixel(x, y, salt);
      if (progress > 0.72 && hash % 100 < Math.round((progress - 0.72) * 210)) continue;
      const angle = Math.atan2(y - anchor.y, x - anchor.x) + (((hash % 5) - 2) * 0.12);
      const targetX = x + Math.round(Math.cos(angle) * distance);
      const targetY = y + Math.round(Math.sin(angle) * distance);
      if (targetX < 0 || targetX >= decoded.info.width || targetY < 0 || targetY >= decoded.info.height) continue;
      decoded.data.copy(output, ((targetY * decoded.info.width) + targetX) * 4, sourceOffset, sourceOffset + 4);
    }
  }
  return encode(output, decoded.info, options.maxPaletteColors);
}
