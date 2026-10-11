import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { ProductSpecificationSchema } from './schemas.mjs';

function resolveInside(rootPath, candidatePath, label) {
  const root = resolve(rootPath);
  const target = resolve(root, candidatePath);
  const child = relative(root, target);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`${label} must stay inside ${root}.`);
  return target;
}

function readmeFor(product) {
  return [
    `# ${product.title}`,
    '',
    `Canonical product ID: \`${product.product_id}\``,
    '',
    `Status: **${product.status}**`,
    '',
    'This directory is the marketplace-independent source of truth. Generated assets require human review before packaging or distribution.',
    '',
    '## Asset specification',
    '',
    `- Medium: ${product.style.medium}`,
    `- Perspective: ${product.style.perspective}`,
    `- Output: ${product.style.width}x${product.style.height} PNG with transparency`,
    `- Maximum palette: ${product.style.max_palette_colors} colors`,
    `- Provider: ${product.generation_provider.provider}/${product.generation_provider.model}`,
    '- Generation cost: local, no per-image API charge',
    '',
    '## Approval gates',
    '',
    '- Generated assets: pending human review',
    '- License text: draft',
    '- Marketplace distribution: pending explicit approval',
    '',
  ].join('\n');
}

const DRAFT_LICENSE = `# Draft Product License\n\nNot approved for distribution. Replace this file with the reviewed canonical ORION digital-asset license before publishing.\n\nRaw asset resale and redistribution are prohibited by default.\n`;

export class CanonicalProductStore {
  constructor(outputRoot) {
    this.outputRoot = resolve(outputRoot);
  }

  productRoot(product) {
    return resolveInside(this.outputRoot, product.slug, 'Product path');
  }

  assetPaths(product, asset, sourceExtension = 'png') {
    const root = this.productRoot(product);
    return {
      source: resolveInside(root, `assets/source/${asset.asset_key}.${sourceExtension}`, 'Source asset path'),
      final: resolveInside(root, `assets/items/${asset.asset_key}.png`, 'Final asset path'),
      validation: resolveInside(root, `validation/${asset.asset_key}.json`, 'Validation path'),
      preview: resolveInside(root, `previews/${asset.asset_key}-transparency.png`, 'Preview path'),
    };
  }

  async initialize(product, validation) {
    const parsed = ProductSpecificationSchema.parse(product);
    const root = this.productRoot(parsed);
    await Promise.all([
      'assets/source',
      'assets/items',
      'previews',
      'validation',
      'exports/generic',
      'exports/itch',
    ].map((directory) => mkdir(resolveInside(root, directory, 'Product directory'), { recursive: true })));
    await Promise.all([
      writeFile(resolveInside(root, 'product.json', 'Product manifest'), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8'),
      writeFile(resolveInside(root, 'opportunity-validation.json', 'Validation report'), `${JSON.stringify(validation, null, 2)}\n`, 'utf8'),
      writeFile(resolveInside(root, 'README.md', 'Product README'), readmeFor(parsed), 'utf8'),
      writeFile(resolveInside(root, 'LICENSE.md', 'Product license'), DRAFT_LICENSE, 'utf8'),
      writeFile(resolveInside(root, 'CHANGELOG.md', 'Product changelog'), `# Changelog\n\n## 0.1.0\n\n- Initial product plan.\n`, 'utf8'),
    ]);
    return { root, manifestPath: resolve(root, 'product.json') };
  }

  async saveProduct(product) {
    const parsed = ProductSpecificationSchema.parse(product);
    const path = resolveInside(this.productRoot(parsed), 'product.json', 'Product manifest');
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    await writeFile(resolve(this.productRoot(parsed), 'README.md'), readmeFor(parsed), 'utf8');
    return path;
  }

  async loadProduct(slug) {
    const path = resolveInside(this.outputRoot, `${slug}/product.json`, 'Product manifest');
    return ProductSpecificationSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  }
}
