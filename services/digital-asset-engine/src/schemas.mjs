import { z } from 'zod';

const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const SemanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/u);

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

const EffectAnchorSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

const WeaponMuzzleAnchorSchema = z.union([
  EffectAnchorSchema,
  z.object({
    strategy: z.literal('rightmost_opaque'),
    terminal_band_width: z.number().int().min(1).max(32).default(4),
    alpha_threshold: z.number().int().min(1).max(255).default(128),
  }),
]);

const EffectFrameSchema = z.object({
  frame: z.number().int().nonnegative(),
  duration_ms: z.number().int().min(20).max(10_000),
  phase: z.string().min(1),
  prompt: z.string().min(1),
  seed: z.number().int().nonnegative(),
  transform: z.object({
    scale: z.number().min(0.1).max(2),
    opacity: z.number().min(0.1).max(1),
    density: z.number().min(0.1).max(1),
  }).optional(),
});

export const EffectPilotSchema = z.object({
  schema_version: z.literal('1.0'),
  pilot_id: IdentifierSchema,
  product_slug: IdentifierSchema,
  source_asset_key: IdentifierSchema,
  status: z.literal('planned'),
  purpose: z.string().min(1),
  style: z.object({
    medium: z.literal('pixel_art'),
    perspective: z.string().min(1),
    palette: z.array(HexColorSchema).min(2).max(256),
    max_palette_colors: z.number().int().min(2).max(256),
    chroma_key: HexColorSchema,
    source_width: z.number().int().min(64).max(4096),
    source_height: z.number().int().min(64).max(4096),
  }),
  weapon_preview: z.object({
    canvas: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    weapon_position: EffectAnchorSchema,
    muzzle_anchor: WeaponMuzzleAnchorSchema,
    projectile_travel_preview: z.object({
      canvas: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
      start_gap_px: z.number().int().nonnegative().default(0),
      end_margin_right_px: z.number().int().nonnegative().default(0),
      frame_count: z.number().int().min(2).max(32),
      frame_duration_ms: z.number().int().min(20).max(2000),
    }).optional(),
  }),
  effects: z.array(z.object({
    effect_key: IdentifierSchema,
    name: z.string().min(1),
    kind: z.enum(['projectile', 'muzzle_flash', 'impact_decay']),
    canvas: z.object({
      width: z.number().int().min(8).max(1024),
      height: z.number().int().min(8).max(1024),
      padding: z.number().int().min(0).max(128),
    }),
    placement: z.enum(['center', 'west_center']),
    origin: EffectAnchorSchema,
    origin_contact_required: z.boolean().default(false),
    origin_tolerance: z.number().int().min(0).max(64).default(6),
    generation: z.discriminatedUnion('strategy', [
      z.object({ strategy: z.literal('independent') }),
      z.object({
        strategy: z.literal('keyframe_transform'),
        keyframe: z.number().int().nonnegative(),
      }),
    ]).default({ strategy: 'independent' }),
    playback: z.enum(['once', 'loop']),
    frames: z.array(EffectFrameSchema).min(1).max(32),
  })).min(1).max(12),
}).superRefine((pilot, context) => {
  const travelPreview = pilot.weapon_preview.projectile_travel_preview;
  if (travelPreview && travelPreview.end_margin_right_px >= travelPreview.canvas.width) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Projectile travel preview right margin must be smaller than its canvas.',
      path: ['weapon_preview', 'projectile_travel_preview', 'end_margin_right_px'],
    });
  }
  const keys = new Set();
  for (const effect of pilot.effects) {
    if (keys.has(effect.effect_key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate effect key: ${effect.effect_key}`,
        path: ['effects'],
      });
    }
    keys.add(effect.effect_key);
    if (effect.origin.x >= effect.canvas.width || effect.origin.y >= effect.canvas.height) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Effect origin must be inside the ${effect.effect_key} canvas.`,
        path: ['effects'],
      });
    }
    if (effect.generation.strategy === 'keyframe_transform') {
      if (effect.generation.keyframe >= effect.frames.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${effect.effect_key} keyframe must identify an existing frame.`,
          path: ['effects'],
        });
      }
      if (effect.frames.some((frame) => !frame.transform)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${effect.effect_key} requires a transform for every derived sequence frame.`,
          path: ['effects'],
        });
      }
    }
    const expectedFrames = Array.from({ length: effect.frames.length }, (_, index) => index);
    if (JSON.stringify(effect.frames.map((frame) => frame.frame)) !== JSON.stringify(expectedFrames)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${effect.effect_key} frame numbers must be contiguous and zero-based.`,
        path: ['effects'],
      });
    }
  }
});

export const EffectBatchPlanSchema = z.object({
  schema_version: z.literal('1.0'),
  batch_id: IdentifierSchema,
  product_slug: IdentifierSchema,
  weapons: z.array(z.object({
    source_asset_key: IdentifierSchema,
    name: z.string().min(1),
    profile: z.enum(['compact', 'standard', 'heavy']),
    seed_base: z.number().int().nonnegative(),
    projectile_description: z.string().min(1),
    muzzle_description: z.string().min(1),
    impact_description: z.string().min(1),
  })).min(1).max(25),
}).superRefine((plan, context) => {
  const keys = new Set();
  for (const weapon of plan.weapons) {
    if (keys.has(weapon.source_asset_key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate batch weapon: ${weapon.source_asset_key}`,
        path: ['weapons'],
      });
    }
    keys.add(weapon.source_asset_key);
  }
});

export const ProductExtensionPlanSchema = z.object({
  schema_version: z.literal('1.0'),
  extension_id: IdentifierSchema,
  product_slug: IdentifierSchema,
  title: z.string().min(1),
  base_version: SemanticVersionSchema,
  target_version: SemanticVersionSchema,
  base_manifest_hash: Sha256Schema,
  effects_review_id: IdentifierSchema,
  effects_bundle_hash: Sha256Schema,
  release_notes: z.array(z.string().min(1)).min(1),
  quality_holds: z.array(z.object({
    hold_id: IdentifierSchema,
    status: z.literal('open'),
    affected_asset_keys: z.array(IdentifierSchema).default([]),
    note: z.string().min(3),
  })).default([]),
}).superRefine((plan, context) => {
  const parse = (value) => value.split('.').map(Number);
  const base = parse(plan.base_version);
  const target = parse(plan.target_version);
  const isLater = target.some((value, index) => (
    value > base[index] && target.slice(0, index).every((part, partIndex) => part === base[partIndex])
  ));
  if (!isLater) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Extension target version must be later than its base version.',
      path: ['target_version'],
    });
  }
});
