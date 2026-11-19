import { createStableId } from './ids.mjs';
import {
  INSTAGRAM_STORY_LEGACY_RECIPE_VERSION,
  INSTAGRAM_STORY_VARIANT_CURRENT,
  INSTAGRAM_STORY_VARIANT_SET_VERSION,
  resolveInstagramStoryVariantAssignment,
  resolveInstagramStoryVariantKeys,
} from './instagram-story-recipes.mjs';

export const INSTAGRAM_STORY_PLATFORM = 'instagram_story';
export const INSTAGRAM_STORY_RECIPE_VERSION = 'instagram-story-promotion.v2';
export const INSTAGRAM_STORY_DEFAULT_TEMPLATE = 'variant_rotation';
export const INSTAGRAM_STORY_POLICY_DISABLED = 'disabled';
export const INSTAGRAM_STORY_POLICY_AUTO_PUBLISH = 'auto_publish';

const SUPPORTED_POLICIES = new Set([
  INSTAGRAM_STORY_POLICY_DISABLED,
  INSTAGRAM_STORY_POLICY_AUTO_PUBLISH,
]);
const accountRotationQueues = new Map();

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
  if (explicitPolicy && !SUPPORTED_POLICIES.has(explicitPolicy)) {
    throw new Error(`Unsupported Instagram Story publication policy: ${explicitPolicy}.`);
  }
  const policy = configured.enabled === false
    ? INSTAGRAM_STORY_POLICY_DISABLED
    : configured.enabled === true
      ? INSTAGRAM_STORY_POLICY_AUTO_PUBLISH
      : explicitPolicy || INSTAGRAM_STORY_POLICY_DISABLED;
  if (!SUPPORTED_POLICIES.has(policy)) {
    throw new Error(`Unsupported Instagram Story publication policy: ${policy}.`);
  }
  return {
    policy,
    enabled: policy !== INSTAGRAM_STORY_POLICY_DISABLED,
    autoPublish: policy === INSTAGRAM_STORY_POLICY_AUTO_PUBLISH,
    templateKey: normalizeText(
      configured.template_key || configured.templateKey || INSTAGRAM_STORY_DEFAULT_TEMPLATE,
    ),
    recipeVersion: normalizeText(
      configured.recipe_version || configured.recipeVersion || INSTAGRAM_STORY_RECIPE_VERSION,
    ),
    variantKeys: resolveInstagramStoryVariantKeys(target),
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
  rotationState = {},
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
  const storedTarget = sourcePublication.metadata?.publisher_target || {};
  const publisherTarget = {
    ...storedTarget,
    ...target,
    account_key: accountKey,
    instagram: {
      ...(storedTarget.instagram || {}),
      ...(target.instagram || {}),
    },
  };
  const variantAssignment = resolveInstagramStoryVariantAssignment({
    publication: {
      account_key: accountKey,
      scheduled_for: sourcePublication.scheduled_for,
    },
    sourcePublication,
    target: publisherTarget,
    rotationState,
  });
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
        variant_key: variantAssignment.variantKey,
        variant_set_version: INSTAGRAM_STORY_VARIANT_SET_VERSION,
        enabled_variant_keys: policy.variantKeys,
        variant_pool_signature: variantAssignment.poolSignature,
        rotation_cycle: variantAssignment.cycle,
        rotation_position: variantAssignment.position,
        rotation_order: variantAssignment.order,
        delay_seconds: policy.delaySeconds,
        authorization: 'account_policy',
      },
      created_from_source_at: asOf,
    },
  };
}

async function fetchLatestInstagramStoryRotationState({ store, accountKey }) {
  if (typeof store?.fetchPublicationsByChannel !== 'function') return {};
  const [latest] = await store.fetchPublicationsByChannel({
    platform: INSTAGRAM_STORY_PLATFORM,
    accountKey,
    order: 'created_at.desc',
    limit: 1,
    select: 'id,story_rotation:metadata->instagram_story',
    queryClass: 'instagram_story_latest_rotation_state',
  });
  const story = latest?.story_rotation || latest?.metadata?.instagram_story || {};
  return {
    previousVariantKey: story.variant_key
      || (story.recipe_version === INSTAGRAM_STORY_LEGACY_RECIPE_VERSION
        ? INSTAGRAM_STORY_VARIANT_CURRENT
        : ''),
    poolSignature: story.variant_pool_signature,
    cycle: story.rotation_cycle,
    position: story.rotation_position,
    order: story.rotation_order,
  };
}

async function serializeInstagramStoryRotation(accountKey, task) {
  const previous = accountRotationQueues.get(accountKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  accountRotationQueues.set(accountKey, current);
  try {
    return await current;
  } finally {
    if (accountRotationQueues.get(accountKey) === current) {
      accountRotationQueues.delete(accountKey);
    }
  }
}

export async function upsertInstagramStoryPublicationTarget({
  store,
  sourcePublication,
  target = {},
  asOf = new Date().toISOString(),
}) {
  if (!store?.upsertPublication) {
    throw new Error('Instagram Story planning requires publication upsert support.');
  }
  const policy = resolveInstagramStoryPolicy(target);
  if (!policy.enabled) return null;
  if (!sourcePublication?.id || !sourcePublication?.video_id) {
    throw new Error('Instagram Story planning requires a source Instagram publication and video id.');
  }
  const accountKey = normalizeText(
    target.accountKey || target.account_key || sourcePublication.account_key,
  );
  if (!accountKey) {
    throw new Error('Instagram Story planning requires an Instagram account key.');
  }
  const publicationId = buildInstagramStoryPublicationId({
    sourcePublication,
    target: { ...target, accountKey },
    recipeVersion: policy.recipeVersion,
  });

  return serializeInstagramStoryRotation(accountKey, async () => {
    const existing = typeof store.fetchPublicationById === 'function'
      ? await store.fetchPublicationById(publicationId)
      : null;
    if (existing) {
      return {
        publicationId: existing.id,
        workflowState: existing.metadata?.workflow_state || existing.status || '',
        policy: existing.metadata?.instagram_story?.policy || '',
        preserved: true,
      };
    }
    const rotationState = await fetchLatestInstagramStoryRotationState({ store, accountKey });
    const candidate = buildInstagramStoryPublicationRow({
      sourcePublication,
      target,
      rotationState,
      asOf,
    });
    const stored = await store.upsertPublication(candidate);
    return {
      publicationId: stored?.id || candidate.id,
      workflowState: stored?.metadata?.workflow_state || candidate.metadata.workflow_state,
      policy: candidate.metadata.instagram_story.policy,
      preserved: false,
    };
  });
}
