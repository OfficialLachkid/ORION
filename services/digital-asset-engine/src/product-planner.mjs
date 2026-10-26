import { createStableId } from './ids.mjs';
import { resolveAssetRecipe } from './asset-recipe-registry.mjs';
import { applyInitialReleasePricingPolicy } from './pricing-policy.mjs';
import { ProductSpecificationSchema } from './schemas.mjs';

export function slugify(value) {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
}

function buildGenerationPrompt(opportunity, asset) {
  const style = opportunity.generation;
  const palette = style.palette.join(', ');
  return [
    `Create one original ${style.medium.replaceAll('_', ' ')} game asset: ${asset.description}.`,
    `Theme: ${opportunity.theme}. Product context: ${opportunity.product_type}.`,
    `Perspective: ${style.perspective}. ${style.outline}. ${style.lighting}.`,
    `Use a cohesive limited palette based on: ${palette}.`,
    ...asset.prompt_notes.map((note) => `${note.replace(/[.!?]$/u, '')}.`),
    'Show exactly one isolated object, completely visible, centered, with generous empty space.',
    `Use a flat solid ${style.chroma_key.toUpperCase()} background only. No floor, shadow, glow, border, frame, text, logo, watermark, scenery, or extra objects.`,
    'Use crisp hard pixel edges and deliberate pixel clusters; avoid smooth vector edges, blur, gradients, antialiasing, and photorealism.',
    `Do not reference, imitate, or reproduce: ${opportunity.risk.prohibited_references.join(', ') || 'any existing franchise, game, artist, or asset pack'}.`,
  ].join(' ');
}

export function createProductSpecification(validation, config, options = {}) {
  if (!validation.generation_eligible) {
    throw new Error(`Opportunity ${validation.opportunity.opportunity_id} failed: ${validation.failures.join(', ')}.`);
  }
  const opportunity = validation.opportunity;
  const now = options.now || validation.validated_at;
  const slug = slugify(opportunity.title);
  const productId = createStableId('asset-product', {
    opportunityId: opportunity.opportunity_id,
    title: opportunity.title,
    theme: opportunity.theme,
  });

  return ProductSpecificationSchema.parse({
    schema_version: '1.0',
    product_id: productId,
    opportunity_id: opportunity.opportunity_id,
    slug,
    title: opportunity.title,
    version: '0.1.0',
    status: 'planned',
    category: opportunity.category,
    product_type: opportunity.product_type,
    theme: opportunity.theme,
    target_audience: opportunity.target_audience,
    style: {
      medium: opportunity.generation.medium,
      perspective: opportunity.generation.perspective,
      width: opportunity.generation.width,
      height: opportunity.generation.height,
      max_palette_colors: opportunity.generation.max_palette_colors,
      palette: opportunity.generation.palette,
      outline: opportunity.generation.outline,
      lighting: opportunity.generation.lighting,
      background: opportunity.generation.background,
      chroma_key: opportunity.generation.chroma_key,
    },
    assets: opportunity.generation.assets.map((asset, index) => ({
      asset_id: createStableId('asset', { productId, assetKey: asset.asset_key }),
      asset_key: asset.asset_key,
      name: asset.name,
      kind: asset.kind,
      description: asset.description,
      generation_prompt: buildGenerationPrompt(opportunity, asset),
      alpha_mode: asset.alpha_mode,
      alpha_palette: asset.alpha_palette,
      alpha_tolerance: asset.alpha_tolerance,
      production_recipe: resolveAssetRecipe(asset.kind),
      seed: (opportunity.generation.seed ?? config.generation.seed) + index,
      status: 'planned',
      source_path: null,
      final_path: null,
      validation_path: null,
    })),
    pricing: {
      base_price: applyInitialReleasePricingPolicy(
        opportunity.commercial.base_price,
        opportunity.generation.assets.length,
      ),
      marketplace_prices: {},
      human_approval_required: true,
    },
    distribution: {
      marketplaces: opportunity.commercial.marketplace_candidates,
      status: 'not_started',
    },
    license: {
      status: 'draft',
      redistribution_of_raw_assets: false,
    },
    generation_provider: {
      provider: 'ollama',
      model: config.generation.model,
      estimated_cost: 0,
      execution: 'local',
    },
    approvals: {
      generation: 'pending',
      distribution: 'pending',
    },
    created_at: now,
    updated_at: now,
  });
}
