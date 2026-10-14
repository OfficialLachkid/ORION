import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { CanonicalProductStore } from './canonical-store.mjs';

const COVER_WIDTH = 630;
const COVER_HEIGHT = 500;
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

async function createCover(candidates, product) {
  const cellWidth = 142;
  const cellHeight = 142;
  const gridLeft = 31;
  const gridTop = 112;
  const composites = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const scaled = await sharp(candidates[index].buffer)
      .resize(128, 64, { fit: 'contain', kernel: sharp.kernel.nearest })
      .png()
      .toBuffer();
    composites.push({
      input: scaled,
      left: gridLeft + (column * cellWidth) + 7,
      top: gridTop + (row * cellHeight) + 23,
    });
  }

  const labels = candidates.map(({ asset }, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = gridLeft + (column * cellWidth) + (cellWidth / 2);
    const y = gridTop + (row * cellHeight) + 108;
    return `<text x="${x}" y="${y}" text-anchor="middle" fill="#c8d4ec" font-family="Arial, sans-serif" font-size="13">${escapeXml(asset.name)}</text>`;
  }).join('');
  const overlay = Buffer.from([
    `<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    '<rect width="630" height="500" fill="#10131d"/>',
    '<rect x="18" y="18" width="594" height="464" rx="18" fill="#161c2a" stroke="#35d9ff" stroke-width="3"/>',
    `<text x="315" y="66" text-anchor="middle" fill="#f4f7ff" font-family="Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(product.title.toUpperCase())}</text>`,
    `<text x="315" y="96" text-anchor="middle" fill="#35d9ff" font-family="Arial, sans-serif" font-size="18">${candidates.length} SIDE-VIEW WEAPON SPRITES</text>`,
    labels,
    `<text x="315" y="456" text-anchor="middle" fill="#7785a6" font-family="Arial, sans-serif" font-size="14">Actual included assets · transparent PNG · ${product.style.width} × ${product.style.height} px</text>`,
    '</svg>',
  ].join(''));
  return sharp({
    create: { width: COVER_WIDTH, height: COVER_HEIGHT, channels: 4, background: '#10131d' },
  }).composite([{ input: overlay }, ...composites]).png({ compressionLevel: 9 }).toBuffer();
}

function packReadme(product, candidates) {
  return [
    `# ${product.title}`,
    '',
    'Internal ORION marketplace-connection preview.',
    '',
    `${candidates.length} original science-fiction weapon sprites are included as individual transparent PNG files and one sprite sheet.`,
    '',
    '- View: strict side view',
    '- Facing: right-facing side view',
    `- Canvas: ${product.style.width}x${product.style.height} per sprite`,
    `- Palette limit: ${product.style.max_palette_colors} colors`,
    '- Root motion: none',
    '- Generative AI: local model output with deterministic ORION post-processing',
    '',
    'This preview is not approved for public distribution. The included license is a draft.',
    '',
  ].join('\n');
}

function buildItchListing(product, candidates) {
  const assetNames = candidates.map(({ asset }, index) => (
    `${String(index + 1).padStart(2, '0')}. ${asset.name}`
  ));
  const technicalInformation = [
    `${product.style.width}x${product.style.height} pixel canvas per sprite`,
    'Transparent PNG files',
    'Strict side-view presentation',
    'One supplied direction',
    'No baked root motion',
    `Palette limited to ${product.style.max_palette_colors} colors`,
  ];
  const description = [
    `${product.title} is a coordinated pack of ${candidates.length} original science-fiction weapon sprites for 2D games.`,
    '',
    'Included assets:',
    ...assetNames.map((name) => `- ${name}`),
    '',
    'Technical information:',
    ...technicalInformation.map((line) => `- ${line}`),
    '',
    'The cover and screenshots are assembled from the exact included assets.',
    'Contains locally generated AI-assisted artwork with deterministic post-processing and human review.',
  ].join('\n');
  const listing = {
    schema_version: '1.0',
    title: product.title,
    short_description: `${candidates.length} original side-view sci-fi weapon sprites for 2D games.`,
    description,
    suggested_price: product.pricing.base_price,
    tags: ['2D', 'Pixel Art', 'Sci-fi', 'Weapons', 'Sprites'],
    classification: 'assets',
    visibility: 'draft',
    cover_path: 'cover.png',
    screenshot_paths: [`download/assets/${product.slug}-sprite-sheet.png`],
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

  const [cover, spriteSheet] = await Promise.all([
    createCover(candidates, product),
    createSpriteSheet(candidates, product),
  ]);
  const coverPath = resolve(exportRoot, 'cover.png');
  const sheetPath = resolve(downloadRoot, 'assets', `${product.slug}-sprite-sheet.png`);
  const readmePath = resolve(downloadRoot, 'README.md');
  const licensePath = resolve(downloadRoot, 'LICENSE-DRAFT.md');
  const listingPath = resolve(exportRoot, 'itch-listing-preview.json');
  await mkdir(resolve(downloadRoot, 'assets'), { recursive: true });
  const listing = buildItchListing(product, candidates);
  await Promise.all([
    writeFile(coverPath, cover),
    writeFile(sheetPath, spriteSheet),
    writeFile(readmePath, packReadme(product, candidates), 'utf8'),
    writeFile(licensePath, '# Draft License\n\nInternal connection test only. Not approved for public distribution or resale.\n', 'utf8'),
    writeFile(listingPath, `${JSON.stringify(listing, null, 2)}\n`, 'utf8'),
  ]);
  knownFiles.push(coverPath, sheetPath, readmePath, licensePath, listingPath);

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

  return { product, exportRoot, downloadRoot, manifestPath, manifest, coverPath, sheetPath };
}
