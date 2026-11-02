import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { createStableId } from './ids.mjs';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function resolveNarrationLine(lines = [], role) {
  return lines.find((line) => line.role === role)?.text || '';
}

function buildDefaultRenderPathFromPlan(plan) {
  const typePairSlug = (plan?.selection?.type_pair || []).map((value) => slugify(value)).filter(Boolean).join('-');
  const seedSlug = slugify(plan?.seed || 'preview');
  return `${plan?.assets?.outputs?.previews_directory || ''}/${typePairSlug}-${seedSlug}.mp4`;
}

function buildVideoId(plan, renderPath) {
  return createStableId('poke-quizz-video', {
    seed: plan?.seed,
    typePair: plan?.selection?.type_pair || [],
    renderPath,
  });
}

// Short, stable slug for an asset path — the basename without its
// extension. Keeps analytics bucket labels readable
// ("neon-plasma-armory" instead of a 70-byte full path) AND keeps
// the publication-metadata JSONB small, which matters for the
// Supabase egress rules (see Jacobs-2/07_Products/Product_Video_Agent/
// Runtime_Ops.md § Supabase egress optimization — 2026-11-02).
export function assetSlugFromPath(fullPath) {
  const name = basename(String(fullPath || '').trim());
  if (!name) return null;
  const stem = name.replace(/\.[^.]+$/u, '');
  return stem || null;
}

// Compact analytics-oriented signals extracted from the render plan.
// Attached to `publicationRow.metadata.video_signals` so the weekly
// analytics review can bucket by variant (difficulty / background /
// music / length) alongside the existing per-template bucketing.
//
// Rules the shape follows:
//   - Only non-null, non-empty values are emitted (null-safe).
//   - Each sub-object is omitted entirely when all its fields are
//     empty, so a template that has no variant data (yet) adds
//     ZERO bytes to the metadata column.
//   - Target size per publication: ~200-300 bytes for a filled-in
//     template, 0 bytes for an un-onboarded one.
export function buildVideoSignals(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const out = {};

  const difficulty = String(plan?.selection?.difficulty_id || '').trim();
  const roundCount = Number(plan?.selection?.round_count);
  if (difficulty || Number.isFinite(roundCount)) {
    out.variant = {};
    if (difficulty) out.variant.difficulty = difficulty;
    if (Number.isFinite(roundCount)) out.variant.round_count = roundCount;
  }

  const backgroundSlug = assetSlugFromPath(plan?.assets?.background?.selected_path);
  const musicSlug = assetSlugFromPath(plan?.assets?.audio?.selected_battle_intro_music_path);
  if (backgroundSlug || musicSlug) {
    out.selection = {};
    if (backgroundSlug) out.selection.background_slug = backgroundSlug;
    if (musicSlug) out.selection.music_slug = musicSlug;
  }

  const durationSeconds = Number(plan?.timing?.total_duration_seconds);
  const subjectPool = String(plan?.selection?.pool_key || '').trim();
  if (Number.isFinite(durationSeconds) || subjectPool) {
    out.shape = {};
    if (Number.isFinite(durationSeconds)) out.shape.duration_seconds = Math.round(durationSeconds * 10) / 10;
    if (subjectPool) out.shape.subject_pool = subjectPool;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function buildPublicationId(videoId, channelProfile) {
  return createStableId('publication', {
    videoId,
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });
}

export async function resolvePokeQuizzRenderFileDetails(renderPath, override = null) {
  if (override) {
    return {
      sizeBytes: Number(override.sizeBytes || 0),
      modifiedAt: String(override.modifiedAt || ''),
    };
  }
  const fileStats = await stat(renderPath);
  return {
    sizeBytes: fileStats.size,
    modifiedAt: fileStats.mtime.toISOString(),
  };
}

function resolveContentFormat(plan = {}) {
  return String(plan?.content_format || '').trim() === 'long_form' ? 'long_form' : 'short_form';
}

function resolveContentSurface(plan = {}) {
  return String(plan?.content_surface || '').trim() === 'youtube_watch'
    ? 'youtube_watch'
    : 'youtube_shorts';
}

function buildWorkflowDocument(plan, registrationTime, renderPath, metadata) {
  const contentFormat = resolveContentFormat(plan);
  const contentSurface = resolveContentSurface(plan);
  return {
    schema_version: plan?.schema_version || 'poke-quizz-plan-v1',
    run_at: registrationTime,
    mode: 'local_render',
    adapter: 'poke-quizz-local-publication',
    content_strategy: {
      primary: contentFormat,
      platforms: [contentSurface],
    },
    gates: {
      render_ready: true,
      publish_ready: false,
      approval_required: true,
    },
    external_calls: {
      model: metadata.generation_provider === 'ollama' ? 'local_executed' : 'stubbed',
      publishing: 'local_planned',
    },
    notes: [
      'Registered directly from a rendered Poke Quizz MP4 for publication queue automation.',
      `Render file: ${renderPath}`,
    ],
  };
}

export async function createPokeQuizzPublicationRegistration({
  plan,
  channelProfile,
  renderPath,
  metadata,
  registeredAt = new Date().toISOString(),
  renderFileDetails = null,
  publicationStatus = 'approved',
}) {
  const resolvedRenderPath = String(renderPath || buildDefaultRenderPathFromPlan(plan)).trim();
  if (!resolvedRenderPath) {
    throw new Error('Could not resolve a render path for the Poke Quizz publication registration.');
  }

  const fileDetails = await resolvePokeQuizzRenderFileDetails(resolvedRenderPath, renderFileDetails);
  const videoId = buildVideoId(plan, resolvedRenderPath);
  const publicationId = buildPublicationId(videoId, channelProfile);
  const selectedSubjects = plan?.selection?.selected_subjects || [];
  const typePair = plan?.selection?.type_pair || [];
  const contentFormat = resolveContentFormat(plan);
  const contentSurface = resolveContentSurface(plan);

  const videoRow = {
    id: videoId,
    channel_id: channelProfile.id,
    title: metadata.title,
    niche: channelProfile.niche,
    content_lane: channelProfile.content_lane,
    template_key: plan?.template_id || 'pokemon-type-challenge-v1',
    status: 'completed',
    subjects: selectedSubjects,
    source_data: {
      schema_version: plan?.schema_version || 'poke-quizz-plan-v1',
      seed: plan?.seed || '',
      content_format: contentFormat,
      content_surface: contentSurface,
      type_pair: typePair,
      background_path: plan?.assets?.background?.selected_path || null,
      reveal_methods: Array.isArray(plan?.selection?.reveal_methods)
        ? plan.selection.reveal_methods
        : [],
    },
    score: {
      catalog_match_count: Number(plan?.selection?.catalog_match_count || 0),
      compatible_display_count: Number(plan?.selection?.compatible_display_count || 0),
      selected_subject_count: Number(selectedSubjects.length || 0),
    },
    scripts: {
      jobs: [],
      variants: [],
      revisions: [],
    },
    selected_script: {
      hook: resolveNarrationLine(plan?.narration?.lines || [], 'hook'),
      prompt: resolveNarrationLine(plan?.narration?.lines || [], 'prompt'),
      reveal: resolveNarrationLine(plan?.narration?.lines || [], 'reveal'),
    },
    voice: {},
    captions: {},
    render: {
      output_path: resolvedRenderPath,
      output_file_name: basename(resolvedRenderPath),
      file_size_bytes: fileDetails.sizeBytes,
      modified_at: fileDetails.modifiedAt,
      template_id: plan?.template_id || '',
      content_format: contentFormat,
      content_surface: contentSurface,
      media_profile: plan?.media_profile || null,
      duration_seconds: Number(plan?.timing?.total_duration_seconds || 0) || null,
      seed: plan?.seed || '',
      type_pair: typePair,
      reveal_methods: Array.isArray(plan?.selection?.reveal_methods)
        ? plan.selection.reveal_methods
        : [],
      selected_subjects: selectedSubjects,
    },
    approvals: {
      workflow: [],
      publication: [],
    },
    affiliate_links: [],
    workflow: buildWorkflowDocument(plan, registeredAt, resolvedRenderPath, metadata),
    archive: {
      render_results: [
        {
          source_path: resolvedRenderPath,
          registered_at: registeredAt,
        },
      ],
      asset_storage_locations: [],
    },
    cost: {
      currency: 'USD',
      estimated: 0,
      incurred: 0,
    },
    last_error: null,
    completed_at: fileDetails.modifiedAt || registeredAt,
  };

  const videoSignals = buildVideoSignals(plan);
  const publicationRow = {
    id: publicationId,
    video_id: videoId,
    platform: channelProfile.platform,
    account_key: channelProfile.account_key,
    status: publicationStatus,
    visibility: channelProfile.workflow.preview_visibility,
    title: metadata.title,
    description: metadata.description,
    hashtags: metadata.hashtags,
    disclosure: '',
    preview_url: null,
    public_url: null,
    external_id: null,
    scheduled_for: null,
    uploaded_at: null,
    published_at: null,
    metadata: {
      workflow_state: 'preview_upload_pending',
      content_format: contentFormat,
      content_surface: contentSurface,
      publication_policy: plan?.publication_policy || {},
      type_pair: typePair,
      background_path: plan?.assets?.background?.selected_path || null,
      seed: plan?.seed || '',
      render_path: resolvedRenderPath,
      template_id: plan?.template_id || '',
      selected_subjects: selectedSubjects,
      selected_subject_count: selectedSubjects.length,
      title_generation_model: metadata.model || channelProfile.metadata?.title_generation_model || 'fallback',
      description_generation_model: metadata.model || channelProfile.metadata?.description_generation_model || 'fallback',
      generation_provider: metadata.generation_provider || 'template',
      registration_source: 'poke-quizz-local-render',
      // Analytics variant signals (2026-11-02 pilot — stat-clash first;
      // see Jacobs-2/07_Products/Product_Video_Agent/Analytics.md).
      // Omitted entirely when the plan has no video_signals data
      // (un-onboarded template) so metadata size stays flat for those
      // rows — matters for the Supabase egress rules in
      // Jacobs-2/07_Products/Product_Video_Agent/Runtime_Ops.md §
      // Supabase egress optimization.
      ...(videoSignals ? { video_signals: videoSignals } : {}),
    },
  };

  return {
    videoRow,
    publicationRow,
  };
}

export function mergeRegisteredPublicationRow(existingRow, candidateRow) {
  if (!existingRow) {
    return candidateRow;
  }

  const existingWorkflowState = existingRow.metadata?.workflow_state || null;
  const preservedWorkflowState = existingWorkflowState && existingWorkflowState !== 'preview_upload_pending'
    ? existingWorkflowState
    : candidateRow.metadata.workflow_state;

  return {
    ...existingRow,
    ...candidateRow,
    status: existingRow.status || candidateRow.status,
    visibility: existingRow.visibility || candidateRow.visibility,
    preview_url: existingRow.preview_url || candidateRow.preview_url,
    public_url: existingRow.public_url || candidateRow.public_url,
    external_id: existingRow.external_id || candidateRow.external_id,
    scheduled_for: existingRow.scheduled_for || candidateRow.scheduled_for,
    uploaded_at: existingRow.uploaded_at || candidateRow.uploaded_at,
    published_at: existingRow.published_at || candidateRow.published_at,
    metadata: {
      ...(existingRow.metadata || {}),
      ...(candidateRow.metadata || {}),
      workflow_state: preservedWorkflowState,
    },
  };
}
