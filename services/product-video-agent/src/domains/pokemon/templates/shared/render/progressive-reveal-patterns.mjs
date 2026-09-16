export const ADDITIONAL_PROGRESSIVE_REVEAL_METHODS = Object.freeze([
  'spiral',
  'diamond',
  'cross',
  'edge_particles',
  'diagonal_particles',
  'square_spiral',
  'square_spiral_inward',
  'fluid_fill',
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

function buildHashExpression(coordinateExpression, seed, salt = 0) {
  const seededOffset = (hashSeed(`${seed}:${salt}`) % 100000) + 1;
  return `mod(abs(sin((${coordinateExpression})*12.9898+${seededOffset})*43758.5453),1)`;
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

function resolveDiamondOrigin(seed, config) {
  const jitter = clamp(ensureNumber(config?.center_jitter_ratio, 0.08), 0, 0.2);
  const coordinate = (axis) => 0.5 + (
    (((hashSeed(`${seed}:diamond-${axis}`) / 4294967295) * 2) - 1) * jitter
  );
  return { x: Number(coordinate('x').toFixed(4)), y: Number(coordinate('y').toFixed(4)) };
}

function buildSpiralMask(progress, seed, config) {
  const turns = clamp(ensureNumber(config?.turns, 2.75), 0.75, 6);
  const radialWeight = clamp(ensureNumber(config?.radial_weight, 0.58), 0.25, 0.8);
  const angularWeight = Number((1 - radialWeight).toFixed(4));
  const phase = Number((hashSeed(`${seed}:spiral`) / 4294967295).toFixed(4));
  const radius = 'sqrt(pow((X-W/2)/max(1,W/2),2)+pow((Y-H/2)/max(1,H/2),2))/1.4142';
  const angle = '(atan2(Y-H/2,X-W/2)+PI)/(2*PI)';
  const threshold = `clip((${radius})*${radialWeight}+mod(${angle}+(${radius})*${turns}+${phase},1)*${angularWeight},0,1)`;
  return `lte(${threshold},${progress})`;
}

function buildDiamondMask(progress, seed, config) {
  const origin = resolveDiamondOrigin(seed, config);
  const maximumDistance = Math.max(
    origin.x + origin.y,
    origin.x + (1 - origin.y),
    (1 - origin.x) + origin.y,
    (1 - origin.x) + (1 - origin.y),
  );
  const distance = `(abs(X/max(1,W-1)-${origin.x})+abs(Y/max(1,H-1)-${origin.y}))/${Number(maximumDistance.toFixed(4))}`;
  return `lte((1-(${distance})),${progress})`;
}

function buildCrossMask(progress, _seed, config) {
  const cornerWeight = clamp(ensureNumber(config?.corner_fill_ratio, 0.18), 0.05, 0.45);
  const axisWeight = Number((1 - cornerWeight).toFixed(4));
  const xDistance = 'abs(X/max(1,W-1)-0.5)*2';
  const yDistance = 'abs(Y/max(1,H-1)-0.5)*2';
  return `lte(min(${xDistance},${yDistance})*${axisWeight}+max(${xDistance},${yDistance})*${cornerWeight},${progress})`;
}

function buildEdgeParticleMask(progress, seed, config) {
  const size = Math.max(3, Math.round(ensureNumber(config?.particle_size_px, 10)));
  const jitter = clamp(ensureNumber(config?.edge_jitter, 0.22), 0, 0.55);
  const cellColumn = `floor(X/${size})`;
  const cellRow = `floor(Y/${size})`;
  const cellX = `${cellColumn}*${size}`;
  const cellY = `${cellRow}*${size}`;
  const xForward = `${cellX}/max(1,W-1)`;
  const xReverse = `(W-1-${cellX})/max(1,W-1)`;
  const yForward = `${cellY}/max(1,H-1)`;
  const yReverse = `(H-1-${cellY})/max(1,H-1)`;
  const edgeDistance = `min(min(${xForward},${xReverse}),min(${yForward},${yReverse}))*2`;
  const particleOrder = buildHashExpression(`${cellColumn}*271+${cellRow}*487`, seed, 59);
  const threshold = `clip((${edgeDistance})*${Number((1 - jitter).toFixed(4))}+(${particleOrder})*${jitter},0,1)`;
  return `lte(${threshold},${progress})`;
}

function buildDiagonalParticleMask(progress, seed, config) {
  const size = Math.max(3, Math.round(ensureNumber(config?.particle_size_px, 10)));
  const jitter = clamp(ensureNumber(config?.path_jitter, 0.2), 0, 0.55);
  const cellColumn = `floor(X/${size})`;
  const cellRow = `floor(Y/${size})`;
  const cellX = `${cellColumn}*${size}`;
  const cellY = `${cellRow}*${size}`;
  const xForward = `${cellX}/max(1,W-1)`;
  const xReverse = `(W-1-${cellX})/max(1,W-1)`;
  const yForward = `${cellY}/max(1,H-1)`;
  const yReverse = `(H-1-${cellY})/max(1,H-1)`;
  const direction = normalizeDiagonalDirection(config?.direction);
  const diagonalPosition = {
    top_left_to_bottom_right: `(${xForward}+${yForward})/2`,
    bottom_right_to_top_left: `(${xReverse}+${yReverse})/2`,
    top_right_to_bottom_left: `(${xReverse}+${yForward})/2`,
    bottom_left_to_top_right: `(${xForward}+${yReverse})/2`,
  }[direction];
  const particleOrder = buildHashExpression(`${cellColumn}*307+${cellRow}*503`, seed, 61);
  const threshold = `clip((${diagonalPosition})*${Number((1 - jitter).toFixed(4))}+(${particleOrder})*${jitter},0,1)`;
  return `lte(${threshold},${progress})`;
}

function buildSquareSpiralThreshold(seed, config) {
  const turns = clamp(ensureNumber(config?.turns, 3), 1, 7);
  const radialWeight = clamp(ensureNumber(config?.radial_weight, 0.62), 0.3, 0.85);
  const angularWeight = Number((1 - radialWeight).toFixed(4));
  const phaseOffset = Number((hashSeed(`${seed}:square-spiral`) / 4294967295).toFixed(4));
  const x = 'X/max(1,W-1)-0.5';
  const y = 'Y/max(1,H-1)-0.5';
  const radius = `max(abs(${x}),abs(${y}))`;
  const safeRadius = `max(0.001,${radius})`;
  const squarePhase = `if(lte(${y},-abs(${x})),((${x})/${safeRadius}+1)/8,if(gte(${x},abs(${y})),0.25+((${y})/${safeRadius}+1)/8,if(gte(${y},abs(${x})),0.5+(1-(${x})/${safeRadius})/8,0.75+(1-(${y})/${safeRadius})/8)))`;
  const squareRadius = `${radius}*2`;
  return `clip((${squareRadius})*${radialWeight}+mod(${squarePhase}+(${squareRadius})*${turns}+${phaseOffset},1)*${angularWeight},0,1)`;
}

function buildSquareSpiralMask(progress, seed, config) {
  return `lte(${buildSquareSpiralThreshold(seed, config)},${progress})`;
}

function buildSquareSpiralInwardMask(progress, seed, config) {
  return `lte((1-(${buildSquareSpiralThreshold(seed, config)})),${progress})`;
}

export function buildFluidFillThresholdExpression(seed, config = {}) {
  const size = Math.max(3, Math.round(ensureNumber(config?.particle_size_px, 8)));
  const particleJitter = clamp(ensureNumber(config?.particle_jitter, 0.16), 0, 0.4);
  const waveAmplitude = clamp(ensureNumber(config?.surface_wave_amplitude, 0.055), 0, 0.2);
  const waveFrequency = clamp(ensureNumber(config?.surface_wave_frequency, 0.045), 0.005, 0.15);
  const baseWeight = Number((1 - particleJitter - waveAmplitude).toFixed(4));
  const cellColumn = `floor(X/${size})`;
  const cellRow = `floor(Y/${size})`;
  const cellX = `${cellColumn}*${size}`;
  const cellY = `${cellRow}*${size}`;
  const risingFill = `(H-1-${cellY})/max(1,H-1)`;
  const wavePhase = Number((((hashSeed(`${seed}:fluid-wave`) % 6284) / 1000)).toFixed(3));
  const surfaceWave = `(sin((${cellX})*${waveFrequency}+${wavePhase})+1)/2`;
  const particleOrder = buildHashExpression(`${cellColumn}*331+${cellRow}*521`, seed, 67);
  return `clip((${risingFill})*${baseWeight}+(${surfaceWave})*${waveAmplitude}+(${particleOrder})*${particleJitter},0,1)`;
}

function buildFluidFillMask(progress, seed, config) {
  return `lte(${buildFluidFillThresholdExpression(seed, config)},${progress})`;
}

const MASK_BUILDERS = Object.freeze({
  spiral: buildSpiralMask,
  diamond: buildDiamondMask,
  cross: buildCrossMask,
  edge_particles: buildEdgeParticleMask,
  diagonal_particles: buildDiagonalParticleMask,
  square_spiral: buildSquareSpiralMask,
  square_spiral_inward: buildSquareSpiralInwardMask,
  fluid_fill: buildFluidFillMask,
});

function calculateDiamondScore({ x, y, width, height }, seed, config) {
  const origin = resolveDiamondOrigin(seed, config);
  const normalizedX = x / Math.max(1, width - 1);
  const normalizedY = y / Math.max(1, height - 1);
  const maximumDistance = Math.max(
    origin.x + origin.y,
    origin.x + (1 - origin.y),
    (1 - origin.x) + origin.y,
    (1 - origin.x) + (1 - origin.y),
  );
  const distance = (Math.abs(normalizedX - origin.x) + Math.abs(normalizedY - origin.y))
    / maximumDistance;
  return 1 - distance;
}

function calculateParticleCell(point, seed, config, mode) {
  const size = Math.max(3, Math.round(ensureNumber(config?.particle_size_px, 10)));
  const cellX = Math.floor(point.x / size);
  const cellY = Math.floor(point.y / size);
  const normalizedX = (cellX * size) / Math.max(1, point.width - 1);
  const normalizedY = (cellY * size) / Math.max(1, point.height - 1);
  if (mode === 'edge') {
    const jitter = clamp(ensureNumber(config?.edge_jitter, 0.22), 0, 0.55);
    const edgeDistance = Math.min(
      normalizedX,
      1 - normalizedX,
      normalizedY,
      1 - normalizedY,
    ) * 2;
    return clamp(
      (edgeDistance * (1 - jitter))
        + (buildHashValue((cellX * 271) + (cellY * 487), seed, 59) * jitter),
      0,
      1,
    );
  }
  const jitter = clamp(ensureNumber(config?.path_jitter, 0.2), 0, 0.55);
  const direction = normalizeDiagonalDirection(config?.direction);
  const diagonalPosition = {
    top_left_to_bottom_right: (normalizedX + normalizedY) / 2,
    bottom_right_to_top_left: ((1 - normalizedX) + (1 - normalizedY)) / 2,
    top_right_to_bottom_left: ((1 - normalizedX) + normalizedY) / 2,
    bottom_left_to_top_right: (normalizedX + (1 - normalizedY)) / 2,
  }[direction];
  return clamp(
    (diagonalPosition * (1 - jitter))
      + (buildHashValue((cellX * 307) + (cellY * 503), seed, 61) * jitter),
    0,
    1,
  );
}

function calculateSquareSpiralScore(point, seed, config) {
  const turns = clamp(ensureNumber(config?.turns, 3), 1, 7);
  const radialWeight = clamp(ensureNumber(config?.radial_weight, 0.62), 0.3, 0.85);
  const x = (point.x / Math.max(1, point.width - 1)) - 0.5;
  const y = (point.y / Math.max(1, point.height - 1)) - 0.5;
  const radius = Math.max(Math.abs(x), Math.abs(y));
  let squarePhase = 0;
  if (radius > 0) {
    if (y <= -Math.abs(x)) squarePhase = ((x / radius) + 1) / 8;
    else if (x >= Math.abs(y)) squarePhase = 0.25 + (((y / radius) + 1) / 8);
    else if (y >= Math.abs(x)) squarePhase = 0.5 + ((1 - (x / radius)) / 8);
    else squarePhase = 0.75 + ((1 - (y / radius)) / 8);
  }
  const squareRadius = radius * 2;
  const phaseOffset = hashSeed(`${seed}:square-spiral`) / 4294967295;
  return clamp(
    (squareRadius * radialWeight)
      + (((squarePhase + (squareRadius * turns) + phaseOffset) % 1) * (1 - radialWeight)),
    0,
    1,
  );
}

function calculateFluidFillScore(point, seed, config) {
  const size = Math.max(3, Math.round(ensureNumber(config?.particle_size_px, 8)));
  const particleJitter = clamp(ensureNumber(config?.particle_jitter, 0.16), 0, 0.4);
  const waveAmplitude = clamp(ensureNumber(config?.surface_wave_amplitude, 0.055), 0, 0.2);
  const waveFrequency = clamp(ensureNumber(config?.surface_wave_frequency, 0.045), 0.005, 0.15);
  const cellColumn = Math.floor(point.x / size);
  const cellRow = Math.floor(point.y / size);
  const cellX = cellColumn * size;
  const cellY = cellRow * size;
  const risingFill = (point.height - 1 - cellY) / Math.max(1, point.height - 1);
  const wavePhase = (hashSeed(`${seed}:fluid-wave`) % 6284) / 1000;
  const surfaceWave = (Math.sin((cellX * waveFrequency) + wavePhase) + 1) / 2;
  const particleOrder = buildHashValue((cellColumn * 331) + (cellRow * 521), seed, 67);
  return clamp(
    (risingFill * (1 - particleJitter - waveAmplitude))
      + (surfaceWave * waveAmplitude)
      + (particleOrder * particleJitter),
    0,
    1,
  );
}

export function buildAdditionalProgressiveRevealMask(method, progress, seed, config = {}) {
  return MASK_BUILDERS[method]?.(progress, seed, config) || null;
}

export function calculateAdditionalProgressiveRevealScore(method, point, seed, config = {}) {
  if (method === 'spiral') {
    const turns = clamp(ensureNumber(config?.turns, 2.75), 0.75, 6);
    const radialWeight = clamp(ensureNumber(config?.radial_weight, 0.58), 0.25, 0.8);
    const radius = Math.sqrt((((point.x - (point.width / 2)) / (point.width / 2)) ** 2)
      + (((point.y - (point.height / 2)) / (point.height / 2)) ** 2)) / Math.SQRT2;
    const angle = (Math.atan2(point.y - (point.height / 2), point.x - (point.width / 2)) + Math.PI)
      / (2 * Math.PI);
    const phase = hashSeed(`${seed}:spiral`) / 4294967295;
    return clamp((radius * radialWeight)
      + (((angle + (radius * turns) + phase) % 1) * (1 - radialWeight)), 0, 1);
  }
  if (method === 'diamond') return calculateDiamondScore(point, seed, config);
  if (method === 'cross') {
    const cornerWeight = clamp(ensureNumber(config?.corner_fill_ratio, 0.18), 0.05, 0.45);
    const xDistance = Math.abs((point.x / Math.max(1, point.width - 1)) - 0.5) * 2;
    const yDistance = Math.abs((point.y / Math.max(1, point.height - 1)) - 0.5) * 2;
    return (Math.min(xDistance, yDistance) * (1 - cornerWeight))
      + (Math.max(xDistance, yDistance) * cornerWeight);
  }
  if (method === 'edge_particles') return calculateParticleCell(point, seed, config, 'edge');
  if (method === 'diagonal_particles') return calculateParticleCell(point, seed, config, 'diagonal');
  if (method === 'square_spiral') return calculateSquareSpiralScore(point, seed, config);
  if (method === 'square_spiral_inward') {
    return 1 - calculateSquareSpiralScore(point, seed, config);
  }
  if (method === 'fluid_fill') return calculateFluidFillScore(point, seed, config);
  return null;
}
