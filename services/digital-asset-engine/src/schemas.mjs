import { z } from 'zod';

const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu);

export const AssetRequestSchema = z.object({
  asset_key: IdentifierSchema,
  name: z.string().min(1),
  kind: z.string().min(1),
  description: z.string().min(1),
  prompt_notes: z.array(z.string().min(1)).default([]),
});

export const ProductOpportunitySchema = z.object({
  schema_version: z.literal('1.0'),
  opportunity_id: z.string().min(1),
  status: z.literal('validated'),
  title: z.string().min(1),
  category: z.string().min(1),
  product_type: z.string().min(1),
  theme: z.string().min(1),
  target_audience: z.array(z.string().min(1)).min(1),
  observed_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  signals: z.object({
    trend_direction: z.enum(['rising', 'stable', 'falling']),
    demand: z.enum(['high', 'medium', 'low']),
    competition: z.enum(['low', 'medium', 'high', 'saturated']),
    cross_marketplace_evidence: z.enum(['strong', 'moderate', 'weak']),
    confidence: z.number().min(0).max(100),
  }),
  generation: z.object({
    medium: z.string().min(1),
    perspective: z.string().min(1),
    width: z.number().int().min(8).max(4096),
    height: z.number().int().min(8).max(4096),
    source_width: z.number().int().min(64).max(4096).default(1024),
    source_height: z.number().int().min(64).max(4096).default(1024),
    max_palette_colors: z.number().int().min(2).max(256),
    palette: z.array(HexColorSchema).min(2).max(256),
    outline: z.string().min(1),
    lighting: z.string().min(1),
    background: z.literal('transparent'),
    chroma_key: HexColorSchema.default('#ff00ff'),
    assets: z.array(AssetRequestSchema).min(1).max(100),
  }),
  commercial: z.object({
    base_price: z.object({
      amount: z.number().nonnegative(),
      currency: z.string().length(3),
    }),
    marketplace_candidates: z.array(z.string().min(1)).min(1),
  }),
  risk: z.object({
    ip_risk: z.enum(['low', 'medium', 'high']),
    prohibited_references: z.array(z.string().min(1)).default([]),
    notes: z.array(z.string().min(1)).default([]),
  }),
  evidence: z.array(z.object({
    label: z.string().min(1),
    source: z.string().min(1),
    observed_at: z.string().datetime({ offset: true }),
  })).min(1),
});

export const EngineConfigSchema = z.object({
  schema_version: z.literal('1.0'),
  operator: z.string().min(1),
  output_root: z.string().min(1),
  validation: z.object({
    minimum_confidence: z.number().min(0).max(100),
    maximum_opportunity_age_days: z.number().int().positive(),
    maximum_assets_per_product: z.number().int().positive(),
    minimum_transparent_ratio: z.number().min(0).max(1),
  }),
  generation: z.object({
    provider: z.literal('ollama'),
    endpoint: z.string().url(),
    model: z.string().min(1),
    timeout_ms: z.number().int().positive(),
    keep_alive: z.union([z.string(), z.number()]),
    steps: z.number().int().min(1).max(100),
    seed: z.number().int().nonnegative(),
    chroma_tolerance: z.number().int().min(0).max(441),
    negative_prompt: z.string(),
    require_local_endpoint: z.boolean(),
  }),
});

export const ProductSpecificationSchema = z.object({
  schema_version: z.literal('1.0'),
  product_id: IdentifierSchema,
  opportunity_id: z.string().min(1),
  slug: IdentifierSchema,
  title: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  status: z.enum(['planned', 'generating', 'awaiting_asset_review', 'approved', 'rejected']),
  category: z.string().min(1),
  product_type: z.string().min(1),
  theme: z.string().min(1),
  target_audience: z.array(z.string().min(1)).min(1),
  style: z.object({
    medium: z.string().min(1),
    perspective: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    max_palette_colors: z.number().int().min(2).max(256),
    palette: z.array(HexColorSchema).min(2),
    outline: z.string().min(1),
    lighting: z.string().min(1),
    background: z.literal('transparent'),
    chroma_key: HexColorSchema,
  }),
  assets: z.array(z.object({
    asset_id: IdentifierSchema,
    asset_key: IdentifierSchema,
    name: z.string().min(1),
    kind: z.string().min(1),
    description: z.string().min(1),
    generation_prompt: z.string().min(1),
    seed: z.number().int().nonnegative(),
    status: z.enum(['planned', 'generated', 'failed']),
    source_path: z.string().nullable(),
    final_path: z.string().nullable(),
    validation_path: z.string().nullable(),
  })).min(1),
  pricing: z.object({
    base_price: z.object({ amount: z.number().nonnegative(), currency: z.string().length(3) }),
    marketplace_prices: z.record(z.string(), z.number().nonnegative()),
    human_approval_required: z.literal(true),
  }),
  distribution: z.object({
    marketplaces: z.array(z.string().min(1)).min(1),
    status: z.literal('not_started'),
  }),
  license: z.object({
    status: z.literal('draft'),
    redistribution_of_raw_assets: z.literal(false),
  }),
  generation_provider: z.object({
    provider: z.literal('ollama'),
    model: z.string().min(1),
    estimated_cost: z.literal(0),
    execution: z.literal('local'),
  }),
  approvals: z.object({
    generation: z.enum(['pending', 'approved']),
    distribution: z.literal('pending'),
  }),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
