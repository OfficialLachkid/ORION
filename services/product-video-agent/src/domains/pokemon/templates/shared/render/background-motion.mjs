import { ensureNumber } from '../../dual-type-reveal/render/constants.mjs';

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'background-motion')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveSeededPhase(seed, axis) {
  const ratio = hashSeed(`${seed || 'background-motion'}:${axis}`) / 4294967296;
  return Number((ratio * Math.PI * 2).toFixed(6));
}

function fixed(value, digits = 6) {
  return Number(Number(value || 0).toFixed(digits));
}

function buildMaximumWithoutCommaExpression(valueExpression, minimumValue) {
  const minimum = fixed(minimumValue);
  return `((${valueExpression})+${minimum}+abs((${valueExpression})-${minimum}))/2`;
}

export function calculatePanCycleSeconds({
  travelDistancePx,
  speedPxPerSecond,
  minimumCycleSeconds,
}) {
  const distance = Math.max(0, ensureNumber(travelDistancePx, 0));
  const speed = Math.max(0, ensureNumber(speedPxPerSecond, 0));
  const minimumCycle = Math.max(4, ensureNumber(minimumCycleSeconds, 18));
  if (speed === 0 || distance === 0) return minimumCycle;
  return Math.max(minimumCycle, (Math.PI * distance) / speed);
}

export function buildBackgroundPreparationFilter({
  inputRef,
  width,
  height,
  fps,
  blurSigma,
  template,
  seed = 'background-motion',
}) {
  const motionConfig = template?.layout?.background?.motion || {};
  const motionEnabled = motionConfig?.enabled === true;
  const safeBlurSigma = Math.max(0, ensureNumber(blurSigma, 0));
  const blurFilter = safeBlurSigma > 0
    ? `,gblur=sigma=${Number(safeBlurSigma.toFixed(3))}`
    : '';

  if (!motionEnabled) {
    return `[${inputRef}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${blurFilter},fps=${fps},setsar=1`;
  }

  const zoomScale = Math.max(1.01, ensureNumber(motionConfig.zoom_scale, 1.12));
  const subpixelScale = Math.max(
    1,
    Math.min(3, Math.round(ensureNumber(motionConfig.subpixel_scale, 1))),
  );
  const minimumPanCycleSeconds = Math.max(
    4,
    ensureNumber(
      motionConfig.minimum_pan_cycle_seconds,
      ensureNumber(motionConfig.pan_cycle_seconds, 18),
    ),
  );
  const horizontalSpeedPxPerSecond = Math.max(
    0,
    ensureNumber(motionConfig.pan_speed_px_per_second, 22),
  );
  const verticalSpeedPxPerSecond = Math.max(
    0,
    ensureNumber(motionConfig.vertical_pan_speed_px_per_second, 16),
  );
  const verticalPanRatio = Math.max(
    0,
    Math.min(1, ensureNumber(motionConfig.vertical_pan_ratio, 0.72)),
  );
  const outputWidth = width * subpixelScale;
  const outputHeight = height * subpixelScale;
  const scaledWidth = Math.ceil(width * zoomScale * subpixelScale);
  const scaledHeight = Math.ceil(height * zoomScale * subpixelScale);
  const horizontalTravelExpression = `iw-${outputWidth}`;
  const verticalTravelExpression = `(ih-${outputHeight})*${fixed(verticalPanRatio)}`;
  const horizontalSpeed = horizontalSpeedPxPerSecond * subpixelScale;
  const verticalSpeed = verticalSpeedPxPerSecond * subpixelScale;
  // For a sine sweep, peak speed is travelDistance * angularSpeed / 2.
  // Deriving angular speed from the post-cover overflow caps visible speed
  // while allowing wide or tall sources to take longer to reach their edges.
  const horizontalMinimumTravel = (horizontalSpeed * minimumPanCycleSeconds) / Math.PI;
  const verticalMinimumTravel = (verticalSpeed * minimumPanCycleSeconds) / Math.PI;
  const horizontalDenominator = buildMaximumWithoutCommaExpression(
    horizontalTravelExpression,
    horizontalMinimumTravel,
  );
  const verticalDenominator = buildMaximumWithoutCommaExpression(
    verticalTravelExpression,
    verticalMinimumTravel,
  );
  const horizontalAngularSpeed = horizontalSpeed > 0
    ? `(${fixed(horizontalSpeed * 2)}/${horizontalDenominator})`
    : '0';
  const verticalAngularSpeed = verticalSpeed > 0 && verticalPanRatio > 0
    ? `(${fixed(verticalSpeed * 2)}/${verticalDenominator})`
    : '0';
  const horizontalPhase = resolveSeededPhase(seed, 'x');
  const verticalPhase = resolveSeededPhase(seed, 'y');
  const xExpression = `(${horizontalTravelExpression})*(0.5+0.5*sin(t*${horizontalAngularSpeed}+${horizontalPhase}))`;
  const yExpression = `((ih-${outputHeight})-${verticalTravelExpression})/2+(${verticalTravelExpression})*(0.5+0.5*cos(t*${verticalAngularSpeed}+${verticalPhase}))`;
  const subpixelDownscaleFilter = subpixelScale > 1
    ? `,scale=${width}:${height}:flags=lanczos`
    : '';

  return `[${inputRef}:v]fps=${fps},scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=w=${outputWidth}:h=${outputHeight}:x='${xExpression}':y='${yExpression}'${subpixelDownscaleFilter}${blurFilter},setsar=1`;
}
