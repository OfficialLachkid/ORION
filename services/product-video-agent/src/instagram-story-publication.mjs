import { createStableId } from './ids.mjs';

export const INSTAGRAM_STORY_PLATFORM = 'instagram_story';
export const INSTAGRAM_STORY_RECIPE_VERSION = 'instagram-story-promotion.v1';
export const INSTAGRAM_STORY_DEFAULT_TEMPLATE = 'video_promotion';
export const INSTAGRAM_STORY_POLICY_DISABLED = 'disabled';
export const INSTAGRAM_STORY_POLICY_REQUIRES_APPROVAL = 'requires_approval';
export const INSTAGRAM_STORY_POLICY_AUTO_PUBLISH = 'auto_publish';

const SUPPORTED_POLICIES = new Set([
  INSTAGRAM_STORY_POLICY_DISABLED,
  INSTAGRAM_STORY_POLICY_REQUIRES_APPROVAL,
  INSTAGRAM_STORY_POLICY_AUTO_PUBLISH,
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePolicy(value) {
  return normalizeText(value).toLowerCase().replace(/[-\s]+/gu, '_');
}

function normalizeDelaySeconds(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Math.floor(parsed), 24 * 60 * 60));
}

function storyConfiguration(target = {}) {
  const instagram = target.instagram && typeof target.instagram === 'object'
    ? target.instagram
    : {};
  return instagram.story && typeof instagram.story === 'object'
    ? instagram.story
    : {};
}

export function resolveInstagramStoryPolicy(target = {}) {
  const configured = storyConfiguration(target);
  const explicitPolicy = normalizePolicy(
    configured.policy || configured.publish_policy || configured.publishPolicy,
  );
  const policy = configured.enabled === false
    ? INSTAGRAM_STORY_POLICY_DISABLED
    : explicitPolicy || INSTAGRAM_STORY_POLICY_DISABLED;
  if (!SUPPORTED_POLICIES.has(policy)) {
    throw new Error(`Unsupported Instagram Story publication policy: ${policy}.`);
  }
  return {
    policy,
    enabled: policy !== INSTAGRAM_STORY_POLICY_DISABLED,
    requiresApproval: policy === INSTAGRAM_STORY_POLICY_REQUIRES_APPROVAL,
    autoPublish: policy === INSTAGRAM_STORY_POLICY_AUTO_PUBLISH,
    templateKey: normalizeText(
      configured.template_key || configured.templateKey || INSTAGRAM_STORY_DEFAULT_TEMPLATE,
    ),
    recipeVersion: normalizeText(
      configured.recipe_version || configured.recipeVersion || INSTAGRAM_STORY_RECIPE_VERSION,
    ),
    delaySeconds: normalizeDelaySeconds(
      configured.delay_seconds ?? configured.delaySeconds,
    ),
  };
}

export function buildInstagramStoryPublicationId({ sourcePublication, target, recipeVersion }) {
  return createStableId('publication-target', {
    sourcePublicationId: sourcePublication?.id || '',
    videoId: sourcePublication?.video_id || '',
    platform: INSTAGRAM_STORY_PLATFORM,
    accountKey: target?.accountKey || target?.account_key || sourcePublication?.account_key || '',
    recipeVersion: recipeVersion || INSTAGRAM_STORY_RECIPE_VERSION,
  });
}

export function buildInstagramStoryPublicationRow({
  sourcePublication,
  target = {},
  asOf = new Date().toISOString(),
}) {
  if (!sourcePublication?.id || !sourcePublication?.video_id) {
    throw new Error('Instagram Story planning requires a source Instagram publication and video id.');
  }
  const policy = resolveInstagramStoryPolicy(target);
  if (!policy.enabled) return null;
  const accountKey = normalizeText(
    target.accountKey || target.account_key || sourcePublication.account_key,
  );
  if (!accountKey) {
    throw new Error('Instagram Story planning requires an Instagram account key.');
  }
  const publisherTarget = sourcePublication.metadata?.publisher_target || target;
  return {
    id: buildInstagramStoryPublicationId({
      sourcePublication,
      target: { ...target, accountKey },
      recipeVersion: policy.recipeVersion,
    }),
    video_id: sourcePublication.video_id,
    platform: INSTAGRAM_STORY_PLATFORM,
    account_key: accountKey,
    status: 'queued',
    visibility: 'public',
    title: sourcePublication.title || '',
    description: sourcePublication.description || '',
    hashtags: Array.isArray(sourcePublication.hashtags) ? [...sourcePublication.hashtags] : [],
    disclosure: sourcePublication.disclosure || '',
    preview_url: null,
    public_url: null,
    external_id: null,
    scheduled_for: null,
    uploaded_at: null,
    published_at: null,
    metadata: {
      workflow_state: 'waiting_source_publication',
      platform_publication_kind: 'dependent_instagram_story',
      source_publication_id: sourcePublication.id,
      source_instagram_publication_id: sourcePublication.id,
      source_instagram_media_id: normalizeText(sourcePublication.metadata?.instagram_media_id),
      source_video_id: sourcePublication.video_id,
      source_account_key: sourcePublication.account_key || accountKey,
      source_render_path: normalizeText(sourcePublication.metadata?.render_path),
      publisher_target: publisherTarget,
      instagram_story: {
        policy: policy.policy,
        template_key: policy.templateKey,
        recipe_version: policy.recipeVersion,
        delay_seconds: policy.delaySeconds,
        approval_required: policy.requiresApproval,
        authorization: policy.autoPublish ? 'account_policy' : 'story_asset_approval',
      },
      created_from_source_at: asOf,
    },
  };
}

export async function upsertInstagramStoryPublicationTarget({
  store,
  sourcePublication,
  target = {},
  asOf = new Date().toISOString(),
}) {
  const candidate = buildInstagramStoryPublicationRow({ sourcePublication, target, asOf });
  if (!candidate) return null;
  if (!store?.upsertPublication) {
    throw new Error('Instagram Story planning requires publication upsert support.');
  }
  const existing = typeof store.fetchPublicationById === 'function'
    ? await store.fetchPublicationById(candidate.id)
    : null;
  if (existing) {
    return {
      publicationId: existing.id,
      workflowState: existing.metadata?.workflow_state || existing.status || '',
      policy: existing.metadata?.instagram_story?.policy || '',
      preserved: true,
    };
  }
  const stored = await store.upsertPublication(candidate);
  return {
    publicationId: stored?.id || candidate.id,
    workflowState: stored?.metadata?.workflow_state || candidate.metadata.workflow_state,
    policy: candidate.metadata.instagram_story.policy,
    preserved: false,
  };
}
