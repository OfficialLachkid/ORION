import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNormalAndPixelBackgroundPool,
} from '../src/domains/pokemon/templates/shared/background-pools.mjs';

test('normal and pixel backgrounds share one deduplicated candidate pool', () => {
  assert.deepEqual(
    buildNormalAndPixelBackgroundPool({
      backgrounds: ['/backgrounds/forest.png', '/backgrounds/city.gif'],
      pixel_backgrounds: ['/pixel-backgrounds/route.png', '/BACKGROUNDS/FOREST.PNG'],
    }),
    ['/backgrounds/forest.png', '/backgrounds/city.gif', '/pixel-backgrounds/route.png'],
  );
});

test('background pool tolerates missing or malformed inventory lists', () => {
  assert.deepEqual(buildNormalAndPixelBackgroundPool(), []);
  assert.deepEqual(
    buildNormalAndPixelBackgroundPool({
      backgrounds: null,
      pixel_backgrounds: [' ', '/pixel-backgrounds/cave.png'],
    }),
    ['/pixel-backgrounds/cave.png'],
  );
});
