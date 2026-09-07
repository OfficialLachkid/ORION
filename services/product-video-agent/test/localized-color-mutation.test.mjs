import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeVisibleColorFamilies,
  buildLocalizedColorMutationVariants,
  hueDistance,
  rgbToHsl,
} from '../src/domains/pokemon/templates/shared/render/localized-color-mutation.mjs';

function setPixel(data, pixelIndex, red, green, blue, alpha = 255) {
  const offset = pixelIndex * 4;
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  data[offset + 3] = alpha;
}

function getPixel(data, pixelIndex) {
  const offset = pixelIndex * 4;
  return [
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  ];
}

test('localized color mutation changes one useful color family while preserving other pixels', () => {
  const width = 10;
  const height = 10;
  const data = Buffer.alloc(width * height * 4, 0);
  for (let index = 0; index < 40; index += 1) {
    setPixel(data, index, 238, 210, 168);
  }
  for (let index = 40; index < 48; index += 1) {
    setPixel(data, index, 50, 120, 220);
  }
  for (let index = 48; index < 56; index += 1) {
    setPixel(data, index, 80, 150, 240);
  }
  for (let index = 56; index < 64; index += 1) {
    setPixel(data, index, 10, 10, 12);
  }
  for (let index = 64; index < 68; index += 1) {
    setPixel(data, index, 248, 248, 248);
  }

  const result = buildLocalizedColorMutationVariants({
    data,
    width,
    height,
    variantCount: 3,
    seed: 'localized-blue-family',
  });

  assert.equal(result.variants.length, 3);
  assert.ok(result.selected_family);
  assert.equal(hueDistance(result.selected_family.hue, rgbToHsl(65, 135, 230).hue) < 32, true);

  const variant = result.variants[0].data;
  assert.notDeepEqual(getPixel(variant, 40), getPixel(data, 40));
  assert.notDeepEqual(getPixel(variant, 48), getPixel(data, 48));
  assert.deepEqual(getPixel(variant, 0), getPixel(data, 0));
  assert.deepEqual(getPixel(variant, 56), getPixel(data, 56));
  assert.deepEqual(getPixel(variant, 64), getPixel(data, 64));
  assert.deepEqual(getPixel(variant, 99), [0, 0, 0, 0]);

  const darkerMutated = rgbToHsl(...getPixel(variant, 40).slice(0, 3));
  const lighterMutated = rgbToHsl(...getPixel(variant, 48).slice(0, 3));
  assert.equal(lighterMutated.lightness > darkerMutated.lightness, true);
});

test('localized color mutation chooses distinct replacement colors away from major original colors', () => {
  const width = 10;
  const height = 10;
  const data = Buffer.alloc(width * height * 4, 0);
  for (let index = 0; index < 42; index += 1) {
    setPixel(data, index, 235, 202, 150);
  }
  for (let index = 42; index < 62; index += 1) {
    setPixel(data, index, 42, 128, 218);
  }
  for (let index = 62; index < 72; index += 1) {
    setPixel(data, index, 166, 42, 42);
  }

  const result = buildLocalizedColorMutationVariants({
    data,
    width,
    height,
    variantCount: 3,
    seed: 'distinct-targets',
  });
  const targetHues = result.variants.map((variant) => variant.mutation.target.hue);
  assert.equal(new Set(result.variants.map((variant) => variant.mutation.target.id)).size, 3);
  for (let left = 0; left < targetHues.length; left += 1) {
    for (let right = left + 1; right < targetHues.length; right += 1) {
      assert.equal(hueDistance(targetHues[left], targetHues[right]) >= 34, true);
    }
  }

  const majorColorGroups = result.analysis.major_groups.filter((group) => group.saturation >= 0.16);
  for (const targetHue of targetHues) {
    for (const group of majorColorGroups) {
      assert.equal(hueDistance(targetHue, group.hue) >= 20, true);
    }
  }
});

test('localized color mutation handles transparent and neutral-only sprites without corrupting pixels', () => {
  const width = 4;
  const height = 4;
  const data = Buffer.alloc(width * height * 4, 0);
  for (let index = 0; index < 8; index += 1) {
    setPixel(data, index, 8, 8, 8);
  }
  for (let index = 8; index < 12; index += 1) {
    setPixel(data, index, 248, 248, 248);
  }

  const analysis = analyzeVisibleColorFamilies({ data, width, height });
  const result = buildLocalizedColorMutationVariants({
    data,
    width,
    height,
    variantCount: 2,
    seed: 'neutral-edge-case',
  });

  assert.equal(analysis.visible_pixel_count, 12);
  assert.equal(result.selected_family, null);
  assert.equal(result.variants.length, 2);
  for (const variant of result.variants) {
    assert.deepEqual([...variant.data], [...data]);
  }
});

test('localized color mutation uses one stable target across stacked animation frames', () => {
  const width = 2;
  const height = 4;
  const data = Buffer.alloc(width * height * 4, 0);
  setPixel(data, 0, 48, 116, 214);
  setPixel(data, 1, 238, 210, 168);
  setPixel(data, 2, 58, 130, 228);
  setPixel(data, 3, 238, 210, 168);
  setPixel(data, 4, 74, 148, 242);
  setPixel(data, 5, 238, 210, 168);
  setPixel(data, 6, 84, 160, 248);
  setPixel(data, 7, 238, 210, 168);

  const result = buildLocalizedColorMutationVariants({
    data,
    width,
    height,
    variantCount: 1,
    seed: 'stacked-gif-frames',
    config: {
      ideal_min_percent: 0.2,
      ideal_max_percent: 0.7,
    },
  });
  const variant = result.variants[0];
  const targetHue = variant.mutation.target.hue;
  const frameOneHue = rgbToHsl(...getPixel(variant.data, 0).slice(0, 3)).hue;
  const frameTwoHue = rgbToHsl(...getPixel(variant.data, 6).slice(0, 3)).hue;

  assert.notDeepEqual(getPixel(variant.data, 0), getPixel(data, 0));
  assert.notDeepEqual(getPixel(variant.data, 6), getPixel(data, 6));
  assert.equal(hueDistance(frameOneHue, targetHue) < 42, true);
  assert.equal(hueDistance(frameTwoHue, targetHue) < 42, true);
});
