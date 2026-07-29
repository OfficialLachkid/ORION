import { createStableId } from './ids.mjs';
import { loadVoiceLicenseRecords, selectVoiceProfile } from './config.mjs';
import { evaluateAssetGates, evaluateInternalEditorTestAssetGates } from './compliance.mjs';
import { scoreProduct } from './scoring.mjs';
import {
  OutputManifestSchema,
  PublicationApprovalSchema,
  PublicationSchema,
  ScriptJobSchema,
} from './schemas.mjs';
import { assertProviderAdapter } from './adapters/provider-adapter.mjs';
import { createLocalTtsAdapter } from './adapters/tts-adapter.mjs';
import { LocalFfmpegRenderPlanner } from './adapters/render-adapter.mjs';
import { RightsGatedAssetAcquisitionPlanner } from './adapters/asset-acquisition-adapter.mjs';
import { LocalFasterWhisperCaptionPlanner } from './adapters/caption-adapter.mjs';
import { buildWorkflowApprovals } from './workflow-approvals.mjs';

function buildKeyFacts(product, claimGuardrails = {}) {
  if (Array.isArray(claimGuardrails.script_facts) && claimGuardrails.script_facts.length > 0) {
    return claimGuardrails.script_facts;
  }
  const specificationFacts = Object.entries(product.specifications)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 10)
    .map(([key, value]) => `${key}: ${value}`);

  return [
    `Product description: ${product.description}`,
    ...specificationFacts,
  ];
}

function buildScriptJobs(product, config, runAt, claimGuardrails = {}) {
  return config.script.variants.map((variant) => ScriptJobSchema.parse({
    script_job_id: createStableId('script-job', {
      productId: product.product_id,
      angle: variant.angle,
      duration: variant.target_duration_seconds,
      promptVersion: config.script.prompt_version,
    }),
    product_id: product.product_id,
    angle: variant.angle,
    target_duration_seconds: variant.target_duration_seconds,
    prompt_version: config.script.prompt_version,
    creative_brief: {
      hook_goal: `Lead with a concrete ${variant.angle.replaceAll('_', ' ')} payoff in the first two seconds.`,
      key_facts: buildKeyFacts(product, claimGuardrails),
      prohibited_claims: [
        'Do not invent specifications, reviews, discounts, health claims, or performance claims.',
        'Do not imply personal use or testing unless evidence is provided.',
        'Do not copy reference-channel wording, branding, or media.',
        ...(Array.isArray(claimGuardrails.prohibited_claims)
          ? claimGuardrails.prohibited_claims
          : []),
      ],
      blocked_phrases: Array.isArray(claimGuardrails.blocked_phrases)
        ? claimGuardrails.blocked_phrases
        : [],
      editorial_direction: Array.isArray(claimGuardrails.editorial_direction)
        ? claimGuardrails.editorial_direction
        : [],
      disclosure: config.affiliate_disclosure,
    },
    model_plan: {
      provider: config.script.provider,
      model: config.script.model,
      endpoint: config.script.endpoint,
      execute: false,
    },
    status: 'planned',
    estimated_cost: 0,
    created_at: runAt,
  }));
}

function buildPublication(product, scriptJob, affiliateLink, renderJob, platform, config, runAt) {
  const publicationId = createStableId('publication', {
    scriptJobId: scriptJob.script_job_id,
    platform,
  });
  const approval = PublicationApprovalSchema.parse({
    approval_id: createStableId('approval', { publicationId, action: 'publish' }),
    product_id: product.product_id,
    publication_id: publicationId,
    action: 'publish',
    state: 'pending',
    requested_at: runAt,
    decided_at: null,
    requested_by: config.operator,
    decided_by: null,
    reason: 'Publishing is an external action and always requires explicit operator approval.',
  });
  const publication = PublicationSchema.parse({
    publication_id: publicationId,
    product_id: product.product_id,
    script_job_id: scriptJob.script_job_id,
    platform,
    status: renderJob.status === 'complete' && renderJob.publication_eligible
      ? 'awaiting_approval'
      : 'blocked',
    approval_id: approval.approval_id,
    title: `${product.canonical_name}: ${scriptJob.angle.replaceAll('_', ' ')}`,
    description: `${product.description}\n\n${config.affiliate_disclosure}`,
    hashtags: ['#gadgets', '#productfinds', '#affiliate'],
    thumbnail_asset_id: null,
    affiliate_link_id: affiliateLink.affiliate_link_id,
    affiliate_disclosure: config.affiliate_disclosure,
    scheduled_at: null,
    published_at: null,
    external_post_id: null,
  });

  return { approval, publication };
}

export async function runProductVideoDryRun(options) {
  const adapter = assertProviderAdapter(options.adapter);
  const { config, inputFile, projectRoot = process.cwd() } = options;
  const raw = await adapter.importProduct({ inputFile });
  const normalized = adapter.normalize(raw, { config, runAt: config.run_at });
  const productScore = scoreProduct(
    normalized.product,
    normalized.scoreSignals,
    normalized.economics,
    config.run_at,
  );
  const voiceLicenses = await loadVoiceLicenseRecords(config, projectRoot);
  const voiceLicenseById = new Map(voiceLicenses.map((record) => [record.voice_id, record]));
  const defaultVoiceProfile = selectVoiceProfile(config);
  const assetGates = config.render.purpose === 'internal_editor_test'
    ? await evaluateInternalEditorTestAssetGates(normalized.assets, projectRoot)
    : await evaluateAssetGates(normalized.assets, projectRoot);
  const acquisitionPlanner = new RightsGatedAssetAcquisitionPlanner();
  const assetAcquisitionPlans = normalized.assets.map((asset) => (
    acquisitionPlanner.createPlan(asset, config.run_at)
  ));
  const scriptJobs = buildScriptJobs(
    normalized.product,
    config,
    config.run_at,
    normalized.claimGuardrails,
  );
  const captionAdapter = new LocalFasterWhisperCaptionPlanner(config.captions);
  const renderAdapter = new LocalFfmpegRenderPlanner({
    ...config.render,
    platform_targets: config.content_strategy.platforms,
  });
  const voiceOverJobs = scriptJobs.map((scriptJob, index) => {
    const profile = selectVoiceProfile(config, index);
    const ttsAdapter = createLocalTtsAdapter(config.voice, profile);
    return ttsAdapter.createJob({
      product: normalized.product,
      scriptJob,
      voiceLicense: voiceLicenseById.get(profile.model),
      runAt: config.run_at,
    });
  });
  const captionJobs = scriptJobs.map((scriptJob, index) => captionAdapter.createJob({
    product: normalized.product,
    scriptJob,
    voiceJob: voiceOverJobs[index],
    runAt: config.run_at,
  }));
  const renderJobs = scriptJobs.map((scriptJob, index) => renderAdapter.createJob({
    product: normalized.product,
    scriptJob,
    voiceJob: voiceOverJobs[index],
    captionJob: captionJobs[index],
    assetGates,
    runAt: config.run_at,
  }));
  const workflowApprovals = buildWorkflowApprovals({
    product: normalized.product,
    scriptJobs,
    assets: normalized.assets,
    renderJobs,
    config,
    runAt: config.run_at,
  });
  const publicationPlans = scriptJobs.flatMap((scriptJob, index) => (
    config.content_strategy.platforms.map((platform) => buildPublication(
      normalized.product,
      scriptJob,
      normalized.affiliateLink,
      renderJobs[index],
      platform,
      config,
      config.run_at,
    ))
  ));
  const runId = createStableId('product-video-run', {
    adapter: adapter.name,
    productId: normalized.product.product_id,
    runAt: config.run_at,
    schemaVersion: config.schema_version,
    contentStrategy: config.content_strategy,
  });

  const manifest = OutputManifestSchema.parse({
    schema_version: config.schema_version,
    run_id: runId,
    run_at: config.run_at,
    mode: 'dry_run',
    adapter: adapter.name,
    content_strategy: config.content_strategy,
    products: [normalized.product],
    source_snapshots: [normalized.snapshot],
    product_scores: [productScore],
    media_candidates: normalized.mediaCandidates || [],
    assets: normalized.assets,
    asset_acquisition_plans: assetAcquisitionPlans,
    script_jobs: scriptJobs,
    script_variants: [],
    script_revisions: [],
    voice_license: voiceLicenseById.get(defaultVoiceProfile.model),
    voice_licenses: voiceLicenses,
    voice_over_jobs: voiceOverJobs,
    caption_jobs: captionJobs,
    render_jobs: renderJobs,
    workflow_approvals: workflowApprovals,
    affiliate_links: [normalized.affiliateLink],
    publication_approvals: publicationPlans.map(({ approval }) => approval),
    publications: publicationPlans.map(({ publication }) => publication),
    analytics_snapshots: [],
    gates: {
      eligible_asset_ids: assetGates.eligible.map((asset) => asset.asset_id),
      blocked_asset_ids: assetGates.blocked.map(({ asset }) => asset.asset_id),
      render_ready: renderJobs.every((job) => job.status === 'complete'),
      publish_ready: false,
      approval_required: true,
    },
    external_calls: {
      marketplace: 'stubbed',
      asset_download: 'stubbed',
      model: 'stubbed',
      local_tts: 'stubbed',
      local_caption: 'stubbed',
      local_render: 'stubbed',
      paid_tts: 'stubbed',
      publishing: 'stubbed',
    },
    cost: {
      currency: normalized.product.current_price?.currency || normalized.economics.currency || 'EUR',
      incurred: 0,
      estimated: 0,
    },
    notes: [
      'Marketplace media is reference-only until reuse rights are verified and approved.',
      'Amazon-hosted product videos are not downloaded or rendered by this dry run.',
      'Short-form vertical content is the active target; 2-5 minute long-form is deferred.',
      'Local Ollama, TTS, and FFmpeg work is planned but intentionally not executed.',
    ],
  });

  if (!options.store) {
    return { manifest, persistence: null };
  }

  const persistence = await options.store.saveRun(manifest);
  return { manifest, persistence };
}
