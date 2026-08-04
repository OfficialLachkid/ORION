import {
  DEFAULT_TYPE_ICON_HOOK_SCALE_MULTIPLIER,
  DEFAULT_TYPE_ICON_HOOK_Y,
  DEFAULT_TYPE_ICON_Y,
  ensureNumber,
} from './constants.mjs';

export function buildTypeIconLayout(template, count = 2) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const spacing = ensureNumber(template?.layout?.type_icons?.spacing_px, 28);
  const iconSize = ensureNumber(template?.layout?.type_icons?.icon_size_px, 168);
  const totalWidth = (count * iconSize) + (Math.max(0, count - 1) * spacing);
  const startX = Math.floor((canvasWidth - totalWidth) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index * (iconSize + spacing)),
    y: DEFAULT_TYPE_ICON_Y,
    width: iconSize,
    height: iconSize,
  }));
}

export function buildHookTypeIconLayout(template, count = 2) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const baseSpacing = ensureNumber(template?.layout?.type_icons?.spacing_px, 28);
  const iconSize = Math.round(
    ensureNumber(template?.layout?.type_icons?.icon_size_px, 168) * DEFAULT_TYPE_ICON_HOOK_SCALE_MULTIPLIER,
  );
  const spacing = Math.max(60, Math.round(baseSpacing * 1.35));
  const totalWidth = (count * iconSize) + (Math.max(0, count - 1) * spacing);
  const startX = Math.floor((canvasWidth - totalWidth) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index * (iconSize + spacing)),
    y: DEFAULT_TYPE_ICON_HOOK_Y,
    width: iconSize,
    height: iconSize,
  }));
}

export function normalizeGridLayout(gridLayout, template) {
  const source = gridLayout || {};
  const itemSize = ensureNumber(
    source.item_size_px,
    ensureNumber(template?.layout?.pokeball_grid?.item_size_px, 180),
  );
  const cells = Array.isArray(source.cells)
    ? source.cells.map((cell, index) => {
      const x = ensureNumber(cell?.x, 0);
      const y = ensureNumber(cell?.y, 0);
      const width = ensureNumber(cell?.width, itemSize);
      const height = ensureNumber(cell?.height, itemSize);
      return {
        ...cell,
        index: Number.isFinite(Number(cell?.index)) ? Number(cell.index) : index,
        x,
        y,
        width,
        height,
        center_x: ensureNumber(cell?.center_x, x + Math.floor(width / 2)),
        center_y: ensureNumber(cell?.center_y, y + Math.floor(height / 2)),
      };
    })
    : [];

  return {
    ...source,
    item_size_px: itemSize,
    item_count: Math.max(0, Math.floor(ensureNumber(source.item_count, cells.length))),
    columns: Math.max(0, Math.floor(ensureNumber(source.columns, 0))),
    rows: Math.max(0, Math.floor(ensureNumber(source.rows, 0))),
    cells,
  };
}
