import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

const WIDTH = 960;
const HEIGHT = 540;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function contained(buffer, width, height) {
  return sharp(buffer)
    .resize(width, height, { fit: 'contain', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
}

function protectionText(x, y, size = 18) {
  return `<text x="${x}" y="${y}" text-anchor="middle" fill="#ffffff" fill-opacity="0.28" stroke="#0c1019" stroke-opacity="0.55" stroke-width="1" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" transform="rotate(-15 ${x} ${y})">PREVIEW</text>`;
}

function titleBlock({ width, title, subtitle, titleSize = 40 }) {
  return [
    '<rect width="100%" height="100%" fill="#0b0f18"/>',
    `<rect x="18" y="18" width="${width - 36}" height="104" rx="18" fill="#141b2a" stroke="#35d9ff" stroke-width="2"/>`,
    '<rect x="34" y="34" width="10" height="72" rx="5" fill="#ff4fd8"/>',
    `<text x="${width / 2}" y="67" text-anchor="middle" fill="#f7f9ff" stroke="#05070c" stroke-width="4" paint-order="stroke" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="900" letter-spacing="1">${escapeXml(title.toUpperCase())}</text>`,
    `<text x="${width / 2}" y="100" text-anchor="middle" fill="#35d9ff" stroke="#05070c" stroke-width="2" paint-order="stroke" font-family="Arial, sans-serif" font-size="19" font-weight="800">${escapeXml(subtitle.toUpperCase())}</text>`,
  ].join('');
}

async function weaponBuffers(candidateRoot, product) {
  return Promise.all(product.assets.map(async (asset) => ({
    asset,
    buffer: await readFile(resolve(
      candidateRoot,
      'download',
      'assets',
      'individual',
      basename(asset.final_path),
    )),
  })));
}

async function createCover(candidateRoot, product, version) {
  const weapons = await weaponBuffers(candidateRoot, product);
  const width = 630;
  const height = 500;
  const left = 24;
  const top = 135;
  const cellWidth = 145;
  const cellHeight = 142;
  const composites = [];
  for (let index = 0; index < weapons.length; index += 1) {
    composites.push({
      input: await contained(weapons[index].buffer, 128, 64),
      left: left + ((index % 4) * cellWidth) + 8,
      top: top + (Math.floor(index / 4) * cellHeight) + 30,
    });
  }
  const cards = weapons.map(({ asset }, index) => {
    const x = left + ((index % 4) * cellWidth);
    const y = top + (Math.floor(index / 4) * cellHeight);
    return [
      `<rect x="${x}" y="${y}" width="137" height="132" rx="10" fill="#151d2d" stroke="#334766"/>`,
      `<text x="${x + 68.5}" y="${y + 112}" text-anchor="middle" fill="#dce7fb" font-family="Arial, sans-serif" font-size="12" font-weight="700">${escapeXml(asset.name)}</text>`,
    ].join('');
  }).join('');
  const svg = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    titleBlock({ width, title: product.title, subtitle: '8 weapons + 24 matching effects', titleSize: 37 }),
    cards,
    '<rect x="24" y="430" width="582" height="46" rx="12" fill="#101726" stroke="#875cff"/>',
    `<text x="315" y="458" text-anchor="middle" fill="#f5f7ff" font-family="Arial, sans-serif" font-size="15" font-weight="800">VERSION ${escapeXml(version)} &#8226; TRANSPARENT PNG &#8226; SPRITE SHEETS &#8226; ANIMATION JSON</text>`,
    '</svg>',
  ].join(''));
  const protection = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    weapons.map((_, index) => {
      const x = left + ((index % 4) * cellWidth) + 68.5;
      const y = top + (Math.floor(index / 4) * cellHeight) + 67;
      return protectionText(x, y, 15);
    }).join(''),
    '</svg>',
  ].join(''));
  return sharp({ create: { width, height, channels: 3, background: '#0b0f18' } })
    .composite([{ input: svg }, ...composites, { input: protection }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function createInventory(candidateRoot, product) {
  const weapons = await weaponBuffers(candidateRoot, product);
  const left = 38;
  const top = 142;
  const cellWidth = 221;
  const cellHeight = 166;
  const composites = [];
  for (let index = 0; index < weapons.length; index += 1) {
    composites.push({
      input: await contained(weapons[index].buffer, 190, 95),
      left: left + ((index % 4) * cellWidth) + 15,
      top: top + (Math.floor(index / 4) * cellHeight) + 28,
    });
  }
  const cards = weapons.map(({ asset }, index) => {
    const x = left + ((index % 4) * cellWidth);
    const y = top + (Math.floor(index / 4) * cellHeight);
    return [
      `<rect x="${x}" y="${y}" width="211" height="154" rx="12" fill="#151d2d" stroke="#334766"/>`,
      `<text x="${x + 105.5}" y="${y + 139}" text-anchor="middle" fill="#dce7fb" font-family="Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(asset.name)}</text>`,
    ].join('');
  }).join('');
  const svg = Buffer.from([
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    titleBlock({ width: WIDTH, title: product.title, subtitle: 'Complete weapon inventory' }),
    cards,
    '<text x="928" y="518" text-anchor="end" fill="#35d9ff" font-family="Arial, sans-serif" font-size="12" font-weight="800">VBJSERVICES &#8226; PROTECTED PREVIEW</text>',
    '</svg>',
  ].join(''));
  const protection = Buffer.from([
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    weapons.map((_, index) => {
      const x = left + ((index % 4) * cellWidth) + 105.5;
      const y = top + (Math.floor(index / 4) * cellHeight) + 80;
      return protectionText(x, y, 23);
    }).join(''),
    '</svg>',
  ].join(''));
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#0b0f18' } })
    .composite([{ input: svg }, ...composites, { input: protection }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function effectFrame(candidateRoot, effectSet, kind, frame) {
  return readFile(resolve(
    candidateRoot,
    'download',
    effectSet.effects[kind].path,
    'frames',
    `${String(frame).padStart(2, '0')}.png`,
  ));
}

async function createEffectsBreakdown(candidateRoot, product, effectSets) {
  const left = 28;
  const top = 142;
  const cellWidth = 226;
  const cellHeight = 166;
  const composites = [];
  for (let index = 0; index < effectSets.length; index += 1) {
    const set = effectSets[index];
    const frames = await Promise.all([
      effectFrame(candidateRoot, set, 'muzzle_flash', 2),
      effectFrame(candidateRoot, set, 'projectile', 0),
      effectFrame(candidateRoot, set, 'impact_decay', 2),
    ]);
    for (let effectIndex = 0; effectIndex < frames.length; effectIndex += 1) {
      composites.push({
        input: await contained(frames[effectIndex], 58, 58),
        left: left + ((index % 4) * cellWidth) + 10 + (effectIndex * 70),
        top: top + (Math.floor(index / 4) * cellHeight) + 55,
      });
    }
  }
  const cards = effectSets.map((set, index) => {
    const x = left + ((index % 4) * cellWidth);
    const y = top + (Math.floor(index / 4) * cellHeight);
    return [
      `<rect x="${x}" y="${y}" width="216" height="154" rx="12" fill="#151d2d" stroke="#334766"/>`,
      `<text x="${x + 108}" y="${y + 25}" text-anchor="middle" fill="#f4f7ff" font-family="Arial, sans-serif" font-size="15" font-weight="800">${escapeXml(set.name)}</text>`,
      `<text x="${x + 39}" y="${y + 46}" text-anchor="middle" fill="#35d9ff" font-family="Arial, sans-serif" font-size="10" font-weight="700">MUZZLE</text>`,
      `<text x="${x + 109}" y="${y + 46}" text-anchor="middle" fill="#35d9ff" font-family="Arial, sans-serif" font-size="10" font-weight="700">BULLET</text>`,
      `<text x="${x + 179}" y="${y + 46}" text-anchor="middle" fill="#35d9ff" font-family="Arial, sans-serif" font-size="10" font-weight="700">IMPACT</text>`,
    ].join('');
  }).join('');
  const svg = Buffer.from([
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    titleBlock({ width: WIDTH, title: product.title, subtitle: 'Independent effects included for every weapon' }),
    cards,
    '<text x="928" y="518" text-anchor="end" fill="#35d9ff" font-family="Arial, sans-serif" font-size="12" font-weight="800">CLEAN TRANSPARENT FRAMES INCLUDED IN DOWNLOAD</text>',
    '</svg>',
  ].join(''));
  const protection = Buffer.from([
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    effectSets.map((_, index) => {
      const x = left + ((index % 4) * cellWidth) + 108;
      const y = top + (Math.floor(index / 4) * cellHeight) + 104;
      return protectionText(x, y, 20);
    }).join(''),
    '</svg>',
  ].join(''));
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#0b0f18' } })
    .composite([{ input: svg }, ...composites, { input: protection }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function defaultProcessRunner(executable, args) {
  return spawnSync(executable, args, { encoding: 'utf8', timeout: 3 * 60_000 });
}

async function createMontage(candidateRoot, product, effectSets, options) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orion-marketing-'));
  try {
    const left = 28;
    const top = 142;
    const cellWidth = 226;
    const cellHeight = 166;
    const cards = effectSets.map((set, index) => {
      const x = left + ((index % 4) * cellWidth);
      const y = top + (Math.floor(index / 4) * cellHeight);
      return [
        `<rect x="${x}" y="${y}" width="216" height="154" rx="12" fill="#151d2d" stroke="#334766"/>`,
        `<text x="${x + 108}" y="${y + 24}" text-anchor="middle" fill="#f4f7ff" font-family="Arial, sans-serif" font-size="14" font-weight="800">${escapeXml(set.name)}</text>`,
      ].join('');
    }).join('');
    const background = Buffer.from([
      `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
      titleBlock({ width: WIDTH, title: product.title, subtitle: 'Complete firing-cycle previews' }),
      cards,
      '</svg>',
    ].join(''));
    const foreground = Buffer.from([
      `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
      effectSets.map((_, index) => {
        const x = left + ((index % 4) * cellWidth) + 108;
        const y = top + (Math.floor(index / 4) * cellHeight) + 93;
        return protectionText(x, y, 20);
      }).join(''),
      '<text x="928" y="518" text-anchor="end" fill="#35d9ff" font-family="Arial, sans-serif" font-size="12" font-weight="800">VBJSERVICES &#8226; PROTECTED ANIMATED PREVIEW</text>',
      '</svg>',
    ].join(''));
    const backgroundPath = resolve(tempRoot, 'background.png');
    const foregroundPath = resolve(tempRoot, 'foreground.png');
    await Promise.all([
      sharp(background).png().toFile(backgroundPath),
      sharp(foreground).png().toFile(foregroundPath),
    ]);
    const outputPath = resolve(candidateRoot, 'firing-cycle-montage.gif');
    const args = ['-y', '-loop', '1', '-i', backgroundPath];
    for (const set of effectSets) {
      args.push('-stream_loop', '-1', '-i', set.attack_cycle_preview_source);
    }
    args.push('-loop', '1', '-i', foregroundPath);
    const filters = [];
    for (let index = 0; index < effectSets.length; index += 1) {
      filters.push(`[${index + 1}:v]fps=12,scale=204:104:force_original_aspect_ratio=decrease:flags=neighbor,pad=204:104:(ow-iw)/2:(oh-ih)/2:color=0x151d2d[a${index}]`);
      const x = left + ((index % 4) * cellWidth) + 6;
      const y = top + (Math.floor(index / 4) * cellHeight) + 34;
      filters.push(`${index === 0 ? '[0:v]' : `[b${index - 1}]`}[a${index}]overlay=${x}:${y}:shortest=1[b${index}]`);
    }
    filters.push(`[b${effectSets.length - 1}][${effectSets.length + 1}:v]overlay=0:0:shortest=1,split[p0][p1]`);
    filters.push('[p0]palettegen=max_colors=128:reserve_transparent=0[p]');
    filters.push('[p1][p]paletteuse=dither=bayer:bayer_scale=3[out]');
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[out]',
      '-t', '6',
      '-loop', '0',
      outputPath,
    );
    const result = (options.runProcess || defaultProcessRunner)(
      options.ffmpegExecutable || 'ffmpeg',
      args,
    );
    if (result.status !== 0 || result.error) {
      throw new Error(`Could not render firing-cycle montage: ${result.stderr || result.error?.message || 'ffmpeg failed'}`);
    }
    return outputPath;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function buildReleaseMarketingMedia(options) {
  if (options.effectSets.length !== options.product.assets.length) {
    throw new Error('Marketing media requires one verified effect set per weapon.');
  }
  const files = {
    cover: 'cover.png',
    inventory: 'weapon-inventory.png',
    effects: 'effects-breakdown.png',
    montage: 'firing-cycle-montage.gif',
  };
  const [cover, inventory, effects] = await Promise.all([
    createCover(options.candidateRoot, options.product, options.version),
    createInventory(options.candidateRoot, options.product),
    createEffectsBreakdown(options.candidateRoot, options.product, options.effectSets),
  ]);
  await Promise.all([
    writeFile(resolve(options.candidateRoot, files.cover), cover),
    writeFile(resolve(options.candidateRoot, files.inventory), inventory),
    writeFile(resolve(options.candidateRoot, files.effects), effects),
  ]);
  await createMontage(options.candidateRoot, options.product, options.effectSets, options);
  return {
    cover_path: files.cover,
    screenshot_paths: [files.inventory, files.effects, files.montage],
  };
}
