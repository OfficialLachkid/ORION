import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { validateGeneratedAsset } from './asset-validator.mjs';
import { CanonicalProductStore } from './canonical-store.mjs';
import { withGenerationLock } from './generation-lock.mjs';
import {
  createTransparencyPreview,
  PIXEL_ART_PROCESSING_VERSION,
  processPixelArtAsset,
} from './image-processor.mjs';
import { validateOpportunity } from './opportunity-validator.mjs';
import { OllamaImageAdapter } from './ollama-image-adapter.mjs';
import { createProductSpecification } from './product-planner.mjs';
import { assertGenerationResourcesAvailable } from './resource-preflight.mjs';
import { ProductSpecificationSchema } from './schemas.mjs';

async function writeBuffer(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
}

export async function planDigitalAssetProduct(options) {
  const validation = validateOpportunity(options.opportunity, options.config, {
    now: options.now,
    existingProducts: options.existingProducts,
  });
  if (!validation.generation_eligible) {
    throw new Error(`Opportunity rejected: ${validation.failures.join(', ')}.`);
  }
  const product = createProductSpecification(validation, options.config, { now: options.now });
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  if (options.resume === true) {
    const existing = await store.loadProductIfExists(product.slug);
    if (existing) {
      const expectedKeys = product.assets.map((asset) => asset.asset_key);
      const existingKeys = existing.assets.map((asset) => asset.asset_key);
      if (existing.product_id !== product.product_id || JSON.stringify(existingKeys) !== JSON.stringify(expectedKeys)) {
        throw new Error(`Existing product ${product.slug} does not match the current opportunity definition.`);
      }
      return {
        validation,
        product: existing,
        persistence: {
          root: store.productRoot(existing),
          manifestPath: `${store.productRoot(existing)}/product.json`,
          resumed: true,
        },
        store,
      };
    }
  }
  const persistence = await store.initialize(product, validation);
  return { validation, product, persistence, store };
}

async function loadReusableAsset(store, product, asset) {
  if (asset.status !== 'generated' || !asset.final_path || !asset.validation_path) return null;
  try {
    const root = store.productRoot(product);
    const [buffer, validationText] = await Promise.all([
      readFile(resolve(root, asset.final_path)),
      readFile(resolve(root, asset.validation_path), 'utf8'),
    ]);
    const validation = JSON.parse(validationText);
    const actualHash = createHash('sha256').update(buffer).digest('hex');
    if (
      validation.status !== 'passed'
      || validation.metrics?.content_sha256 !== actualHash
      || validation.processing?.version !== PIXEL_ART_PROCESSING_VERSION
    ) return null;
    return {
      asset_id: asset.asset_id,
      status: 'passed',
      validation,
      source_path: asset.source_path,
      final_path: asset.final_path,
      validation_path: asset.validation_path,
      preview_path: `previews/${asset.asset_key}-transparency.png`,
      provider: product.generation_provider.provider,
      model: product.generation_provider.model,
      seed: asset.seed,
      estimated_cost: 0,
      resumed: true,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadExistingSource(store, product, asset) {
  if (!asset.source_path) return null;
  try {
    return {
      buffer: await readFile(resolve(store.productRoot(product), asset.source_path)),
      format: asset.source_path.split('.').at(-1) || 'png',
      provider: product.generation_provider.provider,
      model: product.generation_provider.model,
      seed: asset.seed,
      estimated_cost: 0,
      reprocessed: true,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function generateDigitalAssetProduct(options) {
  const planned = await planDigitalAssetProduct({ ...options, resume: true });
  if (options.onProgress) {
    await options.onProgress({
      type: 'generation_started',
      product: planned.product,
      total: planned.product.assets.length,
      at: options.now || new Date().toISOString(),
    });
  }
  const adapter = options.adapter || new OllamaImageAdapter(options.config.generation);
  const readiness = await adapter.checkReadiness();
  if (readiness.status !== 'ready') throw new Error(readiness.detail);

  return withGenerationLock({ projectRoot: options.projectRoot }, async () => {
    const resourceReport = await assertGenerationResourcesAvailable(options.config, {
      fetchImpl: options.fetchImpl,
    });
    let product = ProductSpecificationSchema.parse({
      ...planned.product,
      status: 'generating',
      approvals: { ...planned.product.approvals, generation: 'approved' },
      updated_at: options.now || new Date().toISOString(),
    });
    await planned.store.saveProduct(product);

    const results = [];
    for (let index = 0; index < product.assets.length; index += 1) {
      const asset = product.assets[index];
      if (options.onProgress) {
        await options.onProgress({
          type: 'asset_started',
          product,
          asset,
          index,
          total: product.assets.length,
          at: new Date().toISOString(),
        });
      }
      const reusable = await loadReusableAsset(planned.store, product, asset);
      if (reusable) {
        results.push(reusable);
        if (options.onProgress) {
          await options.onProgress({
            type: 'asset_completed',
            product,
            asset,
            result: reusable,
            index,
            total: product.assets.length,
            at: new Date().toISOString(),
          });
        }
        continue;
      }
      const generated = await loadExistingSource(planned.store, product, asset)
        || await adapter.generateAsset({
          asset,
          sourceWidth: options.opportunity.generation.source_width,
          sourceHeight: options.opportunity.generation.source_height,
        });
      const paths = planned.store.assetPaths(product, asset, generated.format);
      if (!generated.reprocessed) await writeBuffer(paths.source, generated.buffer);

      const processed = await processPixelArtAsset(generated.buffer, {
        width: product.style.width,
        height: product.style.height,
        maxPaletteColors: product.style.max_palette_colors,
        chromaKey: product.style.chroma_key,
        chromaTolerance: options.config.generation.chroma_tolerance,
        alphaMode: asset.alpha_mode,
        alphaPalette: asset.alpha_palette,
        alphaTolerance: asset.alpha_tolerance,
      });
      await writeBuffer(paths.final, processed.buffer);
      const report = await validateGeneratedAsset(processed.buffer, {
        width: product.style.width,
        height: product.style.height,
        maxPaletteColors: product.style.max_palette_colors,
        minimumTransparentRatio: options.config.validation.minimum_transparent_ratio,
        forbiddenChroma: processed.detected_chroma_key,
        chromaTolerance: 45,
        maximumChromaRatio: 0,
      });
      await writeFile(paths.validation, `${JSON.stringify({
        ...report,
        processing: {
          version: processed.processing_version,
          source: processed.source,
          extracted_bounds: processed.extracted_bounds,
          removed_chroma_pixels: processed.removed_chroma_pixels,
          removed_non_palette_pixels: processed.removed_non_palette_pixels,
          alpha_mode: processed.alpha_mode,
          detected_chroma_key: processed.detected_chroma_key,
          border_chroma_match_ratio: processed.border_chroma_match_ratio,
          requested_chroma_distance: processed.requested_chroma_distance,
        },
      }, null, 2)}\n`, 'utf8');
      await writeBuffer(paths.preview, await createTransparencyPreview(processed.buffer));

      const root = planned.store.productRoot(product);
      results.push({
        asset_id: asset.asset_id,
        status: report.status,
        validation: report,
        source_path: relative(root, paths.source).replaceAll('\\', '/'),
        final_path: relative(root, paths.final).replaceAll('\\', '/'),
        validation_path: relative(root, paths.validation).replaceAll('\\', '/'),
        preview_path: relative(root, paths.preview).replaceAll('\\', '/'),
        provider: generated.provider,
        model: generated.model,
        seed: generated.seed,
        estimated_cost: 0,
        reprocessed: generated.reprocessed === true,
      });
      const latest = results.at(-1);
      product = ProductSpecificationSchema.parse({
        ...product,
        assets: product.assets.map((item) => item.asset_id === asset.asset_id
          ? {
            ...item,
            status: latest.status === 'passed' ? 'generated' : 'failed',
            source_path: latest.source_path,
            final_path: latest.final_path,
            validation_path: latest.validation_path,
          }
          : item),
        updated_at: options.now || new Date().toISOString(),
      });
      await planned.store.saveProduct(product);
      if (options.onProgress) {
        await options.onProgress({
          type: 'asset_completed',
          product,
          asset: product.assets[index],
          result: latest,
          index,
          total: product.assets.length,
          at: new Date().toISOString(),
        });
      }
    }

    const resultById = new Map(results.map((result) => [result.asset_id, result]));
    product = ProductSpecificationSchema.parse({
      ...product,
      status: 'awaiting_asset_review',
      assets: product.assets.map((asset) => {
        const result = resultById.get(asset.asset_id);
        return {
          ...asset,
          status: result?.status === 'passed' ? 'generated' : 'failed',
          source_path: result?.source_path || null,
          final_path: result?.final_path || null,
          validation_path: result?.validation_path || null,
        };
      }),
      updated_at: options.now || new Date().toISOString(),
    });
    await planned.store.saveProduct(product);
    if (options.onProgress) {
      await options.onProgress({
        type: 'assets_completed',
        product,
        total: product.assets.length,
        at: new Date().toISOString(),
      });
    }

    return {
      product,
      validation: planned.validation,
      generation: results,
      resource_preflight: resourceReport,
      gates: {
        all_assets_valid: results.every((result) => result.status === 'passed'),
        human_review_required: true,
        distribution_ready: false,
      },
      cost: { currency: 'EUR', incurred: 0, estimated: 0 },
      persistence: planned.persistence,
    };
  });
}
