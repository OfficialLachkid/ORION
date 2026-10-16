import { z } from 'zod';
import { ProductOpportunitySchema } from '../../digital-asset-engine/src/schemas.mjs';

const Identifier = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const ResearchConfigSchema = z.object({
  schema_version: z.literal('1.0'),
  archive_root: z.string().min(1),
  minimum_snapshots: z.number().int().min(2).default(2),
  maximum_items_per_view: z.number().int().min(1).max(100).default(30),
  request_delay_ms: z.number().int().min(0).max(60_000).default(1500),
  scheduling: z.object({
    enabled: z.boolean().default(false),
    cadence_hours: z.number().int().min(1).max(168).default(24),
  }),
  source: z.object({
    id: Identifier,
    marketplace: z.literal('itch.io'),
    user_agent: z.string().min(10),
    capabilities: z.object({
      access_method: z.literal('public_html'),
      observed_fields: z.array(z.enum(['rank', 'title', 'creator', 'price_text', 'summary', 'listing_url'])).min(1),
      unavailable_fields: z.array(z.enum(['sales', 'revenue', 'downloads', 'conversion_rate'])).min(1),
      minimum_cadence_hours: z.number().int().min(24),
    }),
    views: z.array(z.object({
      id: Identifier,
      url: z.string().url().refine((value) => new URL(value).hostname === 'itch.io'),
      signal: z.enum(['supply_activity', 'marketplace_rank_proxy']),
    })).min(1).max(4),
  }),
  model: z.object({
    provider: z.literal('ollama'),
    endpoint: z.string().url(),
    model: z.string().min(1),
    timeout_ms: z.number().int().positive(),
  }),
  discord: z.object({
    category_name: z.string().min(1),
    channel_name: Identifier,
  }),
});

export const ResearchObservationSchema = z.object({
  observation_id: z.string().uuid(),
  run_id: z.string().uuid(),
  source_id: Identifier,
  view_id: Identifier,
  signal: z.enum(['supply_activity', 'marketplace_rank_proxy']),
  observed_at: z.string().datetime({ offset: true }),
  rank: z.number().int().positive(),
  listing_url: z.string().url(),
  title: z.string().min(1),
  creator: z.string().default(''),
  price_text: z.string().default(''),
  summary: z.string().default(''),
  tags: z.array(z.string()).default([]),
  evidence_hash: Sha256,
});

export const ResearchRecommendationSchema = z.object({
  schema_version: z.literal('1.0'),
  recommendation_id: Identifier.max(48),
  action: z.enum(['new_product', 'extend_existing_product']),
  existing_product_slug: Identifier.nullable().default(null),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(1000),
  rationale: z.array(z.string().min(1)).min(1).max(8),
  confidence: z.number().min(0).max(100),
  evidence_ids: z.array(z.string().uuid()).min(1).max(30),
  opportunity: ProductOpportunitySchema,
}).superRefine((value, context) => {
  if (value.action === 'new_product' && value.existing_product_slug !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['existing_product_slug'], message: 'New products cannot name an existing product.' });
  }
  if (value.action === 'extend_existing_product' && !value.existing_product_slug) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['existing_product_slug'], message: 'Extensions must name the existing product.' });
  }
});

export const ResearchReviewDecisionSchema = z.object({
  recommendation_id: Identifier,
  evidence_hash: Sha256,
  decision: z.enum(['approve_handoff', 'monitor', 'reject']),
  reviewer_discord_id: z.string().min(1),
  reason: z.string().default(''),
  decided_at: z.string().datetime({ offset: true }),
  discord_message_id: z.string().min(1),
  discord_interaction_id: z.string().min(1),
});
