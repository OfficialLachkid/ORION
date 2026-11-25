import { z } from 'zod';

const KeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const AutomationModeSchema = z.enum([
  'manual',
  'authorized_api',
  'authorized_browser',
  'public_feed',
  'prohibited',
]);
const AuthorizationSchema = z.enum([
  'operator_provided',
  'unverified',
  'written_permission',
  'published_api',
  'published_feed',
  'prohibited_by_terms',
]);

const PermissionEvidenceSchema = z.object({
  source_url: z.string().url(),
  verified_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }).optional(),
  note: z.string().min(1).max(500),
}).strict();

const CapabilitySchema = z.object({
  mode: AutomationModeSchema,
  authorization: AuthorizationSchema,
  permission_evidence: PermissionEvidenceSchema.optional(),
}).strict();

const MarketplaceSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  discovery: CapabilitySchema,
  submission: CapabilitySchema,
}).strict();

const ChannelProfileSchema = z.object({
  key: KeySchema,
  category: KeySchema,
  platform: z.enum(['youtube_shorts', 'instagram_reels', 'tiktok']),
  account_key: z.string().min(1),
  enabled: z.boolean(),
}).strict();

const SearchProfileSchema = z.object({
  key: KeySchema,
  channel_profile_key: KeySchema,
  enabled: z.boolean(),
  topic: z.object({
    label: z.string().min(1),
    include_terms: z.array(z.string().min(1)).min(1).max(50),
    exclude_terms: z.array(z.string().min(1)).max(50),
  }).strict(),
  rights: z.object({
    commercial_use_required: z.literal(true),
    campaign_source_license_required: z.literal(true),
    underlying_ip_permission_required: z.boolean(),
    licensed_music_must_be_absent: z.boolean(),
    unknown_rights_action: z.literal('block'),
  }).strict(),
}).strict();

function addDuplicateIssues(items, path, context) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate key: ${item.key}`,
        path: [path, index, 'key'],
      });
    }
    seen.add(item.key);
  }
}

export const ClippingEngineConfigSchema = z.object({
  schema_version: z.literal('1.0'),
  enabled: z.boolean(),
  archive_root: z.string().min(1),
  scratch_root: z.string().min(1),
  budgets: z.object({
    max_candidates_per_run: z.number().int().min(1).max(100),
    max_runs_per_day: z.number().int().min(1).max(24),
    max_in_flight_inference_jobs: z.literal(1),
    supabase_egress_target_mb_per_month: z.number().positive().max(25),
    supabase_egress_review_mb_per_month: z.number().positive().max(50),
  }).strict(),
  models: z.object({
    qualification: z.object({
      provider: z.literal('ollama'),
      endpoint: z.string().url(),
      model: z.string().min(1),
      keep_alive: z.union([z.string().min(1), z.number().int().nonnegative()]),
      require_smoke_test: z.boolean(),
    }).strict(),
  }).strict(),
  marketplaces: z.array(MarketplaceSchema).min(1),
  channel_profiles: z.array(ChannelProfileSchema).min(2),
  search_profiles: z.array(SearchProfileSchema).min(2),
}).strict().superRefine((config, context) => {
  addDuplicateIssues(config.marketplaces, 'marketplaces', context);
  addDuplicateIssues(config.channel_profiles, 'channel_profiles', context);
  addDuplicateIssues(config.search_profiles, 'search_profiles', context);

  const channelKeys = new Set(config.channel_profiles.map((profile) => profile.key));
  for (const [index, profile] of config.search_profiles.entries()) {
    if (!channelKeys.has(profile.channel_profile_key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown channel profile: ${profile.channel_profile_key}`,
        path: ['search_profiles', index, 'channel_profile_key'],
      });
    }
  }

  if (config.budgets.supabase_egress_target_mb_per_month
      > config.budgets.supabase_egress_review_mb_per_month) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Supabase egress target must not exceed the review threshold.',
      path: ['budgets', 'supabase_egress_target_mb_per_month'],
    });
  }
});

export {
  AuthorizationSchema,
  AutomationModeSchema,
  CapabilitySchema,
};
