export function buildNormalAndPixelBackgroundPool(inventory = {}) {
  const candidates = [
    ...(Array.isArray(inventory?.backgrounds) ? inventory.backgrounds : []),
    ...(Array.isArray(inventory?.pixel_backgrounds) ? inventory.pixel_backgrounds : []),
  ];
  const seen = new Set();
  const pool = [];
  for (const candidate of candidates) {
    const path = String(candidate || '').trim();
    const key = path.toLowerCase();
    if (!path || seen.has(key)) continue;
    seen.add(key);
    pool.push(path);
  }
  return pool;
}
