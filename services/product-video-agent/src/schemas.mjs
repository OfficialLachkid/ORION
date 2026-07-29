import { z } from 'zod';

const IdentifierSchema = z.string().min(1).max(160).regex(/^[a-z0-9][-a-z0-9._:]*$/u);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const UrlSchema = z.string().url();
const NonEmptyTextSchema = z.string().trim().min(1);
const PercentageSchema = z.number().min(0).max(1);
const ScoreValueSchema = z.number().min(0).max(100);

export const ShortFormPlatformSchema = z.enum([
  'youtube_shorts',
  'instagram_reels',
  'tiktok',
]);

export const MoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
}).strict();

export const ProductSchema = z.object({
  product_id: IdentifierSchema,
  canonical_name: NonEmptyTextSchema,
  brand: NonEmptyTextSchema,
  category: NonEmptyTextSchema,
  description: NonEmptyTextSchema,
  specifications: z.record(z.string()),
  current_price: MoneySchema.nullable(),
  list_price: MoneySchema.nullable(),
  rating: z.number().min(0).max(5).nullable(),
  review_count: z.number().int().nonnegative(),
  marketplace_source: NonEmptyTextSchema,
  source_product_id: NonEmptyTextSchema,
  source_url: UrlSchema,
  imported_at: IsoDateTimeSchema,
  tags: z.array(NonEmptyTextSchema),
}).strict();

export const SourceSnapshotSchema = z.object({
  snapshot_id: IdentifierSchema,
  product_id: IdentifierSchema,
  provider: NonEmptyTextSchema,
  source_url: UrlSchema,
  retrieved_at: IsoDateTimeSchema,
  retrieval_method: z.enum(['api', 'manual', 'fixture', 'permitted_browser']),
  source_access_permitted: z.boolean(),
  raw_payload: z.record(z.unknown()),
}).strict();

export const ScoreDimensionsSchema = z.object({
  visual_appeal: ScoreValueSchema,
  problem_solving_value: ScoreValueSchema,
  virality: ScoreValueSchema,
  novelty: ScoreValueSchema,
  competition: ScoreValueSchema,
  affiliate_potential: ScoreValueSchema,
}).strict();

export const ProductScoreSchema = z.object({
  score_id: IdentifierSchema,
  product_id: IdentifierSchema,
  scoring_version: NonEmptyTextSchema,
  dimensions: ScoreDimensionsSchema,
  weights: ScoreDimensionsSchema,
  overall_score: ScoreValueSchema,
  expected_roi: z.object({
    currency: z.string().length(3),
    estimated_clicks: z.number().int().nonnegative(),
    conversion_rate: PercentageSchema,
    commission_rate: PercentageSchema,
    estimated_revenue: z.number().nonnegative(),
    production_cost: z.number().nonnegative(),
    expected_net_return: z.number(),
    assumptions: z.array(NonEmptyTextSchema),
  }).strict(),
  scored_at: IsoDateTimeSchema,
}).strict();

const VideoAnalysisSchema = z.object({
  analyzer: z.literal('ffmpeg_scene_detection'),
  analyzed_at: IsoDateTimeSchema,
  duration_seconds: z.number().positive().max(86_400),
  frame_rate: z.number().positive().max(240),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scene_threshold: z.number().min(0).max(1),
  scene_boundaries_seconds: z.array(z.number().nonnegative()).max(100),
}).strict();

export const AssetProvenanceSchema = z.object({
  asset_id: IdentifierSchema,
  product_id: IdentifierSchema,
  media_type: z.enum(['image', 'video', 'audio']),
  source_provider: NonEmptyTextSchema,
  source_url: UrlSchema,
  source_page_url: UrlSchema,
  retrieved_at: IsoDateTimeSchema,
  retrieval_method: z.enum([
    'reference_only',
    'manual_upload',
    'permitted_browser',
    'api',
    'permitted_download',
    'fixture',
  ]),
  local_path: z.string().min(1).nullable(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  rights_status: z.enum(['unverified', 'verified', 'restricted', 'rejected']),
  rights_basis: z.enum([
    'unknown',
    'owned',
    'licensed',
    'merchant_permission',
    'creator_permission',
    'provider_terms',
    'public_domain',
  ]),
  rights_evidence: z.string().min(1).nullable(),
  attribution_required: z.boolean(),
  attribution_text: z.string().min(1).nullable(),
  approval_status: z.enum(['pending', 'approved', 'rejected']),
  download_status: z.enum(['not_requested', 'planned', 'downloaded', 'failed', 'blocked']),
  usage_scope: z.enum(['publication', 'internal_editor_test']),
  usage_notes: z.array(NonEmptyTextSchema),
  video_analysis: VideoAnalysisSchema.nullable().default(null),
}).strict().superRefine((asset, context) => {
  if (asset.rights_status === 'verified' && !asset.rights_evidence) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rights_evidence'],
      message: 'Verified rights require evidence.',
    });
  }

  if (asset.attribution_required && !asset.attribution_text) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attribution_text'],
      message: 'Attribution text is required when attribution is required.',
    });
  }
});

export const ProductPageMediaCandidateSchema = z.object({
  media_candidate_id: IdentifierSchema,
  product_id: IdentifierSchema,
  media_type: z.enum(['image', 'video']),
  source_provider: NonEmptyTextSchema,
  source_page_url: UrlSchema,
  source_url: UrlSchema.nullable(),
  observed_at: IsoDateTimeSchema,
  observation_method: z.enum(['api', 'manual', 'fixture', 'permitted_browser']),
  retrieval_method: z.enum([
    'reference_only',
    'manual_upload',
    'permitted_browser',
    'api',
    'permitted_download',
    'fixture',
  ]),
  local_path: z.string().min(1).nullable(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  rights_status: z.enum(['unverified', 'verified', 'restricted', 'rejected']),
  rights_basis: z.enum([
    'unknown',
    'owned',
    'licensed',
    'merchant_permission',
    'creator_permission',
    'provider_terms',
    'public_domain',
  ]),
  rights_evidence: z.string().min(1).nullable(),
  attribution_required: z.boolean(),
  attribution_text: z.string().min(1).nullable(),
  approval_status: z.enum(['pending', 'approved', 'rejected']),
  usage_scope: z.enum(['publication', 'internal_editor_test']),
  label: z.string().trim().min(1).nullable(),
  page_position: z.number().int().nonnegative().nullable(),
  status: z.enum(['reference_only', 'blocked', 'asset_record_ready']),
  blockers: z.array(NonEmptyTextSchema),
  usage_notes: z.array(NonEmptyTextSchema),
  video_analysis: VideoAnalysisSchema.nullable().default(null),
}).strict();

export const AssetAcquisitionPlanSchema = z.object({
  acquisition_plan_id: IdentifierSchema,
  asset_id: IdentifierSchema,
  source_url: UrlSchema,
  destination_path: NonEmptyTextSchema,
  status: z.enum(['planned', 'blocked']),
  blockers: z.array(NonEmptyTextSchema),
  execution_plan: z.object({
    provider: z.literal('http_download'),
    execute: z.literal(false),
  }).strict(),
  created_at: IsoDateTimeSchema,
}).strict();

export const ScriptVariantSchema = z.object({
  script_variant_id: IdentifierSchema,
  product_id: IdentifierSchema,
  angle: z.enum(['problem_solution', 'demonstration', 'comparison', 'novelty']),
  target_duration_seconds: z.number().int().min(10).max(480),
  hook: NonEmptyTextSchema,
  body: NonEmptyTextSchema,
  call_to_action: NonEmptyTextSchema,
  affiliate_disclosure: NonEmptyTextSchema,
  spoken_text: NonEmptyTextSchema,
  generation_provider: NonEmptyTextSchema,
  model: NonEmptyTextSchema,
  status: z.enum(['draft', 'awaiting_approval', 'approved', 'rejected']),
  approval_status: z.enum(['pending', 'approved', 'rejected']),
  created_at: IsoDateTimeSchema,
}).strict().superRefine((variant, context) => {
  const spokenText = variant.spoken_text.toLocaleLowerCase('en-US');
  const disclosure = variant.affiliate_disclosure.toLocaleLowerCase('en-US');
  if (spokenText.includes(disclosure) || /affiliate\s+links?|earn\s+a\s+commission/iu.test(spokenText)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['spoken_text'],
      message: 'Affiliate disclosure must remain publication metadata and cannot be narrated.',
    });
  }
});

export const ScriptRevisionSchema = z.object({
  revision_id: IdentifierSchema,
  script_variant_id: IdentifierSchema,
  previous_spoken_text: NonEmptyTextSchema,
  revised_spoken_text: NonEmptyTextSchema,
  revised_by: NonEmptyTextSchema,
  reason: NonEmptyTextSchema,
  revised_at: IsoDateTimeSchema,
}).strict();

export const OperatorScriptInputSchema = z.object({
  hook: NonEmptyTextSchema,
  body: NonEmptyTextSchema,
  call_to_action: NonEmptyTextSchema,
}).strict();

export const ScriptJobSchema = z.object({
  script_job_id: IdentifierSchema,
  product_id: IdentifierSchema,
  angle: z.enum(['problem_solution', 'demonstration', 'comparison', 'novelty']),
  target_duration_seconds: z.number().int().min(10).max(480),
  prompt_version: NonEmptyTextSchema,
  creative_brief: z.object({
    hook_goal: NonEmptyTextSchema,
    key_facts: z.array(NonEmptyTextSchema).min(1),
    prohibited_claims: z.array(NonEmptyTextSchema),
    blocked_phrases: z.array(NonEmptyTextSchema),
    editorial_direction: z.array(NonEmptyTextSchema),
    disclosure: NonEmptyTextSchema,
  }).strict(),
  model_plan: z.object({
    provider: z.enum(['ollama', 'local_stub']),
    model: NonEmptyTextSchema,
    endpoint: UrlSchema,
    execute: z.boolean(),
  }).strict(),
  status: z.enum(['planned', 'completed', 'failed']),
  estimated_cost: z.literal(0),
  created_at: IsoDateTimeSchema,
}).strict();

export const VoiceLicenseRecordSchema = z.object({
  voice_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  display_name: NonEmptyTextSchema,
  language: NonEmptyTextSchema,
  speaker_gender: z.enum(['female', 'male', 'nonbinary', 'unspecified']),
  quality: z.enum(['low', 'medium', 'high']),
  model_source_url: UrlSchema,
  model_repository_license: NonEmptyTextSchema,
  training_dataset: NonEmptyTextSchema,
  dataset_source_url: UrlSchema,
  dataset_license: NonEmptyTextSchema,
  engine_license: NonEmptyTextSchema,
  commercial_use_status: z.enum(['approved', 'review_required', 'rejected']),
  reviewed_at: IsoDateTimeSchema,
  review_notes: z.array(NonEmptyTextSchema).min(1),
}).strict();

export const VoiceOverJobSchema = z.object({
  voice_over_job_id: IdentifierSchema,
  product_id: IdentifierSchema,
  script_job_id: IdentifierSchema,
  script_variant_id: IdentifierSchema.nullable(),
  provider: z.enum(['piper', 'kokoro', 'local_stub', 'paid_stub']),
  voice_profile_id: IdentifierSchema,
  model: NonEmptyTextSchema,
  voice: NonEmptyTextSchema,
  language: NonEmptyTextSchema,
  license_record_path: NonEmptyTextSchema,
  commercial_use_status: z.enum(['approved', 'review_required', 'rejected']),
  output_path: NonEmptyTextSchema,
  status: z.enum(['planned', 'blocked', 'complete']),
  blockers: z.array(NonEmptyTextSchema),
  approval_required: z.boolean(),
  estimated_cost: z.number().nonnegative(),
  execution_plan: z.object({
    executable: NonEmptyTextSchema,
    args: z.array(z.string()),
    input: z.literal('approved_script_text'),
    execute: z.literal(false),
  }).strict(),
  created_at: IsoDateTimeSchema,
}).strict();

export const WordTimingSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  word: NonEmptyTextSchema,
  probability: PercentageSchema,
}).strict().refine((word) => word.end >= word.start, {
  message: 'Word timing end must be greater than or equal to start.',
});

export const CaptionJobSchema = z.object({
  caption_job_id: IdentifierSchema,
  product_id: IdentifierSchema,
  script_job_id: IdentifierSchema,
  voice_over_job_id: IdentifierSchema,
  provider: z.literal('faster_whisper'),
  model: NonEmptyTextSchema,
  language: NonEmptyTextSchema,
  audio_path: NonEmptyTextSchema,
  words_output_path: NonEmptyTextSchema,
  ass_output_path: NonEmptyTextSchema,
  status: z.enum(['planned', 'blocked', 'complete']),
  blockers: z.array(NonEmptyTextSchema),
  words: z.array(WordTimingSchema),
  duration_seconds: z.number().nonnegative(),
  execution_plan: z.object({
    executable: NonEmptyTextSchema,
    args: z.array(z.string()),
    execute: z.literal(false),
  }).strict(),
  created_at: IsoDateTimeSchema,
}).strict();

export const WorkflowApprovalSchema = z.object({
  approval_id: IdentifierSchema,
  product_id: IdentifierSchema,
  stage: z.enum(['script', 'asset', 'render']),
  subject_id: IdentifierSchema,
  task_id: z.string().regex(/^TASK-ORION-(SCRIPT|ASSET|RENDER)-[A-Z0-9]+$/u),
  state: z.enum(['pending', 'approved', 'rejected', 'blocked']),
  blocking_reasons: z.array(NonEmptyTextSchema),
  requested_at: IsoDateTimeSchema,
  decided_at: IsoDateTimeSchema.nullable(),
  requested_by: NonEmptyTextSchema,
  decided_by: NonEmptyTextSchema.nullable(),
  decision_reason: z.string(),
}).strict();

export const RenderTimelineClipSchema = z.object({
  clip_id: IdentifierSchema,
  asset_id: IdentifierSchema,
  sequence_index: z.number().int().nonnegative(),
  role: z.enum(['hook', 'demonstration', 'b_roll', 'detail', 'payoff']),
  media_type: z.enum(['image', 'video']),
  source_start_seconds: z.number().nonnegative(),
  duration_seconds: z.number().positive().max(60),
  fit: z.literal('cover'),
  transition_after: z.enum(['cut', 'fade']),
  transition_duration_seconds: z.number().nonnegative().max(1.5),
}).strict().superRefine((clip, context) => {
  if (clip.transition_after === 'cut' && clip.transition_duration_seconds !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transition_duration_seconds'],
      message: 'Cut transitions must have zero duration.',
    });
  }
  if (clip.transition_after === 'fade' && clip.transition_duration_seconds <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transition_duration_seconds'],
      message: 'Fade transitions require a positive duration.',
    });
  }
});

export const RenderJobSchema = z.object({
  render_job_id: IdentifierSchema,
  product_id: IdentifierSchema,
  script_job_id: IdentifierSchema,
  voice_over_job_id: IdentifierSchema,
  caption_job_id: IdentifierSchema,
  renderer: z.enum(['ffmpeg', 'local_stub']),
  render_purpose: z.enum(['publication_candidate', 'internal_editor_test']),
  publication_eligible: z.boolean(),
  watermark_required: z.boolean(),
  template_id: IdentifierSchema,
  aspect_ratio: z.literal('9:16'),
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.number().int().min(24).max(60),
  platform_targets: z.array(ShortFormPlatformSchema).min(1),
  asset_ids: z.array(IdentifierSchema),
  excluded_asset_ids: z.array(IdentifierSchema),
  timeline: z.array(RenderTimelineClipSchema),
  output_path: NonEmptyTextSchema,
  status: z.enum(['planned', 'blocked', 'complete']),
  blockers: z.array(NonEmptyTextSchema),
  estimated_cost: z.number().nonnegative(),
  execution_plan: z.object({
    executable: NonEmptyTextSchema,
    args: z.array(z.string()),
    execute: z.literal(false),
  }).strict(),
  created_at: IsoDateTimeSchema,
}).strict().superRefine((job, context) => {
  const assetIds = new Set(job.asset_ids);
  const sequenceIndexes = new Set();
  for (const clip of job.timeline) {
    if (!assetIds.has(clip.asset_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeline'],
        message: `Timeline asset ${clip.asset_id} is not listed in asset_ids.`,
      });
    }
    if (sequenceIndexes.has(clip.sequence_index)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeline'],
        message: `Timeline sequence index ${clip.sequence_index} is duplicated.`,
      });
    }
    sequenceIndexes.add(clip.sequence_index);
  }
});

export const AffiliateLinkSchema = z.object({
  affiliate_link_id: IdentifierSchema,
  product_id: IdentifierSchema,
  provider: NonEmptyTextSchema,
  destination_url: UrlSchema,
  tracking_url: UrlSchema.nullable(),
  disclosure: NonEmptyTextSchema,
  status: z.enum(['planned', 'pending', 'active', 'disabled']),
  approval_status: z.enum(['pending', 'approved', 'rejected']),
  created_at: IsoDateTimeSchema,
}).strict();

export const PublicationApprovalSchema = z.object({
  approval_id: IdentifierSchema,
  product_id: IdentifierSchema,
  publication_id: IdentifierSchema.nullable(),
  action: z.enum(['paid_usage', 'publish', 'account_change', 'external_action', 'asset_usage']),
  state: z.enum(['pending', 'approved', 'rejected', 'not_required']),
  requested_at: IsoDateTimeSchema,
  decided_at: IsoDateTimeSchema.nullable(),
  requested_by: NonEmptyTextSchema,
  decided_by: NonEmptyTextSchema.nullable(),
  reason: NonEmptyTextSchema,
}).strict();

export const PublicationSchema = z.object({
  publication_id: IdentifierSchema,
  product_id: IdentifierSchema,
  script_job_id: IdentifierSchema,
  platform: z.enum(['youtube_shorts', 'youtube', 'instagram_reels', 'tiktok']),
  status: z.enum(['draft', 'awaiting_approval', 'approved', 'published', 'failed', 'blocked']),
  approval_id: IdentifierSchema,
  title: NonEmptyTextSchema,
  description: NonEmptyTextSchema,
  hashtags: z.array(NonEmptyTextSchema),
  thumbnail_asset_id: IdentifierSchema.nullable(),
  affiliate_link_id: IdentifierSchema,
  affiliate_disclosure: NonEmptyTextSchema,
  scheduled_at: IsoDateTimeSchema.nullable(),
  published_at: IsoDateTimeSchema.nullable(),
  external_post_id: z.string().min(1).nullable(),
}).strict();

export const AnalyticsSnapshotSchema = z.object({
  analytics_snapshot_id: IdentifierSchema,
  publication_id: IdentifierSchema,
  captured_at: IsoDateTimeSchema,
  views: z.number().int().nonnegative(),
  average_view_duration_seconds: z.number().nonnegative(),
  retention_rate: PercentageSchema,
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  revenue: MoneySchema,
  production_cost: MoneySchema,
}).strict();

export const ArchiveResultSchema = z.object({
  archive_id: IdentifierSchema,
  render_job_id: IdentifierSchema,
  source_path: NonEmptyTextSchema,
  destination_path: NonEmptyTextSchema,
  location_type: z.enum(['external_ssd_archive', 'mac_desktop_fallback']),
  device_id: NonEmptyTextSchema,
  status: z.enum(['archived', 'pending_external_ssd']),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  size_bytes: z.number().int().nonnegative(),
  verified_at: IsoDateTimeSchema,
  source_retained: z.boolean(),
  reused_existing_copy: z.boolean(),
  preferred_root_configured: z.boolean(),
}).strict();

export const AssetStorageLocationSchema = z.object({
  storage_location_id: IdentifierSchema,
  asset_id: IdentifierSchema,
  path: NonEmptyTextSchema,
  location_type: z.enum(['external_ssd_archive', 'mac_desktop_fallback']),
  device_id: NonEmptyTextSchema,
  status: z.enum(['archived', 'pending_external_ssd']),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  size_bytes: z.number().int().nonnegative(),
  verified_at: IsoDateTimeSchema,
  source_retained: z.boolean(),
  reused_existing_copy: z.boolean(),
  preferred_root_configured: z.boolean(),
  retention_class: z.enum(['permanent', 'temporary_source']).default('permanent'),
  delete_after: IsoDateTimeSchema.nullable().default(null),
  deletion_status: z.enum(['retained', 'deleted']).default('retained'),
  deleted_at: IsoDateTimeSchema.nullable().default(null),
}).strict();

export const PipelineConfigSchema = z.object({
  schema_version: z.literal('1.0.0'),
  run_at: IsoDateTimeSchema,
  output_directory: NonEmptyTextSchema,
  content_strategy: z.object({
    primary: z.literal('short_form'),
    platforms: z.array(ShortFormPlatformSchema).min(1),
    long_form: z.object({
      enabled: z.literal(false),
      target_duration_minutes: z.object({
        min: z.literal(2),
        max: z.literal(5),
      }).strict(),
    }).strict(),
  }).strict(),
  script: z.object({
    provider: z.enum(['ollama', 'local_stub']),
    model: NonEmptyTextSchema,
    endpoint: UrlSchema,
    prompt_version: NonEmptyTextSchema,
    keep_alive: NonEmptyTextSchema,
    operator_review_required: z.literal(true),
    variants: z.array(z.object({
      angle: z.enum(['problem_solution', 'demonstration', 'comparison', 'novelty']),
      target_duration_seconds: z.number().int().min(10).max(60),
    }).strict()).min(1),
  }).strict(),
  voice: z.object({
    provider: z.enum(['piper', 'kokoro', 'local_stub']),
    executable: NonEmptyTextSchema,
    data_directory: NonEmptyTextSchema,
    script_path: NonEmptyTextSchema.optional(),
    assignment_strategy: z.enum(['round_robin', 'default_only']),
    default_profile_id: IdentifierSchema,
    profiles: z.array(z.object({
      profile_id: IdentifierSchema,
      model: NonEmptyTextSchema,
      runtime_model: NonEmptyTextSchema.optional(),
      voice: NonEmptyTextSchema,
      language: NonEmptyTextSchema,
      license_record_path: NonEmptyTextSchema,
      synthesis: z.object({
        length_scale: z.number().min(0.5).max(2).optional(),
        noise_scale: z.number().min(0).max(2).optional(),
        noise_w_scale: z.number().min(0).max(2).optional(),
        sentence_silence: z.number().min(0).max(2).optional(),
        volume: z.number().min(0.1).max(2).optional(),
        speed: z.number().min(0.5).max(2).optional(),
        prosody_mode: z.enum(['full_context', 'sentence_isolated']).optional(),
        sentence_pause_ms: z.number().int().min(0).max(1500).optional(),
      }).strict(),
    }).strict()).min(1),
  }).strict(),
  captions: z.object({
    provider: z.literal('faster_whisper'),
    executable: NonEmptyTextSchema,
    script_path: NonEmptyTextSchema,
    model: NonEmptyTextSchema,
    max_words_per_line: z.number().int().min(2).max(4),
  }).strict(),
  render: z.object({
    renderer: z.enum(['ffmpeg', 'local_stub']),
    executable: NonEmptyTextSchema,
    purpose: z.enum(['publication_candidate', 'internal_editor_test']),
    template_id: IdentifierSchema,
    template_path: NonEmptyTextSchema,
    fps: z.number().int().min(24).max(60),
  }).strict(),
  archive: z.object({
    enabled: z.boolean(),
    preferred_root: z.string().min(1).nullable(),
    fallback_root: z.string().min(1).nullable(),
    device_id: NonEmptyTextSchema,
    cleanup_verified_working_media: z.boolean(),
    temporary_source_retention_days: z.object({
      after_final_approval: z.number().int().min(1).max(90),
      after_rejection: z.number().int().min(1).max(30),
    }).strict(),
  }).strict().default({
    enabled: true,
    preferred_root: null,
    fallback_root: null,
    device_id: 'vbj-orchestrator-01',
    cleanup_verified_working_media: true,
    temporary_source_retention_days: {
      after_final_approval: 14,
      after_rejection: 7,
    },
  }),
  affiliate_disclosure: NonEmptyTextSchema,
  operator: NonEmptyTextSchema,
}).strict();

const RuntimeComponentSchema = z.object({
  status: z.enum(['ready', 'blocked']),
  detail: NonEmptyTextSchema,
}).strict();

export const RuntimeReadinessReportSchema = z.object({
  checked_at: IsoDateTimeSchema,
  overall: z.enum(['ready', 'blocked']),
  script_generation_ready: z.boolean(),
  unattended_script_generation_ready: z.literal(false),
  components: z.object({
    ollama: RuntimeComponentSchema,
    local_tts: RuntimeComponentSchema,
    voice_model: RuntimeComponentSchema,
    voice_license: RuntimeComponentSchema,
    faster_whisper: RuntimeComponentSchema,
    ffmpeg: RuntimeComponentSchema,
  }).strict(),
  local_render_stack_ready: z.boolean(),
}).strict();

export const OutputManifestSchema = z.object({
  schema_version: z.literal('1.0.0'),
  run_id: IdentifierSchema,
  run_at: IsoDateTimeSchema,
  mode: z.enum(['dry_run', 'local_preview', 'local_narration', 'local_render', 'internal_editor_test']),
  adapter: NonEmptyTextSchema,
  content_strategy: PipelineConfigSchema.shape.content_strategy,
  products: z.array(ProductSchema).min(1),
  source_snapshots: z.array(SourceSnapshotSchema).min(1),
  product_scores: z.array(ProductScoreSchema).min(1),
  media_candidates: z.array(ProductPageMediaCandidateSchema).default([]),
  assets: z.array(AssetProvenanceSchema),
  asset_acquisition_plans: z.array(AssetAcquisitionPlanSchema),
  script_jobs: z.array(ScriptJobSchema).min(1),
  script_variants: z.array(ScriptVariantSchema),
  script_revisions: z.array(ScriptRevisionSchema),
  voice_license: VoiceLicenseRecordSchema,
  voice_licenses: z.array(VoiceLicenseRecordSchema).min(1),
  voice_over_jobs: z.array(VoiceOverJobSchema).min(1),
  caption_jobs: z.array(CaptionJobSchema).min(1),
  render_jobs: z.array(RenderJobSchema).min(1),
  workflow_approvals: z.array(WorkflowApprovalSchema).min(1),
  affiliate_links: z.array(AffiliateLinkSchema).min(1),
  publication_approvals: z.array(PublicationApprovalSchema).min(1),
  publications: z.array(PublicationSchema).min(1),
  analytics_snapshots: z.array(AnalyticsSnapshotSchema),
  archive_results: z.array(ArchiveResultSchema).default([]),
  asset_storage_locations: z.array(AssetStorageLocationSchema).default([]),
  gates: z.object({
    eligible_asset_ids: z.array(IdentifierSchema),
    blocked_asset_ids: z.array(IdentifierSchema),
    render_ready: z.boolean(),
    publish_ready: z.literal(false),
    approval_required: z.literal(true),
  }).strict(),
  external_calls: z.object({
    marketplace: z.literal('stubbed'),
    asset_download: z.literal('stubbed'),
    model: z.enum(['stubbed', 'local_executed']),
    local_tts: z.enum(['stubbed', 'local_executed']),
    local_caption: z.enum(['stubbed', 'local_executed']),
    local_render: z.enum(['stubbed', 'local_executed']),
    paid_tts: z.literal('stubbed'),
    publishing: z.literal('stubbed'),
  }).strict(),
  cost: z.object({
    currency: z.string().length(3),
    incurred: z.literal(0),
    estimated: z.literal(0),
  }).strict(),
  notes: z.array(NonEmptyTextSchema),
}).strict();
