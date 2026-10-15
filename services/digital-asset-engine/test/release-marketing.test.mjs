import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { buildReleaseMarketingMedia } from '../src/release-marketing.mjs';

async function sprite(width, height, color) {
  return sharp({
    create: { width, height, channels: 4, background: { ...color, alpha: 1 } },
  }).png().toBuffer();
}

test('builds protected cover, inventory, effects board, and firing-cycle montage', async () => {
  const candidateRoot = await mkdtemp(join(tmpdir(), 'orion-release-marketing-'));
  const assets = [];
  const effectSets = [];
  for (let index = 0; index < 8; index += 1) {
    const key = `weapon-${index + 1}`;
    const finalPath = `assets/items/${key}.png`;
    assets.push({ asset_key: key, name: `Weapon ${index + 1}`, final_path: finalPath });
    const weaponPath = resolve(candidateRoot, 'download', 'assets', 'individual', `${key}.png`);
    await mkdir(resolve(weaponPath, '..'), { recursive: true });
    await writeFile(weaponPath, await sprite(128, 64, { r: 53, g: 217, b: 255 }));
    const effects = {};
    for (const [kind, frameCount] of [['muzzle_flash', 4], ['projectile', 1], ['impact_decay', 4]]) {
      const path = `effects/${key}/${kind}`;
      effects[kind] = { path, frame_count: frameCount };
      for (let frame = 0; frame < frameCount; frame += 1) {
        const framePath = resolve(candidateRoot, 'download', path, 'frames', `${String(frame).padStart(2, '0')}.png`);
        await mkdir(resolve(framePath, '..'), { recursive: true });
        await writeFile(framePath, await sprite(64, 64, { r: 135, g: 92, b: 255 }));
      }
    }
    const attackCyclePath = resolve(candidateRoot, `${key}-attack-cycle.gif`);
    await writeFile(attackCyclePath, 'fixture-gif');
    effectSets.push({
      source_asset_key: key,
      name: `Weapon ${index + 1}`,
      effects,
      attack_cycle_preview_source: attackCyclePath,
    });
  }
  let ffmpegArgs;
  const media = await buildReleaseMarketingMedia({
    candidateRoot,
    product: { title: 'Neon Plasma Armory', assets },
    effectSets,
    version: '0.2.0',
    runProcess(executable, args) {
      assert.equal(executable, 'ffmpeg');
      ffmpegArgs = args;
      writeFileSync(args.at(-1), 'rendered-gif');
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(media.cover_path, 'cover.png');
  assert.deepEqual(media.screenshot_paths, [
    'weapon-inventory.png',
    'effects-breakdown.png',
    'firing-cycle-montage.gif',
  ]);
  assert.deepEqual(
    await sharp(resolve(candidateRoot, media.cover_path)).metadata().then(({ width, height }) => ({ width, height })),
    { width: 630, height: 500 },
  );
  assert.deepEqual(
    await sharp(resolve(candidateRoot, media.screenshot_paths[0])).metadata()
      .then(({ width, height }) => ({ width, height })),
    { width: 960, height: 540 },
  );
  assert.equal((await readFile(resolve(candidateRoot, media.screenshot_paths[2]), 'utf8')), 'rendered-gif');
  assert.equal(ffmpegArgs.filter((value) => value === '-stream_loop').length, 8);
  assert.match(ffmpegArgs[ffmpegArgs.indexOf('-filter_complex') + 1], /palettegen/u);
  assert.match(ffmpegArgs[ffmpegArgs.indexOf('-filter_complex') + 1], /trim=duration=4/u);
  assert.ok(ffmpegArgs.includes('48'));
});
