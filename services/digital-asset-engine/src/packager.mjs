import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { CanonicalProductStore } from './canonical-store.mjs';
import { cropVisibleAlpha } from './expansion-release-marketing.mjs';

const COVER_WIDTH = 630;
const COVER_HEIGHT = 500;
const MARKETPLACE_PREVIEW_WIDTH = 960;
const MARKETPLACE_PREVIEW_HEIGHT = 540;
const MAX_ASSETS_PER_MARKETING_IMAGE = 8;
const SHEET_COLUMNS = 4;
const SHEET_PADDING = 16;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function describeAssetCollection(product, candidates) {
  const kinds = [...new Set(candidates.map(({ asset }) => asset.kind))];
  const weaponsOnly = kinds.length === 1 && kinds[0] === 'weapon';
  const identity = `${product.theme} ${product.category} ${product.product_type}`.toLowerCase();
  const arcaneFantasy = /arcane|fantasy|magic|alchemy/iu.test(identity);
  if (weaponsOnly) {
    return {
      weaponsOnly: true,
      coverLabel: `${candidates.length} SIDE-VIEW WEAPON SPRITES`,
      marketplaceLabel: `${candidates.length} INCLUDED SIDE-VIEW SPRITES`,
      collectionName: 'science-fiction weapon sprites',
      shortDescription: `${candidates.length} original side-view sci-fi weapon sprites for 2D games.`,
      viewLines: ['View: strict side view', 'Facing: right-facing side view'],
      technicalLines: ['Strict side-view presentation', 'One supplied direction'],
      tags: ['2D', 'Pixel Art', 'Sci-fi', 'Weapons', 'Sprites'],
    };
  }
  const friendlyKinds = kinds.map((kind) => kind.replaceAll('-', ' '));
  const collectionName = arcaneFantasy
    ? 'arcane fantasy pixel-art items and relics'
    : `${product.theme} pixel-art game assets`;
  return {
    weaponsOnly: false,
    coverLabel: `${candidates.length} PIXEL ART ASSETS`,
    marketplaceLabel: `${candidates.length} INCLUDED PIXEL ART ASSETS`,
    collectionName,
    shortDescription: `${candidates.length} original ${collectionName} for 2D games.`,
    viewLines: [`Presentation: ${product.style.perspective}`, `Asset types: ${friendlyKinds.join(', ')}`],
    technicalLines: [
      'Side, three-quarter, or centered presentation according to asset function',
      `Asset types: ${friendlyKinds.join(', ')}`,
    ],
    tags: arcaneFantasy
      ? ['2D', 'Pixel Art', 'Fantasy', 'Magic', 'Game Assets', 'Inventory', 'Sprites']
      : ['2D', 'Pixel Art', 'Game Assets', 'Props', 'Sprites'],
  };
}

function previewTheme(product) {
  const identity = `${product.theme} ${product.category} ${product.product_type}`.toLowerCase();
  if (/arcane|fantasy|magic|alchemy/iu.test(identity)) {
    return {
      background: '#c9b9d8',
      panel: '#eee6f4',
      card: '#f8f3fb',
      accent: '#7b3eaa',
      border: '#8c73a1',
      title: '#251832',
      label: '#2d1f3b',
      muted: '#554462',
    };
  }
  return {
    background: '#9fb7cc',
    panel: '#dce7f0',
    card: '#eef4f8',
    accent: '#007f9d',
    border: '#63829b',
    title: '#102033',
    label: '#172538',
    muted: '#344b61',
  };
}

export function selectRepresentativeCandidates(candidates, limit = MAX_ASSETS_PER_MARKETING_IMAGE) {
  if (candidates.length <= limit) return [...candidates];
  if (limit <= 1) return [candidates[0]];
  return Array.from({ length: limit }, (_, index) => (
    candidates[Math.round((index * (candidates.length - 1)) / (limit - 1))]
  ));
}

export async function resizePreviewAsset(buffer, width, height) {
  const visible = await cropVisibleAlpha(buffer);
  return sharp(visible)
    .resize(width, height, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

function previewLabelFontSize(value, maximum = 13) {
  return Math.max(9, Math.min(maximum, Math.floor(156 / Math.max(1, String(value).length))));
}

async function loadApprovedCandidates(store, product) {
  const root = store.productRoot(product);
  const candidates = [];
  for (const asset of product.assets) {
    if (asset.status !== 'generated' || !asset.final_path || !asset.validation_path) {
      throw new Error(`Asset ${asset.asset_key} is not a generated candidate.`);
    }
    const [buffer, validationText] = await Promise.all([
      readFile(resolve(root, asset.final_path)),
      readFile(resolve(root, asset.validation_path), 'utf8'),
    ]);
    const validation = JSON.parse(validationText);
    if (validation.status !== 'passed') {
      throw new Error(`Asset ${asset.asset_key} failed automated validation.`);
    }
    candidates.push({ asset, buffer, validation });
  }
  return candidates;
}

async function createSpriteSheet(candidates, product) {
  const columns = Math.min(SHEET_COLUMNS, candidates.length);
  const rows = Math.ceil(candidates.length / SHEET_COLUMNS);
  const cellWidth = product.style.width + (SHEET_PADDING * 2);
  const cellHeight = product.style.height + (SHEET_PADDING * 2);
  const width = cellWidth * columns;
  const height = cellHeight * rows;
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(candidates.map(({ buffer }, index) => ({
    input: buffer,
    left: ((index % SHEET_COLUMNS) * cellWidth) + SHEET_PADDING,
    top: (Math.floor(index / SHEET_COLUMNS) * cellHeight) + SHEET_PADDING,
  }))).png({ compressionLevel: 9 }).toBuffer();
}

export async function createCover(candidates, product) {
  const allCandidates = candidates;
  const shownCandidates = selectRepresentativeCandidates(candidates);
  const collection = describeAssetCollection(product, allCandidates);
  const theme = previewTheme(product);
  const cellWidth = 142;
  const rows = Math.ceil(shownCandidates.length / 4);
  const cellHeight = collection.weaponsOnly && rows <= 2
    ? 142
    : Math.floor(324 / rows);
  const gridLeft = 31;
  const gridTop = collection.weaponsOnly && rows <= 2 ? 112 : 105;
  const assetWidth = collection.weaponsOnly ? 128 : 112;
  const assetHeight = collection.weaponsOnly ? 64 : Math.min(112, cellHeight - 30);
  const composites = [];
  for (let index = 0; index < shownCandidates.length; index += 1) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const scaled = await resizePreviewAsset(shownCandidates[index].buffer, assetWidth, assetHeight);
    composites.push({
      input: scaled,
      left: gridLeft + (column * cellWidth) + Math.floor((cellWidth - assetWidth) / 2),
      top: gridTop + (row * cellHeight) + Math.max(6, Math.floor((cellHeight - assetHeight - 20) / 2)),
    });
  }

  const labels = shownCandidates.map(({ asset }, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = gridLeft + (column * cellWidth) + (cellWidth / 2);
    const y = gridTop + (row * cellHeight) + cellHeight - 8;
    const fontSize = previewLabelFontSize(asset.name);
    return `<text x="${x}" y="${y}" text-anchor="middle" fill="${theme.label}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(asset.name)}</text>`;
  }).join('');
  const coverLabel = shownCandidates.length === allCandidates.length
    ? collection.coverLabel
    : `${allCandidates.length} ASSETS · ${shownCandidates.length} FEATURED`;
  const titleFontSize = Math.max(22, Math.min(38, Math.floor(600 / Math.max(1, product.title.length * 0.6))));
  const overlay = Buffer.from([
    `<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect width="630" height="500" fill="${theme.background}"/>`,
    `<rect x="18" y="18" width="594" height="464" rx="18" fill="${theme.panel}" stroke="${theme.accent}" stroke-width="3"/>`,
    `<text x="315" y="66" text-anchor="middle" fill="${theme.title}" font-family="Arial, sans-serif" font-size="${titleFontSize}" font-weight="700">${escapeXml(product.title.toUpperCase())}</text>`,
    `<text x="315" y="96" text-anchor="middle" fill="${theme.accent}" font-family="Arial, sans-serif" font-size="18" font-weight="800">${escapeXml(coverLabel)}</text>`,
    labels,
    `<text x="315" y="456" text-anchor="middle" fill="${theme.muted}" font-family="Arial, sans-serif" font-size="14">Protected preview · clean transparent PNG files in download · ${product.style.width} × ${product.style.height} px</text>`,
    '</svg>',
  ].join(''));
  const protectionMarks = shownCandidates.map((_, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const centerX = gridLeft + (column * cellWidth) + (cellWidth / 2);
    const centerY = gridTop + (row * cellHeight) + 55;
    return `<text x="${centerX}" y="${centerY}" text-anchor="middle" fill="#ffffff" fill-opacity="0.34" stroke="#10131d" stroke-opacity="0.55" stroke-width="1" font-family="Arial, sans-serif" font-size="15" font-weight="700" transform="rotate(-17 ${centerX} ${centerY})">PREVIEW</text>`;
  }).join('');
  const protectionOverlay = Buffer.from([
    `<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    protectionMarks,
    '</svg>',
  ].join(''));
  return sharp({
    create: { width: COVER_WIDTH, height: COVER_HEIGHT, channels: 3, background: theme.background },
  }).composite([{ input: overlay }, ...composites, { input: protectionOverlay }])
    .flatten({ background: theme.background })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function createMarketplacePreview(candidates, product, options = {}) {
  const allCandidates = options.allCandidates || candidates;
  const collection = describeAssetCollection(product, allCandidates);
  const theme = previewTheme(product);
  const columns = Math.min(4, candidates.length);
  const rows = Math.ceil(candidates.length / columns);
  const gridWidth = 880;
  const gridHeight = 340;
  const cellWidth = Math.floor(gridWidth / columns);
  const cellHeight = Math.floor(gridHeight / rows);
  const gridLeft = 40;
  const gridTop = 126;
  const assetWidth = Math.min(192, cellWidth - 28);
  const assetHeight = Math.min(96, cellHeight - 54);
  const composites = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const scaled = await resizePreviewAsset(candidates[index].buffer, assetWidth, assetHeight);
    composites.push({
      input: scaled,
      left: gridLeft + (column * cellWidth) + Math.floor((cellWidth - assetWidth) / 2),
      top: gridTop + (row * cellHeight) + 18,
    });
  }

  const cells = candidates.map(({ asset }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = gridLeft + (column * cellWidth);
    const top = gridTop + (row * cellHeight);
    const centerX = left + (cellWidth / 2);
    const labelY = top + cellHeight - 18;
    return [
      `<rect x="${left + 5}" y="${top + 5}" width="${cellWidth - 10}" height="${cellHeight - 10}" rx="12" fill="${theme.card}" stroke="${theme.border}"/>`,
      `<text x="${centerX}" y="${labelY}" text-anchor="middle" fill="${theme.label}" font-family="Arial, sans-serif" font-size="${previewLabelFontSize(asset.name, 14)}">${escapeXml(asset.name)}</text>`,
    ].join('');
  }).join('');
  const base = Buffer.from([
    `<svg width="${MARKETPLACE_PREVIEW_WIDTH}" height="${MARKETPLACE_PREVIEW_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect width="100%" height="100%" fill="${theme.background}"/>`,
    `<rect x="20" y="20" width="920" height="500" rx="22" fill="${theme.panel}" stroke="${theme.accent}" stroke-width="2"/>`,
    `<text x="480" y="65" text-anchor="middle" fill="${theme.title}" font-family="Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(product.title.toUpperCase())}</text>`,
    `<text x="480" y="99" text-anchor="middle" fill="${theme.accent}" font-family="Arial, sans-serif" font-size="18" font-weight="800">${escapeXml(options.pageCount > 1 ? `${collection.marketplaceLabel} · PAGE ${options.pageIndex + 1}/${options.pageCount}` : collection.marketplaceLabel)}</text>`,
    cells,
    `<text x="480" y="501" text-anchor="middle" fill="${theme.muted}" font-family="Arial, sans-serif" font-size="14">Protected marketplace preview · clean transparent PNG files are included in the paid download</text>`,
    '</svg>',
  ].join(''));
  const watermarkCells = candidates.map((_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const centerX = gridLeft + (column * cellWidth) + (cellWidth / 2);
    const centerY = gridTop + (row * cellHeight) + Math.floor(cellHeight * 0.46);
    return `<text x="${centerX}" y="${centerY}" text-anchor="middle" fill="#ffffff" fill-opacity="0.36" stroke="#0c1019" stroke-opacity="0.5" stroke-width="1" font-family="Arial, sans-serif" font-size="25" font-weight="700" transform="rotate(-17 ${centerX} ${centerY})">PREVIEW</text>`;
  }).join('');
  const watermark = Buffer.from([
    `<svg width="${MARKETPLACE_PREVIEW_WIDTH}" height="${MARKETPLACE_PREVIEW_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    watermarkCells,
    `<text x="928" y="507" text-anchor="end" fill="${theme.accent}" fill-opacity="0.8" font-family="Arial, sans-serif" font-size="12" font-weight="700">VBJSERVICES</text>`,
    '</svg>',
  ].join(''));

  return sharp({
    create: {
      width: MARKETPLACE_PREVIEW_WIDTH,
      height: MARKETPLACE_PREVIEW_HEIGHT,
      channels: 3,
      background: theme.background,
    },
  }).composite([{ input: base }, ...composites, { input: watermark }])
    .flatten({ background: theme.background })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function packReadme(product, candidates) {
  const collection = describeAssetCollection(product, candidates);
  return [
    `# ${product.title}`,
    '',
    'Internal ORION marketplace-connection preview.',
    '',
    `${candidates.length} original ${collection.collectionName} are included as individual transparent PNG files and one sprite sheet.`,
    '',
    ...collection.viewLines.map((line) => `- ${line}`),
    `- Canvas: ${product.style.width}x${product.style.height} per sprite`,
    `- Palette limit: ${product.style.max_palette_colors} colors`,
    '- Root motion: none',
    '- Generative AI: local model output with deterministic ORION post-processing',
    '',
    'This preview is not approved for public distribution. The included license is a draft.',
    '',
  ].join('\n');
}

function buildItchListing(product, candidates, screenshotPaths = ['marketplace-preview.png']) {
  const collection = describeAssetCollection(product, candidates);
  const assetNames = candidates.map(({ asset }, index) => (
    `${String(index + 1).padStart(2, '0')}. ${asset.name}`
  ));
  const technicalInformation = [
    `${product.style.width}x${product.style.height} pixel canvas per sprite`,
    'Transparent PNG files',
    ...collection.technicalLines,
    'No baked root motion',
    `Palette limited to ${product.style.max_palette_colors} colors`,
  ];
  const description = [
    `${product.title} is a coordinated pack of ${candidates.length} original ${collection.collectionName} for 2D games.`,
    '',
    'Included assets:',
    ...assetNames.map((name) => `- ${name}`),
    '',
    'Technical information:',
    ...technicalInformation.map((line) => `- ${line}`),
  ].join('\n');
  const listing = {
    schema_version: '1.0',
    title: product.title,
    short_description: collection.shortDescription,
    description,
    suggested_price: product.pricing.base_price,
    tags: collection.tags,
    classification: 'assets',
    visibility: 'draft',
    cover_path: 'cover.png',
    // Marketplace media must never reference clean buyer deliverables under download/.
    screenshot_paths: ['cover.png', ...screenshotPaths],
    technical_information: technicalInformation,
    ai_disclosure: 'AI Assisted, Graphics',
  };
  return {
    ...listing,
    listing_hash: sha256(Buffer.from(JSON.stringify(listing))),
  };
}

export async function packageDigitalAssetPreview(options) {
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const candidates = await loadApprovedCandidates(store, product);
  const productRoot = store.productRoot(product);
  const exportRoot = resolve(productRoot, 'exports', 'itch-preview');
  const downloadRoot = resolve(exportRoot, 'download');
  const assetsRoot = resolve(downloadRoot, 'assets', 'individual');
  await mkdir(assetsRoot, { recursive: true });

  const knownFiles = [];
  for (const candidate of candidates) {
    const destination = resolve(assetsRoot, basename(candidate.asset.final_path));
    await copyFile(resolve(productRoot, candidate.asset.final_path), destination);
    knownFiles.push(destination);
  }

  const previewPages = [];
  for (let offset = 0; offset < candidates.length; offset += MAX_ASSETS_PER_MARKETING_IMAGE) {
    previewPages.push(candidates.slice(offset, offset + MAX_ASSETS_PER_MARKETING_IMAGE));
  }
  const marketplacePreviewNames = previewPages.length === 1
    ? ['marketplace-preview.png']
    : previewPages.map((_, index) => `marketplace-preview-${index + 1}.png`);
  const [cover, marketplacePreviews, spriteSheet] = await Promise.all([
    createCover(candidates, product),
    Promise.all(previewPages.map((page, index) => createMarketplacePreview(page, product, {
      allCandidates: candidates,
      pageIndex: index,
      pageCount: previewPages.length,
    }))),
    createSpriteSheet(candidates, product),
  ]);
  const coverPath = resolve(exportRoot, 'cover.png');
  const marketplacePreviewPaths = marketplacePreviewNames.map((name) => resolve(exportRoot, name));
  const marketplacePreviewPath = marketplacePreviewPaths[0];
  const sheetPath = resolve(downloadRoot, 'assets', `${product.slug}-sprite-sheet.png`);
  const readmePath = resolve(downloadRoot, 'README.md');
  const licensePath = resolve(downloadRoot, 'LICENSE-DRAFT.md');
  const listingPath = resolve(exportRoot, 'itch-listing-preview.json');
  await mkdir(resolve(downloadRoot, 'assets'), { recursive: true });
  const listing = buildItchListing(product, candidates, marketplacePreviewNames);
  await Promise.all([
    writeFile(coverPath, cover),
    ...marketplacePreviewPaths.map((path, index) => writeFile(path, marketplacePreviews[index])),
    writeFile(sheetPath, spriteSheet),
    writeFile(readmePath, packReadme(product, candidates), 'utf8'),
    writeFile(licensePath, '# Draft License\n\nInternal connection test only. Not approved for public distribution or resale.\n', 'utf8'),
    writeFile(listingPath, `${JSON.stringify(listing, null, 2)}\n`, 'utf8'),
  ]);
  knownFiles.push(
    coverPath,
    ...marketplacePreviewPaths,
    sheetPath,
    readmePath,
    licensePath,
    listingPath,
  );

  const files = [];
  for (const path of knownFiles.sort()) {
    const buffer = await readFile(path);
    files.push({
      path: normalizePath(relative(exportRoot, path)),
      size_bytes: buffer.length,
      content_sha256: sha256(buffer),
    });
  }
  const manifestHash = sha256(Buffer.from(files.map((file) => `${file.path}:${file.content_sha256}`).join('\n')));
  const manifest = {
    schema_version: '1.0',
    release_state: 'internal_preview',
    distribution_ready: false,
    product_id: product.product_id,
    product_version: product.version,
    title: product.title,
    asset_count: candidates.length,
    manifest_hash: manifestHash,
    listing_hash: listing.listing_hash,
    generated_at: options.now || new Date().toISOString(),
    files,
  };
  const manifestPath = resolve(exportRoot, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    product,
    exportRoot,
    downloadRoot,
    manifestPath,
    manifest,
    coverPath,
    marketplacePreviewPath,
    marketplacePreviewPaths,
    sheetPath,
  };
}
