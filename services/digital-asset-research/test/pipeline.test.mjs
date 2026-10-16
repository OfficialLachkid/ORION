import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadExistingProductCatalog } from '../src/pipeline.mjs';

test('loads a compact existing-product catalog so research can recommend extensions', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-research-products-'));
  await mkdir(resolve(root, 'neon-plasma-armory'), { recursive: true });
  await writeFile(resolve(root, 'neon-plasma-armory', 'product.json'), JSON.stringify({
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
    version: '0.2.0',
    category: '2D assets',
    product_type: 'weapon pack',
    theme: 'science fiction',
    assets: [{ name: 'Arc Launcher', kind: 'weapon' }],
  }));
  await mkdir(resolve(root, 'research'), { recursive: true });

  const catalog = await loadExistingProductCatalog(root);
  assert.deepEqual(catalog, [{
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
    version: '0.2.0',
    category: '2D assets',
    product_type: 'weapon pack',
    theme: 'science fiction',
    assets: [{ name: 'Arc Launcher', kind: 'weapon' }],
  }]);
});
