const REVEAL_METHOD_ALIASES = Object.freeze({
  falling: 'cascade',
  falling_particles: 'cascade',
  checker: 'checkerboard',
  circle: 'radial',
  circular: 'radial',
  diagonal_wave: 'diagonal',
  diagonal_wipe: 'diagonal',
  fragment: 'fragments',
  fragment_grid: 'fragments',
  horizontal_strips: 'strips',
  iris: 'radial',
  path: 'pathfinding',
  pathfinder: 'pathfinding',
  four_point_path: 'pathfinding',
  particle: 'particles',
  pixel_particles: 'particles',
  perlin: 'noise',
  perlin_noise: 'noise',
  scan: 'wipe',
  scanline: 'wipe',
});

const DIFFICULTY_PROGRESS_EXPONENTS = Object.freeze({
  easy: 0.74,
  normal: 1,
  hard: 1.42,
});

export const PROGRESSIVE_REVEAL_METHODS = Object.freeze([
  'wipe',
  'fragments',
  'strips',
  'noise',
  'particles',
  'radial',
  'checkerboard',
  'diagonal',
  'cascade',
  'pathfinding',
]);

function ensureNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value || 'progressive-reveal')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildHashValue(coordinate, seed, salt = 0) {
  const seededOffset = (hashSeed(`${seed}:${salt}`) % 100000) + 1;
  const value = Math.abs(Math.sin((coordinate * 12.9898) + seededOffset) * 43758.5453);
  return value - Math.floor(value);
}

function resolveRadialOrigins(seed, config) {
  const originCount = Math.round(clamp(ensureNumber(config?.origin_count, 4), 1, 6));
  return Array.from({ length: originCount }, (_, index) => ({
    x: Number((0.14 + ((hashSeed(`${seed}:radial-x:${index}`) / 4294967295) * 0.72)).toFixed(4)),
    y: Number((0.14 + ((hashSeed(`${seed}:radial-y:${index}`) / 4294967295) * 0.72)).toFixed(4)),
  }));
}

function resolvePathfindingOrigins(config) {
  const inset = clamp(ensureNumber(config?.origin_inset_ratio, 0.08), 0.02, 0.3);
  return [
    { x: inset, y: inset },
    { x: 1 - inset, y: inset },
    { x: inset, y: 1 - inset },
    { x: 1 - inset, y: 1 - inset },
  ];
}

function buildHashExpression(coordinateExpression, seed, salt = 0) {
  const seededOffset = (hashSeed(`${seed}:${salt}`) % 100000) + 1;
  return `mod(abs(sin((${coordinateExpression})*12.9898+${seededOffset})*43758.5453),1)`;
}

function normalizeDirection(value, fallback = 'top_to_bottom') {
  const normalized = String(value || fallback).trim().toLowerCase().replaceAll('-', '_');
  return ['top_to_bottom', 'bottom_to_top', 'left_to_right', 'right_to_left'].includes(normalized)
    ? normalized
    : fallback;
}

function normalizeOrientation(value, fallback = 'horizontal') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized === 'vertical' ? 'vertical' : 'horizontal';
}

function normalizeDiagonalDirection(value, fallback = 'top_left_to_bottom_right') {
  const normalized = String(value || fallback).trim().toLowerCase().replaceAll('-', '_');
  return [
    'top_left_to_bottom_right',
    'bottom_right_to_top_left',
    'top_right_to_bottom_left',
    'bottom_left_to_top_right',
  ].includes(normalized) ? normalized : fallback;
}

export function normalizeProgressiveRevealMethod(value, fallback = 'wipe') {
  const normalized = String(value || fallback).trim().toLowerCase().replaceAll('-', '_');
  const resolved = REVEAL_METHOD_ALIASES[normalized] || normalized;
  return PROGRESSIVE_REVEAL_METHODS.includes(resolved) ? resolved : fallback;
}

export function buildProgressiveRevealProgressExpression({
  startSeconds = 0,
  durationSeconds = 1,
  fps = 30,
  difficulty = 'normal',
  completionProgress = 1,
} = {}) {
  const start = Math.max(0, ensureNumber(startSeconds, 0));
  const duration = Math.max(0.05, ensureNumber(durationSeconds, 1));
  const frameRate = Math.max(1, ensureNumber(fps, 30));
  const difficultyKey = String(difficulty || 'normal').trim().toLowerCase();
  const exponent = DIFFICULTY_PROGRESS_EXPONENTS[difficultyKey]
    || DIFFICULTY_PROGRESS_EXPONENTS.normal;
  const elapsedProgress = `clip(((N/${frameRate})-${start})/${duration},0,1)`;
  const curvedProgress = exponent === 1 ? elapsedProgress : `pow(${elapsedProgress},${exponent})`;
  const completion = clamp(ensureNumber(completionProgress, 1), 0.05, 1);
  return completion >= 0.999
    ? curvedProgress
    : `(${curvedProgress})*${Number(completion.toFixed(4))}`;
}

function buildWipeMask(progress, seed, config) {
  const direction = normalizeDirection(config?.direction);
  const roughness = clamp(ensureNumber(config?.boundary_roughness_px, 20), 0, 80);
  const xNoise = `${roughness}*(sin((X+${seed})*0.041)+0.55*sin((X-${seed})*0.017))`;
  const yNoise = `${roughness}*(sin((Y+${seed})*0.041)+0.55*sin((Y-${seed})*0.017))`;
  if (direction === 'bottom_to_top') {
    return `gte(Y,H-(${progress})*H+${xNoise})`;
  }
  if (direction === 'left_to_right') {
    return `lte(X,(${progress})*W+${yNoise})`;
  }
  if (direction === 'right_to_left') {
    return `gte(X,W-(${progress})*W+${yNoise})`;
  }
  return `lte(Y,(${progress})*H+${xNoise})`;
}

function buildFragmentMask(progress, seed, config) {
  const size = Math.max(12, Math.round(ensureNumber(config?.fragment_size_px, 72)));
  const coordinates = `floor(X/${size})+floor(Y/${size})*131`;
  return `lte(${buildHashExpression(coordinates, seed, 11)},${progress})`;
}

function buildStripMask(progress, seed, config) {
  const count = Math.max(4, Math.round(ensureNumber(config?.strip_count, 18)));
  const configuredWidth = ensureNumber(config?.strip_width_px, 0);
  const stripWidth = Math.max(2, Math.round(configuredWidth));
  const orientation = normalizeOrientation(config?.orientation);
  const stripIndex = configuredWidth > 0
    ? orientation === 'vertical' ? `floor(X/${stripWidth})` : `floor(Y/${stripWidth})`
    : orientation === 'vertical'
      ? `floor(X/max(1,W/${count}))`
      : `floor(Y/max(1,H/${count}))`;
  const travelPosition = orientation === 'vertical'
    ? 'Y/max(1,H-1)'
    : 'X/max(1,W-1)';
  const revealDurationSeconds = Math.max(
    0.05,
    ensureNumber(config?.reveal_duration_seconds, 8.5),
  );
  const minimumLineSeconds = clamp(
    ensureNumber(config?.line_reveal_min_seconds, 0.3),
    0.05,
    revealDurationSeconds,
  );
  const maximumLineSeconds = clamp(
    ensureNumber(config?.line_reveal_max_seconds, 1),
    minimumLineSeconds,
    revealDurationSeconds,
  );
  const lineDurationRange = Number((maximumLineSeconds - minimumLineSeconds).toFixed(3));
  const durationHash = buildHashExpression(stripIndex, seed, 29);
  const startHash = buildHashExpression(stripIndex, seed, 31);
  const lineDurationSeconds = lineDurationRange > 0
    ? `(${minimumLineSeconds}+${durationHash}*${lineDurationRange})`
    : String(minimumLineSeconds);
  const normalizedLineDuration = `((${lineDurationSeconds})/${revealDurationSeconds})`;
  const lineStart = `(${startHash})*(1-(${normalizedLineDuration}))`;
  const lineProgress = `clip(((${progress})-(${lineStart}))/max(0.001,(${normalizedLineDuration})),0,1)`;
  return `lte(${travelPosition},${lineProgress})`;
}

function buildNoiseMask(progress, seed, config) {
  const scale = clamp(ensureNumber(config?.noise_scale, 0.035), 0.004, 0.2);
  const offset = (hashSeed(seed) % 997) + 1;
  const noise = `(sin((X+${offset})*${scale})+sin((Y-${offset})*${Number((scale * 1.37).toFixed(5))})+sin((X+Y+${offset})*${Number((scale * 0.61).toFixed(5))})+3)/6`;
  return `lte(${noise},${progress})`;
}

function buildParticleMask(progress, seed, config) {
  const size = Math.max(2, Math.round(ensureNumber(config?.particle_size_px, 9)));
  const densityExponent = clamp(ensureNumber(config?.density_exponent, 1.3), 0.5, 3);
  const coordinates = `floor(X/${size})*197+floor(Y/${size})*389`;
  return `lte(${buildHashExpression(coordinates, seed, 37)},pow(${progress},${densityExponent}))`;
}

function buildRadialMask(progress, seed, config) {
  const maximumRadius = clamp(ensureNumber(config?.maximum_radius_ratio, 0.42), 0.15, 0.8);
  const distances = resolveRadialOrigins(seed, config).map(({ x, y }) => (
    `pow((X-W*${x})/max(1,W),2)+pow((Y-H*${y})/max(1,H),2)`
  ));
  const nearestOriginDistance = distances.slice(1).reduce(
    (nearest, distance) => `min(${nearest},${distance})`,
    distances[0],
  );
  return `lte(${nearestOriginDistance},pow((${progress})*${maximumRadius},2))`;
}

function buildCheckerboardMask(progress, seed, config) {
  const size = Math.max(12, Math.round(ensureNumber(config?.cell_size_px, 56)));
  const cellX = `floor(X/${size})`;
  const cellY = `floor(Y/${size})`;
  const coordinates = `${cellX}*211+${cellY}*421`;
  const cellOrder = buildHashExpression(coordinates, seed, 43);
  const threshold = `if(eq(mod(${cellX}+${cellY},2),0),(${cellOrder})*0.5,0.5+(${cellOrder})*0.5)`;
  return `lte(${threshold},${progress})`;
}

function buildDiagonalMask(progress, seed, config) {
  const direction = normalizeDiagonalDirection(config?.direction);
  const xForward = 'X/max(1,W-1)';
  const xReverse = '(W-1-X)/max(1,W-1)';
  const yForward = 'Y/max(1,H-1)';
  const yReverse = '(H-1-Y)/max(1,H-1)';
  const coordinates = {
    top_left_to_bottom_right: `(${xForward}+${yForward})/2`,
    bottom_right_to_top_left: `(${xReverse}+${yReverse})/2`,
    top_right_to_bottom_left: `(${xReverse}+${yForward})/2`,
    bottom_left_to_top_right: `(${xForward}+${yReverse})/2`,
  };
  const amplitude = clamp(ensureNumber(config?.wave_amplitude, 0.055), 0, 0.2);
  const frequency = clamp(ensureNumber(config?.wave_frequency, 0.028), 0.005, 0.12);
  const wave = `${amplitude}*sin((X-Y+${seed})*${frequency})`;
  return `lte(${coordinates[direction]}+${wave},${progress})`;
}

function buildCascadeThresholdExpression(seed, config) {
  const size = Math.max(3, Math.round(ensureNumber(config?.particle_size_px, 12)));
  const jitter = clamp(ensureNumber(config?.fall_jitter, 0.28), 0.05, 0.6);
  const cellX = `floor(X/${size})`;
  const cellY = `floor(Y/${size})`;
  const coordinates = `${cellX}*233+${cellY}*443`;
  const particleOrder = buildHashExpression(coordinates, seed, 47);
  const verticalProgress = `(${cellY}*${size})/max(1,H-1)`;
  return `clip((${verticalProgress})*${Number((1 - jitter).toFixed(4))}+(${particleOrder})*${jitter},0,1)`;
}

function buildCascadeMask(progress, seed, config) {
  return `lte(${buildCascadeThresholdExpression(seed, config)},${progress})`;
}

export function buildCascadeFallingParticlePhases({
  seed = 'progressive-reveal',
  progressExpression = '0',
  completionProgress = 0.6,
  config = {},
} = {}) {
  const numericSeed = hashSeed(seed) % 10000;
  const progress = String(progressExpression || '0').trim() || '0';
  const progressScale = clamp(ensureNumber(config?.progress_scale, 1), 0.05, 8);
  const maskProgress = Math.abs(progressScale - 1) < 0.0001
    ? `(${progress})`
    : `((${progress})*${Number(progressScale.toFixed(4))})`;
  const fullRevealDuration = Math.max(
    0.05,
    ensureNumber(config?.reveal_duration_seconds, 8.5),
  );
  const fallDuration = clamp(
    ensureNumber(config?.fall_duration_seconds, 1.2),
    0.1,
    fullRevealDuration,
  );
  const stepCount = Math.round(clamp(ensureNumber(config?.fall_step_count, 10), 3, 16));
  const fallDistance = Math.max(24, Math.round(ensureNumber(config?.fall_distance_px, 748)));
  const targetMaskProgress = Number(clamp(
    ensureNumber(completionProgress, 0.6) * progressScale,
    0.001,
    1,
  ).toFixed(4));
  const fallWindow = Number(clamp(
    (fallDuration / fullRevealDuration) * progressScale,
    0.005,
    targetMaskProgress,
  ).toFixed(4));
  const threshold = buildCascadeThresholdExpression(numericSeed, config);

  return Array.from({ length: stepCount }, (_, index) => {
    const lowerBound = Number(((fallWindow * index) / stepCount).toFixed(4));
    const upperBound = Number(((fallWindow * (index + 1)) / stepCount).toFixed(4));
    return {
      index,
      offsetPixels: Math.round(fallDistance * ((index + 0.5) / stepCount)),
      maskExpression: `if(gt(${threshold},${maskProgress}+${lowerBound})*lte(${threshold},min(${targetMaskProgress},${maskProgress}+${upperBound})),255,0)`,
    };
  });
}

function buildPathfindingMask(progress, seed, config) {
  const size = Math.max(4, Math.round(ensureNumber(config?.cell_size_px, 14)));
  const terrainJitter = clamp(ensureNumber(config?.terrain_jitter, 0.18), 0, 0.45);
  const distanceScale = clamp(ensureNumber(config?.distance_scale, 0.86), 0.5, 1.5);
  const cellX = `(floor(X/${size})*${size})/max(1,W-1)`;
  const cellY = `(floor(Y/${size})*${size})/max(1,H-1)`;
  const distances = resolvePathfindingOrigins(config).map(({ x, y }) => (
    `(abs(${cellX}-${x})+abs(${cellY}-${y}))/${distanceScale}`
  ));
  const nearestOriginDistance = distances.slice(1).reduce(
    (nearest, distance) => `min(${nearest},${distance})`,
    distances[0],
  );
  const coordinates = `floor(X/${size})*251+floor(Y/${size})*461`;
  const terrainCost = buildHashExpression(coordinates, seed, 53);
  const threshold = `clip((${nearestOriginDistance})*${Number((1 - terrainJitter).toFixed(4))}+(${terrainCost})*${terrainJitter},0,1)`;
  return `lte(${threshold},${progress})`;
}

function calculateWipeRevealScore({ x, y, width, height, seed, config }) {
  const direction = normalizeDirection(config?.direction);
  const roughness = clamp(ensureNumber(config?.boundary_roughness_px, 20), 0, 80);
  const xNoise = roughness * (
    Math.sin((x + seed) * 0.041)
    + (0.55 * Math.sin((x - seed) * 0.017))
  );
  const yNoise = roughness * (
    Math.sin((y + seed) * 0.041)
    + (0.55 * Math.sin((y - seed) * 0.017))
  );
  if (direction === 'bottom_to_top') return (height + xNoise - y) / height;
  if (direction === 'left_to_right') return (x - yNoise) / width;
  if (direction === 'right_to_left') return (width + yNoise - x) / width;
  return (y - xNoise) / height;
}

function calculateStripRevealScore({ x, y, width, height, seed, config }) {
  const count = Math.max(4, Math.round(ensureNumber(config?.strip_count, 18)));
  const configuredWidth = ensureNumber(config?.strip_width_px, 0);
  const stripWidth = Math.max(2, Math.round(configuredWidth));
  const orientation = normalizeOrientation(config?.orientation);
  const stripIndex = configuredWidth > 0
    ? Math.floor((orientation === 'vertical' ? x : y) / stripWidth)
    : Math.floor((orientation === 'vertical' ? x : y) / Math.max(
      1,
      (orientation === 'vertical' ? width : height) / count,
    ));
  const travelPosition = orientation === 'vertical'
    ? y / Math.max(1, height - 1)
    : x / Math.max(1, width - 1);
  const revealDurationSeconds = Math.max(
    0.05,
    ensureNumber(config?.reveal_duration_seconds, 8.5),
  );
  const minimumLineSeconds = clamp(
    ensureNumber(config?.line_reveal_min_seconds, 0.3),
    0.05,
    revealDurationSeconds,
  );
  const maximumLineSeconds = clamp(
    ensureNumber(config?.line_reveal_max_seconds, 1),
    minimumLineSeconds,
    revealDurationSeconds,
  );
  const lineDurationSeconds = minimumLineSeconds
    + (buildHashValue(stripIndex, seed, 29) * (maximumLineSeconds - minimumLineSeconds));
  const normalizedLineDuration = lineDurationSeconds / revealDurationSeconds;
  const lineStart = buildHashValue(stripIndex, seed, 31) * (1 - normalizedLineDuration);
  return lineStart + (travelPosition * normalizedLineDuration);
}

function calculateRevealScore(method, point, seed, config) {
  const { x, y, width, height } = point;
  if (method === 'wipe') {
    return calculateWipeRevealScore({ x, y, width, height, seed, config });
  }
  if (method === 'fragments') {
    const size = Math.max(12, Math.round(ensureNumber(config?.fragment_size_px, 72)));
    return buildHashValue(Math.floor(x / size) + (Math.floor(y / size) * 131), seed, 11);
  }
  if (method === 'strips') {
    return calculateStripRevealScore({ x, y, width, height, seed, config });
  }
  if (method === 'noise') {
    const scale = clamp(ensureNumber(config?.noise_scale, 0.035), 0.004, 0.2);
    const offset = (hashSeed(seed) % 997) + 1;
    return (
      Math.sin((x + offset) * scale)
      + Math.sin((y - offset) * Number((scale * 1.37).toFixed(5)))
      + Math.sin((x + y + offset) * Number((scale * 0.61).toFixed(5)))
      + 3
    ) / 6;
  }
  if (method === 'particles') {
    const size = Math.max(2, Math.round(ensureNumber(config?.particle_size_px, 9)));
    const exponent = clamp(ensureNumber(config?.density_exponent, 1.3), 0.5, 3);
    const coordinates = (Math.floor(x / size) * 197) + (Math.floor(y / size) * 389);
    return buildHashValue(coordinates, seed, 37) ** (1 / exponent);
  }
  if (method === 'radial') {
    const maximumRadius = clamp(ensureNumber(config?.maximum_radius_ratio, 0.42), 0.15, 0.8);
    const nearestDistanceSquared = Math.min(...resolveRadialOrigins(seed, config).map((origin) => (
      (((x - (width * origin.x)) / width) ** 2)
      + (((y - (height * origin.y)) / height) ** 2)
    )));
    return Math.sqrt(nearestDistanceSquared) / maximumRadius;
  }
  if (method === 'checkerboard') {
    const size = Math.max(12, Math.round(ensureNumber(config?.cell_size_px, 56)));
    const cellX = Math.floor(x / size);
    const cellY = Math.floor(y / size);
    const order = buildHashValue((cellX * 211) + (cellY * 421), seed, 43);
    return ((cellX + cellY) % 2 === 0) ? order * 0.5 : 0.5 + (order * 0.5);
  }
  if (method === 'diagonal') {
    const direction = normalizeDiagonalDirection(config?.direction);
    const xForward = x / Math.max(1, width - 1);
    const xReverse = (width - 1 - x) / Math.max(1, width - 1);
    const yForward = y / Math.max(1, height - 1);
    const yReverse = (height - 1 - y) / Math.max(1, height - 1);
    const coordinates = {
      top_left_to_bottom_right: (xForward + yForward) / 2,
      bottom_right_to_top_left: (xReverse + yReverse) / 2,
      top_right_to_bottom_left: (xReverse + yForward) / 2,
      bottom_left_to_top_right: (xForward + yReverse) / 2,
    };
    const amplitude = clamp(ensureNumber(config?.wave_amplitude, 0.055), 0, 0.2);
    const frequency = clamp(ensureNumber(config?.wave_frequency, 0.028), 0.005, 0.12);
    return coordinates[direction] + (amplitude * Math.sin((x - y + seed) * frequency));
  }
  if (method === 'cascade') {
    const size = Math.max(3, Math.round(ensureNumber(config?.particle_size_px, 12)));
    const jitter = clamp(ensureNumber(config?.fall_jitter, 0.28), 0.05, 0.6);
    const cellX = Math.floor(x / size);
    const cellY = Math.floor(y / size);
    const verticalProgress = (cellY * size) / Math.max(1, height - 1);
    const particleOrder = buildHashValue((cellX * 233) + (cellY * 443), seed, 47);
    return (verticalProgress * (1 - jitter)) + (particleOrder * jitter);
  }
  if (method === 'pathfinding') {
    const size = Math.max(4, Math.round(ensureNumber(config?.cell_size_px, 14)));
    const terrainJitter = clamp(ensureNumber(config?.terrain_jitter, 0.18), 0, 0.45);
    const distanceScale = clamp(ensureNumber(config?.distance_scale, 0.86), 0.5, 1.5);
    const cellX = (Math.floor(x / size) * size) / Math.max(1, width - 1);
    const cellY = (Math.floor(y / size) * size) / Math.max(1, height - 1);
    const nearestDistance = Math.min(...resolvePathfindingOrigins(config).map((origin) => (
      (Math.abs(cellX - origin.x) + Math.abs(cellY - origin.y)) / distanceScale
    )));
    const terrainCost = buildHashValue(
      (Math.floor(x / size) * 251) + (Math.floor(y / size) * 461),
      seed,
      53,
    );
    return (nearestDistance * (1 - terrainJitter)) + (terrainCost * terrainJitter);
  }
  return 1;
}

export function calculateOpaqueRevealCompletionProgress({
  method = 'wipe',
  seed = 'progressive-reveal',
  config = {},
  opaquePoints = [],
  width = 1,
  height = 1,
  targetOpaqueFraction = 0.6,
} = {}) {
  const target = clamp(ensureNumber(targetOpaqueFraction, 0.6), 0.05, 0.98);
  const normalizedMethod = normalizeProgressiveRevealMethod(method);
  const numericSeed = hashSeed(seed) % 10000;
  const safeWidth = Math.max(1, ensureNumber(width, 1));
  const safeHeight = Math.max(1, ensureNumber(height, 1));
  const scores = (Array.isArray(opaquePoints) ? opaquePoints : [])
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => calculateRevealScore(normalizedMethod, {
      x: point.x,
      y: point.y,
      width: safeWidth,
      height: safeHeight,
    }, numericSeed, config))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (scores.length === 0) {
    return {
      completionProgress: target,
      estimatedOpaqueFraction: target,
      maskProgressAtCompletion: target,
      progressScale: 1,
      sampledOpaquePixelCount: 0,
    };
  }
  const targetIndex = Math.min(scores.length - 1, Math.max(0, Math.ceil(scores.length * target) - 1));
  const maskProgressAtCompletion = Math.max(0.001, scores[targetIndex]);
  const progressScale = Math.ceil(
    clamp(maskProgressAtCompletion / target, 0.05, 8) * 10000,
  ) / 10000;
  const effectiveMaskProgress = target * progressScale;
  const visibleCount = scores.filter((score) => score <= effectiveMaskProgress + Number.EPSILON).length;
  return {
    completionProgress: target,
    estimatedOpaqueFraction: Number((visibleCount / scores.length).toFixed(4)),
    maskProgressAtCompletion: Number(effectiveMaskProgress.toFixed(4)),
    progressScale,
    sampledOpaquePixelCount: scores.length,
  };
}

export function buildProgressiveRevealMaskExpression({
  method = 'wipe',
  seed = 'progressive-reveal',
  progressExpression,
  config = {},
} = {}) {
  const normalizedMethod = normalizeProgressiveRevealMethod(method);
  const progress = String(progressExpression || '0').trim() || '0';
  const numericSeed = hashSeed(seed) % 10000;
  const progressScale = clamp(ensureNumber(config?.progress_scale, 1), 0.05, 8);
  const maskProgress = Math.abs(progressScale - 1) < 0.0001
    ? progress
    : `((${progress})*${Number(progressScale.toFixed(4))})`;
  const builders = {
    wipe: buildWipeMask,
    fragments: buildFragmentMask,
    strips: buildStripMask,
    noise: buildNoiseMask,
    particles: buildParticleMask,
    radial: buildRadialMask,
    checkerboard: buildCheckerboardMask,
    diagonal: buildDiagonalMask,
    cascade: buildCascadeMask,
    pathfinding: buildPathfindingMask,
  };
  const visibleExpression = builders[normalizedMethod](maskProgress, numericSeed, config);
  return `if(lte(${progress},0),0,if(gte(${progress},0.999),255,if(${visibleExpression},255,0)))`;
}

function appendProgressiveAlphaFilters(filters, {
  inputLabel,
  outputLabel,
  method,
  seed,
  startSeconds,
  durationSeconds,
  fps,
  difficulty = 'normal',
  completionProgress = 1,
  config = {},
  inverted = false,
} = {}) {
  if (!Array.isArray(filters)) {
    throw new TypeError('Progressive Reveal filters must be an array.');
  }
  if (!inputLabel || !outputLabel) {
    throw new Error('Progressive Reveal requires input and output labels.');
  }
  const progressExpression = buildProgressiveRevealProgressExpression({
    startSeconds,
    durationSeconds,
    fps,
    difficulty,
    completionProgress,
  });
  const maskExpression = buildProgressiveRevealMaskExpression({
    method,
    seed,
    progressExpression,
    config: {
      ...config,
      reveal_duration_seconds: ensureNumber(config?.reveal_duration_seconds, durationSeconds),
    },
  });
  const alphaExpression = inverted
    ? `alpha(X,Y)*(255-(${maskExpression}))/255`
    : `alpha(X,Y)*(${maskExpression})/255`;
  filters.push(
    `[${inputLabel}]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alphaExpression}'[${outputLabel}]`,
  );
  return {
    method: normalizeProgressiveRevealMethod(method),
    progressExpression,
    maskExpression,
    outputLabel,
  };
}

export function appendProgressiveRevealFilters(filters, options = {}) {
  return appendProgressiveAlphaFilters(filters, options);
}

export function appendProgressiveCoverFilters(filters, options = {}) {
  return appendProgressiveAlphaFilters(filters, {
    ...options,
    inverted: true,
  });
}
