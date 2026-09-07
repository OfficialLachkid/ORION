import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const DEFAULT_ALPHA_THRESHOLD = 24;
const DEFAULT_IDEAL_MIN_PERCENT = 0.05;
const DEFAULT_IDEAL_MAX_PERCENT = 0.30;
const DEFAULT_BROAD_MIN_PERCENT = 0.02;
const DEFAULT_BROAD_MAX_PERCENT = 0.45;
const DEFAULT_MIN_SATURATION = 0.18;

const REPLACEMENT_PALETTE = Object.freeze([
  Object.freeze({ id: 'violet', hue: 274, saturation: 0.78, lightness: 0.55 }),
  Object.freeze({ id: 'cyan', hue: 188, saturation: 0.80, lightness: 0.52 }),
  Object.freeze({ id: 'emerald', hue: 142, saturation: 0.72, lightness: 0.46 }),
  Object.freeze({ id: 'orange', hue: 29, saturation: 0.86, lightness: 0.55 }),
  Object.freeze({ id: 'rose', hue: 336, saturation: 0.80, lightness: 0.58 }),
  Object.freeze({ id: 'gold', hue: 49, saturation: 0.88, lightness: 0.56 }),
  Object.freeze({ id: 'azure', hue: 214, saturation: 0.82, lightness: 0.55 }),
  Object.freeze({ id: 'lime', hue: 92, saturation: 0.74, lightness: 0.50 }),
]);

let sharpModulePromise = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'localized-color-mutation')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createPrng(seedInput) {
  let seed = hashSeed(seedInput) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

export function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let saturation = 0;
  const lightness = (max + min) / 2;

  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r:
        hue = ((g - b) / delta) + (g < b ? 6 : 0);
        break;
      case g:
        hue = ((b - r) / delta) + 2;
        break;
      default:
        hue = ((r - g) / delta) + 4;
        break;
    }
    hue *= 60;
  }

  return {
    hue,
    saturation,
    lightness,
  };
}

function hueToRgbChannel(p, q, tInput) {
  let t = tInput;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + ((q - p) * 6 * t);
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + ((q - p) * ((2 / 3) - t) * 6);
  return p;
}

export function hslToRgb(hue, saturation, lightness) {
  const h = ((((hue % 360) + 360) % 360) / 360);
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);
  if (s === 0) {
    const value = Math.round(l * 255);
    return { red: value, green: value, blue: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - (l * s);
  const p = (2 * l) - q;
  return {
    red: Math.round(hueToRgbChannel(p, q, h + (1 / 3)) * 255),
    green: Math.round(hueToRgbChannel(p, q, h) * 255),
    blue: Math.round(hueToRgbChannel(p, q, h - (1 / 3)) * 255),
  };
}

export function hueDistance(leftHue, rightHue) {
  const diff = Math.abs((((leftHue - rightHue) % 360) + 540) % 360 - 180);
  return Number(diff.toFixed(3));
}

function rgbDistance(left, right) {
  return Math.sqrt(
    ((left.red - right.red) ** 2)
    + ((left.green - right.green) ** 2)
    + ((left.blue - right.blue) ** 2),
  );
}

function colorGroupKey(hsl) {
  if (hsl.saturation < 0.14) {
    return `neutral-${Math.floor(hsl.lightness * 8)}`;
  }
  return [
    Math.floor(hsl.hue / 18),
    Math.floor(hsl.saturation * 4),
    Math.floor(hsl.lightness * 6),
  ].join('-');
}

function normalizeGroup(rawGroup, visiblePixelCount) {
  const count = Math.max(1, rawGroup.count);
  const rgb = {
    red: rawGroup.red / count,
    green: rawGroup.green / count,
    blue: rawGroup.blue / count,
  };
  const hsl = rgbToHsl(rgb.red, rgb.green, rgb.blue);
  return {
    key: rawGroup.key,
    count: rawGroup.count,
    percent: visiblePixelCount > 0 ? rawGroup.count / visiblePixelCount : 0,
    red: Number(rgb.red.toFixed(3)),
    green: Number(rgb.green.toFixed(3)),
    blue: Number(rgb.blue.toFixed(3)),
    hue: Number(hsl.hue.toFixed(3)),
    saturation: Number(hsl.saturation.toFixed(3)),
    lightness: Number(hsl.lightness.toFixed(3)),
  };
}

function isUsableGroup(group, minSaturation = DEFAULT_MIN_SATURATION) {
  if (group.count <= 0) return false;
  if (group.lightness <= 0.10 || group.lightness >= 0.91) return false;
  if (group.saturation < minSaturation) return false;
  return true;
}

export function analyzeVisibleColorFamilies({
  data,
  width,
  height,
  channels = 4,
  alphaThreshold = DEFAULT_ALPHA_THRESHOLD,
  sampleEvery = 1,
} = {}) {
  const pixelData = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  const normalizedWidth = Math.max(0, Number(width || 0));
  const normalizedHeight = Math.max(0, Number(height || 0));
  const normalizedChannels = Math.max(4, Number(channels || 4));
  const stride = Math.max(1, Number(sampleEvery || 1));
  const groups = new Map();
  let visiblePixelCount = 0;

  for (let y = 0; y < normalizedHeight; y += stride) {
    for (let x = 0; x < normalizedWidth; x += stride) {
      const offset = ((y * normalizedWidth) + x) * normalizedChannels;
      if (offset + 3 >= pixelData.length) {
        continue;
      }
      const alpha = pixelData[offset + 3];
      if (alpha < alphaThreshold) {
        continue;
      }
      visiblePixelCount += 1;
      const red = pixelData[offset];
      const green = pixelData[offset + 1];
      const blue = pixelData[offset + 2];
      const hsl = rgbToHsl(red, green, blue);
      const key = colorGroupKey(hsl);
      const current = groups.get(key) || {
        key,
        count: 0,
        red: 0,
        green: 0,
        blue: 0,
      };
      current.count += 1;
      current.red += red;
      current.green += green;
      current.blue += blue;
      groups.set(key, current);
    }
  }

  const normalizedGroups = [...groups.values()]
    .map((group) => normalizeGroup(group, visiblePixelCount))
    .sort((left, right) => right.count - left.count);

  return {
    visible_pixel_count: visiblePixelCount,
    groups: normalizedGroups,
    major_groups: normalizedGroups.filter((group) => group.percent >= 0.03),
  };
}

function scoreColorGroup(group) {
  const targetPercent = 0.16;
  const percentScore = 1 - Math.min(1, Math.abs(group.percent - targetPercent) / targetPercent);
  const lightnessScore = 1 - Math.min(1, Math.abs(group.lightness - 0.52) / 0.48);
  return Number(((percentScore * 3) + (group.saturation * 2) + lightnessScore).toFixed(4));
}

export function selectMutableColorFamily(analysis, config = {}) {
  const minSaturation = Number(config.min_saturation ?? DEFAULT_MIN_SATURATION);
  const groups = (Array.isArray(analysis?.groups) ? analysis.groups : [])
    .filter((group) => isUsableGroup(group, minSaturation));
  if (groups.length === 0) {
    return null;
  }

  const idealMin = Number(config.ideal_min_percent ?? DEFAULT_IDEAL_MIN_PERCENT);
  const idealMax = Number(config.ideal_max_percent ?? DEFAULT_IDEAL_MAX_PERCENT);
  const broadMin = Number(config.broad_min_percent ?? DEFAULT_BROAD_MIN_PERCENT);
  const broadMax = Number(config.broad_max_percent ?? DEFAULT_BROAD_MAX_PERCENT);
  const ideal = groups.filter((group) => group.percent >= idealMin && group.percent <= idealMax);
  const broad = groups.filter((group) => group.percent >= broadMin && group.percent <= broadMax);
  const pool = ideal.length > 0 ? ideal : (broad.length > 0 ? broad : groups);
  const selected = [...pool].sort((left, right) => {
    const scoreDiff = scoreColorGroup(right) - scoreColorGroup(left);
    return scoreDiff || (right.count - left.count);
  })[0];

  return {
    ...selected,
    score: scoreColorGroup(selected),
    tolerance_hue: Number(config.hue_tolerance_degrees ?? 28),
  };
}

function targetConflictsWithOriginal(target, originalGroups, {
  minHueDistance = 36,
  minRgbDistance = 64,
} = {}) {
  const targetRgb = hslToRgb(target.hue, target.saturation, target.lightness);
  return originalGroups.some((group) => {
    const hueConflict = group.saturation >= 0.16
      && target.saturation >= 0.16
      && hueDistance(target.hue, group.hue) < minHueDistance
      && Math.abs(target.lightness - group.lightness) < 0.26;
    const rgbConflict = rgbDistance(targetRgb, group) < minRgbDistance;
    return hueConflict || rgbConflict;
  });
}

export function selectReplacementTargets({
  analysis,
  selectedFamily,
  variantCount = 3,
  seed = 'localized-color-mutation',
  config = {},
} = {}) {
  const count = Math.max(1, Number(variantCount || 1));
  const random = createPrng(seed);
  const majorGroups = (Array.isArray(analysis?.major_groups) ? analysis.major_groups : [])
    .filter((group) => group.percent >= Number(config.existing_color_min_percent ?? 0.03));
  const shuffledPalette = shuffle(REPLACEMENT_PALETTE, random);
  const selected = [];
  const passes = [
    { minHueDistance: 40, minRgbDistance: 72 },
    { minHueDistance: 30, minRgbDistance: 58 },
    { minHueDistance: 20, minRgbDistance: 44 },
  ];

  for (const pass of passes) {
    for (const target of shuffledPalette) {
      if (selected.length >= count) break;
      if (selected.some((existing) => hueDistance(existing.hue, target.hue) < 42)) {
        continue;
      }
      if (selectedFamily && hueDistance(target.hue, selectedFamily.hue) < pass.minHueDistance) {
        continue;
      }
      if (targetConflictsWithOriginal(target, majorGroups, pass)) {
        continue;
      }
      selected.push(target);
    }
    if (selected.length >= count) break;
  }

  for (const target of shuffledPalette) {
    if (selected.length >= count) break;
    if (!selected.some((existing) => hueDistance(existing.hue, target.hue) < 34)) {
      selected.push(target);
    }
  }

  return selected.slice(0, count);
}

function signedHueDelta(leftHue, rightHue) {
  return ((((leftHue - rightHue) % 360) + 540) % 360) - 180;
}

function membershipStrength(hsl, selectedFamily) {
  if (!selectedFamily) return 0;
  const hueTolerance = Number(selectedFamily.tolerance_hue || 28);
  const hueScore = 1 - (hueDistance(hsl.hue, selectedFamily.hue) / hueTolerance);
  const saturationScore = 1 - (Math.abs(hsl.saturation - selectedFamily.saturation) / 0.55);
  const lightnessScore = 1 - (Math.abs(hsl.lightness - selectedFamily.lightness) / 0.60);
  const rawStrength = Math.min(hueScore, saturationScore, lightnessScore);
  return clamp(rawStrength, 0, 1);
}

export function mutateRgbaColorFamily({
  data,
  width,
  height,
  channels = 4,
  selectedFamily,
  target,
  alphaThreshold = DEFAULT_ALPHA_THRESHOLD,
} = {}) {
  const source = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  const output = Buffer.from(source);
  const normalizedWidth = Math.max(0, Number(width || 0));
  const normalizedHeight = Math.max(0, Number(height || 0));
  const normalizedChannels = Math.max(4, Number(channels || 4));

  if (!selectedFamily || !target) {
    return output;
  }

  for (let y = 0; y < normalizedHeight; y += 1) {
    for (let x = 0; x < normalizedWidth; x += 1) {
      const offset = ((y * normalizedWidth) + x) * normalizedChannels;
      if (offset + 3 >= output.length || output[offset + 3] < alphaThreshold) {
        continue;
      }

      const original = {
        red: output[offset],
        green: output[offset + 1],
        blue: output[offset + 2],
      };
      const hsl = rgbToHsl(original.red, original.green, original.blue);
      const strength = membershipStrength(hsl, selectedFamily);
      if (strength <= 0) {
        continue;
      }

      const shiftedHue = target.hue + (signedHueDelta(hsl.hue, selectedFamily.hue) * 0.22);
      const shiftedSaturation = clamp((hsl.saturation * 0.74) + (target.saturation * 0.26), 0.16, 0.94);
      const shiftedLightness = clamp(
        hsl.lightness + ((target.lightness - selectedFamily.lightness) * 0.10),
        0.08,
        0.92,
      );
      const shiftedRgb = hslToRgb(shiftedHue, shiftedSaturation, shiftedLightness);
      const blend = clamp(0.58 + (strength * 0.42), 0, 1);
      output[offset] = Math.round((original.red * (1 - blend)) + (shiftedRgb.red * blend));
      output[offset + 1] = Math.round((original.green * (1 - blend)) + (shiftedRgb.green * blend));
      output[offset + 2] = Math.round((original.blue * (1 - blend)) + (shiftedRgb.blue * blend));
    }
  }

  return output;
}

export function buildLocalizedColorMutationVariants({
  data,
  width,
  height,
  channels = 4,
  variantCount = 3,
  seed = 'localized-color-mutation',
  config = {},
} = {}) {
  const analysis = analyzeVisibleColorFamilies({
    data,
    width,
    height,
    channels,
    alphaThreshold: Number(config.alpha_threshold ?? DEFAULT_ALPHA_THRESHOLD),
    sampleEvery: Math.max(1, Number(config.analysis_sample_every ?? 1)),
  });
  const selectedFamily = selectMutableColorFamily(analysis, config);
  const targets = selectReplacementTargets({
    analysis,
    selectedFamily,
    variantCount,
    seed,
    config,
  });
  return {
    analysis,
    selected_family: selectedFamily,
    variants: targets.map((target, index) => ({
      index,
      target,
      data: mutateRgbaColorFamily({
        data,
        width,
        height,
        channels,
        selectedFamily,
        target,
        alphaThreshold: Number(config.alpha_threshold ?? DEFAULT_ALPHA_THRESHOLD),
      }),
      mutation: {
        selected_family: selectedFamily,
        target,
      },
    })),
  };
}

async function loadSharp() {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp')
      .then((module) => module.default || module)
      .catch(() => null);
  }
  return sharpModulePromise;
}

function shouldOutputAnimatedGif(inputPath, metadata) {
  return extname(inputPath || '').toLowerCase() === '.gif'
    && Number(metadata?.pages || 0) > 1
    && Number(metadata?.pageHeight || 0) > 0;
}

async function writeVariantAsset({
  sharp,
  data,
  info,
  metadata,
  inputPath,
  outputPath,
}) {
  const channels = Number(info?.channels || 4);
  const width = Number(info?.width || 0);
  const height = Number(info?.height || 0);
  if (shouldOutputAnimatedGif(inputPath, metadata)) {
    const pageHeight = Number(metadata.pageHeight);
    try {
      await sharp(data, {
        raw: {
          width,
          height,
          channels,
          pageHeight,
        },
        animated: true,
      })
        .gif({
          delay: Array.isArray(metadata.delay) && metadata.delay.length > 0 ? metadata.delay : undefined,
          loop: Number.isFinite(metadata.loop) ? metadata.loop : 0,
        })
        .toFile(outputPath);
      return outputPath;
    } catch {
      const fallbackPath = outputPath.replace(/\.gif$/u, '.png');
      await sharp(data.subarray(0, width * pageHeight * channels), {
        raw: { width, height: pageHeight, channels },
      }).png().toFile(fallbackPath);
      return fallbackPath;
    }
  }

  await sharp(data, {
    raw: { width, height, channels },
  }).png().toFile(outputPath.replace(/\.[^.]+$/u, '.png'));
  return outputPath.replace(/\.[^.]+$/u, '.png');
}

export async function createLocalizedColorVariantAssets({
  inputPath,
  outputDirectory,
  outputBasename,
  variantCount = 3,
  seed = 'localized-color-mutation',
  config = {},
} = {}) {
  const normalizedInputPath = String(inputPath || '').trim();
  const normalizedOutputDirectory = String(outputDirectory || '').trim();
  if (!normalizedInputPath || !normalizedOutputDirectory) {
    return { created: [], reason: 'missing_input_or_output' };
  }

  const sharp = await loadSharp();
  if (!sharp) {
    return { created: [], reason: 'sharp_unavailable' };
  }

  const input = sharp(normalizedInputPath, { animated: true, pages: -1 }).ensureAlpha();
  const metadata = await input.metadata();
  const { data, info } = await sharp(normalizedInputPath, { animated: true, pages: -1 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = Number(info?.width || 0);
  const height = Number(info?.height || 0);
  const channels = Number(info?.channels || 4);
  if (width <= 0 || height <= 0 || channels < 4 || !data?.length) {
    return { created: [], reason: 'invalid_raw_image' };
  }

  const result = buildLocalizedColorMutationVariants({
    data,
    width,
    height,
    channels,
    variantCount,
    seed,
    config,
  });
  await mkdir(normalizedOutputDirectory, { recursive: true });
  const outputExtension = shouldOutputAnimatedGif(normalizedInputPath, metadata) ? '.gif' : '.png';
  const created = [];
  for (const variant of result.variants) {
    const outputPath = join(
      normalizedOutputDirectory,
      `${outputBasename}-${String(variant.index + 1).padStart(2, '0')}-${variant.target.id}${outputExtension}`,
    );
    const writtenPath = await writeVariantAsset({
      sharp,
      data: variant.data,
      info,
      metadata,
      inputPath: normalizedInputPath,
      outputPath,
    });
    created.push({
      path: writtenPath,
      mutation: variant.mutation,
    });
  }

  return {
    created,
    reason: created.length > 0 ? 'ok' : 'no_variants',
    selected_family: result.selected_family,
    analysis: result.analysis,
  };
}
