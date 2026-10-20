import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { writeAnimatedGifPreview } from './effect-pilot.mjs';

const WIDTH = 960;
const HEIGHT = 540;
const COVER_WIDTH = 630;
const COVER_HEIGHT = 500;
const COLORS = Object.freeze({
  background: '#9bafc5',
  backgroundLight: '#b7c5d4',
  panel: '#172538',
  panelSoft: '#263a52',
  text: '#f8fbff',
  ink: '#111b29',
  cyan: '#20d8f4',
  violet: '#7d6cf2',
});

export const EXPANSION_RELEASE_MARKETING_VERSION = '1.2.0';

const WEAPON_COVER_FRAME_COUNT = 4;
const EXPANSION_COVER_FRAME_COUNT = 12;
const COVER_FRAME_COUNT = WEAPON_COVER_FRAME_COUNT + EXPANSION_COVER_FRAME_COUNT;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function protectionText(x, y, size = 18) {
  return `<text x="${x}" y="${y}" text-anchor="middle" fill="#ffffff" fill-opacity="0.34" stroke="#0c1520" stroke-opacity="0.62" stroke-width="1" font-family="Arial, sans-serif" font-size="${size}" font-weight="800" transform="rotate(-14 ${x} ${y})">PREVIEW</text>`;
}

function shell({ width, height, title, subtitle, titleSize = 40 }) {
  return [
    `<rect width="${width}" height="${height}" fill="${COLORS.background}"/>`,
    `<path d="M0 ${height - 92} L${width} ${height - 170} L${width} ${height} L0 ${height} Z" fill="${COLORS.backgroundLight}" fill-opacity="0.72"/>`,
    `<rect x="18" y="18" width="${width - 36}" height="104" rx="18" fill="${COLORS.panel}" stroke="${COLORS.cyan}" stroke-width="3"/>`,
    `<rect x="34" y="34" width="10" height="72" rx="5" fill="${COLORS.violet}"/>`,
    `<text x="${width / 2}" y="67" text-anchor="middle" fill="${COLORS.text}" stroke="#09111c" stroke-width="4" paint-order="stroke" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="900" letter-spacing="1">${escapeXml(title.toUpperCase())}</text>`,
    `<text x="${width / 2}" y="100" text-anchor="middle" fill="${COLORS.cyan}" stroke="#09111c" stroke-width="2" paint-order="stroke" font-family="Arial, sans-serif" font-size="18" font-weight="800">${escapeXml(subtitle.toUpperCase())}</text>`,
  ].join('');
}

async function contained(buffer, width, height) {
  return sharp(buffer).resize(width, height, {
    fit: 'contain',
    kernel: sharp.kernel.nearest,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).ensureAlpha().png().toBuffer();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function animationFramePaths(asset, animation) {
  const prefix = `animations/${asset.asset_key}/frames/${animation.animation_key}/`;
  return (asset.runtime_paths || [])
    .filter((path) => path.startsWith(prefix) && path.endsWith('.png'))
    .sort();
}

export function selectLifecyclePreviewPath(asset, frameIndex, frameCount) {
  const animations = (asset.animations || [])
    .map((animation) => ({ animation, paths: animationFramePaths(asset, animation) }))
    .filter(({ paths }) => paths.length);
  if (animations.length) {
    const count = Math.max(1, Number(frameCount) || 1);
    const index = Math.max(0, Math.min(count - 1, Number(frameIndex) || 0));
    const animationIndex = Math.min(
      animations.length - 1,
      Math.floor((index * animations.length) / count),
    );
    const start = Math.ceil((animationIndex * count) / animations.length);
    const end = Math.ceil(((animationIndex + 1) * count) / animations.length);
    const slots = Math.max(1, end - start);
    const progress = slots === 1 ? 0.5 : (index - start) / (slots - 1);
    const paths = animations[animationIndex].paths;
    return paths[Math.min(paths.length - 1, Math.round(progress * (paths.length - 1)))];
  }
  const states = (asset.states || [])
    .map((state) => state.path)
    .filter((path) => (asset.runtime_paths || []).includes(path));
  if (states.length) {
    const count = Math.max(1, Number(frameCount) || 1);
    const index = Math.max(0, Math.min(count - 1, Number(frameIndex) || 0));
    return states[Math.min(states.length - 1, Math.floor((index * states.length) / count))];
  }
  return asset.buyer_path;
}

export function selectCoverLifecyclePreviewPath(asset, frameIndex, frameCount) {
  if ((Number(frameIndex) || 0) === 0) return asset.buyer_path;
  return selectLifecyclePreviewPath(
    asset,
    (Number(frameIndex) || 0) - 1,
    Math.max(1, (Number(frameCount) || 1) - 1),
  );
}

async function effectSample(candidateRoot, assetKey, kind, preferredFrame) {
  const root = resolve(candidateRoot, 'download', 'effects', assetKey, kind);
  const metadata = await readOptionalJson(resolve(root, 'animation.json'));
  if (!metadata?.frames?.length || !metadata.origin) return null;
  const frame = metadata.frames[Math.min(preferredFrame, metadata.frames.length - 1)];
  return {
    buffer: await readFile(resolve(root, frame.path)),
    origin: metadata.origin,
    canvas: metadata.canvas,
  };
}

export function weaponEffectPhase(frameIndex) {
  return ['weapon', 'muzzle_flash', 'projectile', 'impact_decay'][
    Math.max(0, Number(frameIndex) || 0) % 4
  ];
}

async function weaponLifecycleBuffer(candidateRoot, asset, anchor, frameIndex) {
  const weapon = await readFile(resolve(
    candidateRoot, 'download', 'assets', 'individual', basename(asset.final_path),
  ));
  if (!anchor) return weapon;
  const phase = weaponEffectPhase(frameIndex);
  const width = 184;
  const height = 96;
  const weaponTop = 32;
  const composites = [{ input: weapon, left: 0, top: weaponTop }];
  const render = () => sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  if (phase === 'weapon') return render();
  const [muzzle, projectile, impact] = await Promise.all([
    effectSample(candidateRoot, asset.asset_key, 'muzzle_flash', 2),
    effectSample(candidateRoot, asset.asset_key, 'projectile', 0),
    effectSample(candidateRoot, asset.asset_key, 'impact_decay', 2),
  ]);
  if (!muzzle || !projectile || !impact) return render();
  if (phase === 'muzzle_flash' || phase === 'projectile') {
    composites.push({
      input: muzzle.buffer,
      left: anchor.x - muzzle.origin.x,
      top: weaponTop + anchor.y - muzzle.origin.y,
    });
  }
  if (phase === 'projectile') {
    composites.push({
      input: projectile.buffer,
      left: anchor.x + 18 - projectile.origin.x,
      top: weaponTop + anchor.y - projectile.origin.y,
    });
  }
  if (phase === 'impact_decay') {
    composites.push({
      input: impact.buffer,
      left: width - ((impact.canvas?.width || 64) - impact.origin.x),
      top: weaponTop + anchor.y - impact.origin.y,
    });
  }
  return render();
}

async function weaponEntries(candidateRoot, product, frameIndex = 0) {
  const anchors = await readOptionalJson(resolve(
    candidateRoot, 'download', 'effects', 'weapon-anchors.json',
  ));
  const anchorByKey = new Map((anchors?.weapons || []).map((item) => [
    item.source_asset_key,
    item.muzzle_anchor,
  ]));
  return Promise.all(product.assets.map(async (asset) => ({
    asset_key: asset.asset_key,
    name: asset.name,
    group: 'weapons',
    buffer: await weaponLifecycleBuffer(
      candidateRoot,
      asset,
      anchorByKey.get(asset.asset_key),
      frameIndex,
    ),
  })));
}

async function expansionEntries(
  candidateRoot,
  expansionAssets,
  frameIndex = null,
  frameCount = null,
  selector = selectLifecyclePreviewPath,
) {
  return Promise.all(expansionAssets.map(async (asset) => {
    const selected = frameIndex === null
      ? asset.buyer_path
      : selector(asset, frameIndex, frameCount);
    return {
      asset_key: asset.asset_key,
      name: asset.name,
      group: asset.buyer_group,
      buffer: await readFile(resolve(candidateRoot, 'download', selected)),
    };
  }));
}

async function gridImage({ width, height, title, subtitle, entries, columns, top = 138, footer }) {
  const left = 28;
  const gap = 10;
  const rows = Math.ceil(entries.length / columns);
  const usableWidth = width - (left * 2);
  const cellWidth = Math.floor((usableWidth - ((columns - 1) * gap)) / columns);
  const bottom = 38;
  const cellHeight = Math.floor((height - top - bottom - ((rows - 1) * gap)) / rows);
  const composites = [];
  const cards = [];
  const watermarks = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const x = left + ((index % columns) * (cellWidth + gap));
    const y = top + (Math.floor(index / columns) * (cellHeight + gap));
    const imageHeight = Math.max(36, cellHeight - 34);
    composites.push({
      input: await contained(entry.buffer, cellWidth - 18, imageHeight),
      left: x + 9,
      top: y + 5,
    });
    cards.push(
      `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="11" fill="${COLORS.panel}" stroke="#405b78" stroke-width="2"/>`,
      `<text x="${x + (cellWidth / 2)}" y="${y + cellHeight - 10}" text-anchor="middle" fill="${COLORS.text}" font-family="Arial, sans-serif" font-size="${Math.min(14, Math.max(10, Math.floor(175 / entry.name.length)))}" font-weight="700">${escapeXml(entry.name)}</text>`,
    );
    watermarks.push(protectionText(x + (cellWidth / 2), y + (cellHeight / 2), Math.min(22, cellWidth / 7)));
  }
  const background = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    shell({
      width,
      height,
      title,
      subtitle,
      titleSize: title.length > 26
        ? 30
        : Math.max(24, Math.min(width < 700 ? 35 : 40, Math.floor((width - 90) / (title.length * 0.62)))),
    }),
    ...cards,
    `<text x="${width - 28}" y="${height - 13}" text-anchor="end" fill="${COLORS.ink}" font-family="Arial, sans-serif" font-size="12" font-weight="800">${escapeXml(footer)}</text>`,
    '</svg>',
  ].join(''));
  const protection = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    ...watermarks,
    '</svg>',
  ].join(''));
  return sharp({ create: { width, height, channels: 3, background: COLORS.background } })
    .composite([{ input: background }, ...composites, { input: protection }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export function coverScene(frameIndex) {
  const index = Math.max(0, Math.min(COVER_FRAME_COUNT - 1, Number(frameIndex) || 0));
  if (index < WEAPON_COVER_FRAME_COUNT) {
    return {
      kind: 'weapons',
      frame_index: index,
      frame_count: WEAPON_COVER_FRAME_COUNT,
    };
  }
  return {
    kind: 'expansion',
    frame_index: index - WEAPON_COVER_FRAME_COUNT,
    frame_count: EXPANSION_COVER_FRAME_COUNT,
  };
}

async function buildAnimatedGrid({ tempRoot, outputPath, frameFactory, frameCount, delayMs }) {
  const framePaths = [];
  for (let index = 0; index < frameCount; index += 1) {
    const path = resolve(tempRoot, `${basename(outputPath)}-${String(index).padStart(2, '0')}.png`);
    await writeFile(path, await frameFactory(index));
    framePaths.push(path);
  }
  await writeAnimatedGifPreview({
    framePaths,
    delays: framePaths.map(() => delayMs),
    outputPath,
  });
  return framePaths[0];
}

export async function buildExpansionReleaseMarketingMedia(options) {
  const firstExpansion = await expansionEntries(options.candidateRoot, options.expansionAssets);
  const tempRoot = await mkdtemp(join(tmpdir(), 'orion-expansion-marketing-'));
  const files = {
    cover: 'cover.gif',
    coverStill: 'cover-still.png',
    expansion: 'armory-items-and-vfx.png',
    montage: 'interactive-expansion-montage.gif',
  };
  try {
    const coverFirstFrame = await buildAnimatedGrid({
      tempRoot,
      outputPath: resolve(options.candidateRoot, files.cover),
      frameCount: COVER_FRAME_COUNT,
      delayMs: 420,
      frameFactory: async (frameIndex) => {
        const scene = coverScene(frameIndex);
        const entries = scene.kind === 'weapons'
          ? await weaponEntries(options.candidateRoot, options.product, scene.frame_index)
          : await expansionEntries(
            options.candidateRoot,
            options.expansionAssets,
            scene.frame_index,
            scene.frame_count,
            selectCoverLifecyclePreviewPath,
          );
        return gridImage({
          width: COVER_WIDTH,
          height: COVER_HEIGHT,
          title: options.product.title,
          subtitle: scene.kind === 'weapons'
            ? '8 weapons with independent firing effects'
            : 'Armory items, props & interactive plasma VFX',
          entries,
          columns: 4,
          footer: `VERSION ${options.version} · ANIMATED PREVIEW`,
        });
      },
    });
    await writeFile(resolve(options.candidateRoot, files.coverStill), await readFile(coverFirstFrame));
    await writeFile(resolve(options.candidateRoot, files.expansion), await gridImage({
      width: WIDTH,
      height: HEIGHT,
      title: 'Armory Items & Interactive VFX',
      subtitle: 'Transparent states, fixed-anchor frames, sheets & metadata',
      entries: firstExpansion,
      columns: 4,
      footer: 'CLEAN TRANSPARENT RUNTIME FILES INCLUDED IN DOWNLOAD',
    }));
    await buildAnimatedGrid({
      tempRoot,
      outputPath: resolve(options.candidateRoot, files.montage),
      frameCount: 12,
      delayMs: 260,
      frameFactory: async (frameIndex) => gridImage({
        width: WIDTH,
        height: HEIGHT,
        title: 'Interactive States & VFX',
        subtitle: 'Representative buyer-runtime frames · zero root motion',
        entries: await expansionEntries(options.candidateRoot, options.expansionAssets, frameIndex, 12),
        columns: 4,
        footer: 'VBJSERVICES · PROTECTED ANIMATED PREVIEW',
      }),
    });
    return {
      cover_path: files.cover,
      cover_fallback_path: files.coverStill,
      screenshot_paths: [
        ...(options.inheritedScreenshotPaths || []),
        files.expansion,
        files.montage,
      ],
      palette: COLORS,
      motion: {
        cover_frame_count: COVER_FRAME_COUNT,
        cover_frame_delay_ms: 420,
        rapid_flashing: false,
        cover_sequence: ['weapons', 'expansion'],
        mixed_asset_families_per_frame: false,
        weapon_effect_phases: ['weapon', 'muzzle_flash', 'projectile', 'impact_decay'],
        expansion_sampling: 'declared_animation_lifecycle',
      },
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
