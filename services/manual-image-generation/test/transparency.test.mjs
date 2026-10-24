import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { removeConnectedChromaBackground } from '../src/transparency.mjs';

test('transparent processing removes border chroma and enclosed strong chroma while preserving subject color', async () => {
  const width = 5;
  const height = 5;
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 0;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = 255;
  }
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) {
      if (x === 2 && y === 2) continue;
      const offset = ((y * width) + x) * 4;
      rgba[offset] = 0;
      rgba[offset + 1] = 120;
      rgba[offset + 2] = 255;
    }
  }
  const accentOffset = ((2 * width) + 1) * 4;
  rgba[accentOffset] = 180;
  rgba[accentOffset + 1] = 40;
  rgba[accentOffset + 2] = 170;
  const input = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const result = await removeConnectedChromaBackground(input, { tolerance: 105 });
  const output = await sharp(result.buffer).ensureAlpha().raw().toBuffer();

  assert.equal(output[3], 0, 'border chroma becomes transparent');
  assert.equal(output[(((2 * width) + 2) * 4) + 3], 0, 'enclosed flat chroma becomes transparent');
  assert.equal(output[(((1 * width) + 1) * 4) + 3], 255, 'subject remains opaque');
  assert.equal(output[accentOffset + 3], 255, 'distinct magenta subject detail remains opaque');
  assert.equal(result.removedInteriorPixels, 1);
});

test('transparent processing removes reserved chroma inside holes when the inferred border shade drifted', async () => {
  const width = 5;
  const height = 5;
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    rgba[offset] = 205;
    rgba[offset + 1] = 100;
    rgba[offset + 2] = 240;
    rgba[offset + 3] = 255;
  }
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) {
      const offset = ((y * width) + x) * 4;
      rgba[offset] = 20;
      rgba[offset + 1] = 100;
      rgba[offset + 2] = 130;
    }
  }
  const holeOffset = ((2 * width) + 2) * 4;
  rgba[holeOffset] = 255;
  rgba[holeOffset + 1] = 0;
  rgba[holeOffset + 2] = 255;
  const input = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const result = await removeConnectedChromaBackground(input, {
    tolerance: 60,
    interiorTolerance: 60,
    chromaKey: '#ff00ff',
    chromaKeyTolerance: 60,
  });
  const output = await sharp(result.buffer).ensureAlpha().raw().toBuffer();

  assert.equal(output[holeOffset + 3], 0, 'reserved chroma becomes transparent despite border hue drift');
  assert.equal(result.removedReservedChromaPixels, 1);
});
