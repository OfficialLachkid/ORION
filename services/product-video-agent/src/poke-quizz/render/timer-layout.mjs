import {
  DEFAULT_TIMER_SCALE_MULTIPLIER,
  DEFAULT_TIMER_SIZE,
  DEFAULT_TYPE_ICON_Y,
  ensureNumber,
} from './constants.mjs';

export function buildTimerLayout(template, gridLayout = null) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const safeZone = template?.canvas?.safe_zone || {};
  const safeTop = ensureNumber(safeZone.top, 160);
  const safeBottom = ensureNumber(safeZone.bottom, 160);
  const iconSize = ensureNumber(template?.layout?.type_icons?.icon_size_px, 168);
  const gridItemSize = ensureNumber(
    gridLayout?.item_size_px,
    ensureNumber(template?.layout?.pokeball_grid?.item_size_px, 240),
  );
  const gridTop = ensureNumber(
    gridLayout?.stage_bounds_px?.top,
    ensureNumber(template?.layout?.pokeball_grid?.stage_bounds_px?.top, 760),
  );
  const timerZoneTop = Math.max(safeTop, DEFAULT_TYPE_ICON_Y + iconSize + 24);
  const timerZoneBottom = Math.min(
    gridTop - 24,
    ensureNumber(template?.canvas?.height, 1920) - safeBottom,
  );
  const timerZoneHeight = Math.max(180, timerZoneBottom - timerZoneTop);
  const preferredSize = Math.round(Math.max(DEFAULT_TIMER_SIZE, gridItemSize) * DEFAULT_TIMER_SCALE_MULTIPLIER);
  const size = Math.min(preferredSize, timerZoneHeight);
  const left = Math.max(24, Math.floor((canvasWidth - size) / 2));
  const top = timerZoneTop + Math.max(0, Math.floor((timerZoneHeight - size) / 2));
  return {
    x: left,
    y: top,
    width: size,
    height: size,
    number_center_x: left + Math.floor(size / 2),
    number_center_y: top + Math.floor(size / 2),
  };
}
