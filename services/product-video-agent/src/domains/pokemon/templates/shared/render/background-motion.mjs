import { ensureNumber } from '../../dual-type-reveal/render/constants.mjs';

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'background-motion')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveSeededTravelPhase(seed, axis) {
  const ratio = hashSeed(`${seed || 'background-motion'}:${axis}`) / 4294967296;
  return Number((ratio * 2).toFixed(6));
}

function fixed(value, digits = 6) {
  return Number(Number(value || 0).toFixed(digits));
}

function buildMinimumWithoutCommaExpression(valueExpression, maximumValue) {
  const maximum = fixed(maximumValue);
  return `((${valueExpression})+${maximum}-abs((${valueExpression})-${maximum}))/2`;
}

function buildPingPongExpression({
  travelExpression,
  speedExpression,
  phase,
}) {
  const offsetExpression = `((${travelExpression})*${fixed(phase)}+t*(${speedExpression}))`;
  const cycleExpression = `(2*(${travelExpression}))`;
  const wrappedExpression = `(${offsetExpression}-${cycleExpression}*floor(${offsetExpression}/${cycleExpression}))`;
  return `((${travelExpression})-abs(${wrappedExpression}-(${travelExpression})))`;
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
  return Math.max(minimumCycle, (2 * distance) / speed);
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
  // Move at a constant output-space speed and reflect at the source edges.
  // The minimum-cycle limit only slows backgrounds with very little overflow;
  // wide and tall sources retain the configured speed instead of receiving a
  // very long sine wave that can appear stationary near its turning points.
  const horizontalCycleLimitedSpeed = `(2*(${horizontalTravelExpression}))/${fixed(minimumPanCycleSeconds)}`;
  const verticalCycleLimitedSpeed = `(2*(${verticalTravelExpression}))/${fixed(minimumPanCycleSeconds)}`;
  const horizontalEffectiveSpeed = buildMinimumWithoutCommaExpression(
    horizontalCycleLimitedSpeed,
    horizontalSpeed,
  );
  const verticalEffectiveSpeed = buildMinimumWithoutCommaExpression(
    verticalCycleLimitedSpeed,
    verticalSpeed,
  );
  const horizontalPhase = resolveSeededTravelPhase(seed, 'x');
  const verticalPhase = resolveSeededTravelPhase(seed, 'y');
  const xExpression = horizontalSpeed > 0
    ? buildPingPongExpression({
      travelExpression: horizontalTravelExpression,
      speedExpression: horizontalEffectiveSpeed,
      phase: horizontalPhase,
    })
    : `(${horizontalTravelExpression})/2`;
  const verticalMotionExpression = verticalSpeed > 0 && verticalPanRatio > 0
    ? buildPingPongExpression({
      travelExpression: verticalTravelExpression,
      speedExpression: verticalEffectiveSpeed,
      phase: verticalPhase,
    })
    : `(${verticalTravelExpression})/2`;
  const yExpression = `((ih-${outputHeight})-${verticalTravelExpression})/2+${verticalMotionExpression}`;
  const subpixelDownscaleFilter = subpixelScale > 1
    ? `,scale=${width}:${height}:flags=lanczos`
    : '';

  return `[${inputRef}:v]fps=${fps},scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=w=${outputWidth}:h=${outputHeight}:x='${xExpression}':y='${yExpression}'${subpixelDownscaleFilter}${blurFilter},setsar=1`;
}
