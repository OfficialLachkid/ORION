import { stat } from 'node:fs/promises';
import {
  InstagramGraphApiError,
  InstagramPublicationUncertainError,
  createInstagramGraphClient,
  createInstagramStagingClient,
} from './instagram-publication-executor.mjs';
import { InstagramPublicationValidationError } from './instagram-publication.mjs';
import {
  INSTAGRAM_STORY_POLICY_AUTO_PUBLISH,
  resolveInstagramStoryPolicy,
} from './instagram-story-publication.mjs';
import { renderInstagramStoryVideo } from './instagram-story-renderer.mjs';
import { hashFileSha256 } from './tiktok-publication-executor.mjs';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeWorkflowState(publication = {}) {
  return normalizeText(publication.metadata?.workflow_state || publication.status).toLowerCase();
}

function resolveStoredTarget(publication = {}, target = {}) {
  const stored = publication.metadata?.publisher_target || {};
  return Object.keys(target).length > 0 ? target : stored;
}

function requirePublishedSource(publication = {}, sourcePublication = {}) {
  const expectedId = normalizeText(publication.metadata?.source_instagram_publication_id);
  if (!expectedId || sourcePublication.id !== expectedId) {
    throw new InstagramPublicationValidationError(
      'Instagram Story source publication identity does not match its durable plan.',
      { code: 'instagram_story_source_mismatch' },
    );
  }
  if (
    sourcePublication.platform !== 'instagram_reels'
    || normalizeWorkflowState(sourcePublication) !== 'published'
    || !normalizeText(sourcePublication.metadata?.instagram_media_id || sourcePublication.external_id)
  ) {
    throw new InstagramPublicationValidationError(
      'Instagram Story delivery requires a verified published source Reel receipt.',
      { code: 'instagram_story_source_not_published' },
    );
  }
}

export async function prepareInstagramStoryPublication({
  publication,
  sourcePublication,
  target = {},
  runtimeEnv = {},
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
  renderStory = renderInstagramStoryVideo,
}) {
  const resolvedTarget = resolveStoredTarget(publication, target);
  const policy = resolveInstagramStoryPolicy(resolvedTarget);
  if (!policy.enabled || policy.policy !== INSTAGRAM_STORY_POLICY_AUTO_PUBLISH) {
    throw new InstagramPublicationValidationError(
      'Instagram Story automatic delivery is not enabled for this account.',
      { code: 'instagram_story_delivery_disabled' },
    );
  }
  requirePublishedSource(publication, sourcePublication);
  const instagramUserId = normalizeText(
    resolvedTarget.instagram?.user_id || resolvedTarget.instagram?.userId,
  );
  const accessTokenEnv = normalizeText(
    resolvedTarget.instagram?.access_token_env || resolvedTarget.instagram?.accessTokenEnv,
  );
  if (!instagramUserId || !accessTokenEnv || !normalizeText(runtimeEnv[accessTokenEnv])) {
    throw new InstagramPublicationValidationError(
      `Instagram Story credentials are missing for ${publication.account_key || 'the configured account'}.`,
      { code: 'instagram_auth_required' },
    );
  }
  if (!normalizeText(runtimeEnv.INSTAGRAM_GRAPH_API_VERSION)) {
    throw new InstagramPublicationValidationError(
      'INSTAGRAM_GRAPH_API_VERSION must be set explicitly before Story delivery.',
      { code: 'instagram_api_version_required' },
    );
  }
  const persistedAssetPath = normalizeText(publication.metadata?.story_asset_path);
  const persistedAssetSha256 = normalizeText(publication.metadata?.story_asset_sha256);
  const approvedSourceSha256 = normalizeText(
    sourcePublication.metadata?.instagram_reel_approval?.video_sha256,
  );
  const persistedSourceSha256 = normalizeText(
    publication.metadata?.story_asset_source_sha256,
  );
  let asset = null;
  if (
    persistedAssetPath
    && persistedAssetSha256
    && approvedSourceSha256
    && persistedSourceSha256 === approvedSourceSha256
  ) {
    try {
      const fileStats = await statImpl(persistedAssetPath);
      const actualAssetSha256 = Number(fileStats?.size || 0) > 0
        ? await hashFileImpl(persistedAssetPath)
        : '';
      if (actualAssetSha256 === persistedAssetSha256) {
        asset = {
          outputPath: persistedAssetPath,
          videoSha256: actualAssetSha256,
          sourceVideoSha256: persistedSourceSha256,
          durationSeconds: Number(publication.metadata?.story_asset_duration_seconds || 0),
          reused: true,
        };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (!asset) {
    asset = await renderStory({
      publication,
      sourcePublication,
      target: resolvedTarget,
      runtimeEnv,
      projectRoot,
      statImpl,
      hashFileImpl,
    });
  }
  return { asset, instagramUserId, policy, target: resolvedTarget };
}

export async function publishInstagramStory({
  publication,
  sourcePublication,
  target = {},
  runtimeEnv = {},
  projectRoot = process.cwd(),
  asOf = new Date().toISOString(),
  statImpl = stat,
  renderStory = renderInstagramStoryVideo,
  stagingClient = null,
  graphClient = null,
  onRendered = null,
  onStaged = null,
  onInitialized = null,
  onPublished = null,
}) {
  const prepared = await prepareInstagramStoryPublication({
    publication,
    sourcePublication,
    target,
    runtimeEnv,
    projectRoot,
    statImpl,
    renderStory,
  });
  if (typeof onRendered === 'function') {
    await onRendered({ ...prepared.asset, renderedAt: asOf });
  }
  const client = graphClient || createInstagramGraphClient(runtimeEnv, prepared.target);
  const staging = stagingClient || createInstagramStagingClient(runtimeEnv);
  const existingMediaId = normalizeText(publication.metadata?.instagram_story_media_id);
  if (existingMediaId) {
    const media = await client.fetchMedia(existingMediaId);
    const existingObjectPath = normalizeText(
      publication.metadata?.instagram_story_staging_object_path,
    );
    let stagingRemoved = Boolean(
      publication.metadata?.instagram_story_staging_removed_at,
    );
    if (existingObjectPath && !stagingRemoved) {
      await staging.removeObject(existingObjectPath);
      stagingRemoved = true;
    }
    return {
      workflowState: 'published',
      status: 'published',
      externalId: existingMediaId,
      mediaId: existingMediaId,
      publicUrl: media.permalink,
      publishedAt: media.timestamp || asOf,
      stagingRemoved,
      asset: prepared.asset,
    };
  }

  let containerId = normalizeText(publication.external_id);
  let staged = {
    objectPath: normalizeText(publication.metadata?.instagram_story_staging_object_path),
    publicUrl: normalizeText(publication.metadata?.instagram_story_staging_public_url),
  };
  if (!containerId) {
    if (!staged.objectPath || !staged.publicUrl) {
      staged = await staging.stageFile({
        publicationId: publication.id,
        filePath: prepared.asset.outputPath,
        pathPrefix: 'instagram-story',
      });
    }
    if (typeof onStaged === 'function') {
      await onStaged({ ...staged, stagedAt: asOf });
    }
    await staging.verifyPublicObject(staged.publicUrl);
    const initialized = await client.createStoryContainer({
      instagramUserId: prepared.instagramUserId,
      videoUrl: staged.publicUrl,
    });
    containerId = initialized.containerId;
    if (typeof onInitialized === 'function') {
      try {
        await onInitialized({ containerId, initializedAt: asOf });
      } catch (error) {
        throw new InstagramPublicationUncertainError(
          `Instagram Story container ${containerId} exists but could not be persisted.`,
          { containerId, cause: error },
        );
      }
    }
    return {
      workflowState: 'publishing',
      status: 'IN_PROGRESS',
      externalId: containerId,
      containerId,
      uploadedAt: asOf,
      stagingRemoved: false,
      asset: prepared.asset,
    };
  }

  const container = await client.fetchContainerStatus(containerId);
  if (container.statusCode === 'ERROR' || container.statusCode === 'EXPIRED') {
    throw new InstagramGraphApiError(
      `Instagram Story container ${containerId} failed: ${container.status || container.statusCode}.`,
      { code: 'instagram_story_container_failed', payload: container.payload },
    );
  }
  if (container.statusCode !== 'FINISHED') {
    return {
      workflowState: 'publishing',
      status: container.statusCode || 'IN_PROGRESS',
      externalId: containerId,
      containerId,
      stagingRemoved: false,
      asset: prepared.asset,
    };
  }

  let published;
  try {
    published = await client.publishStory({
      instagramUserId: prepared.instagramUserId,
      containerId,
    });
  } catch (error) {
    if (error instanceof InstagramGraphApiError && error.status >= 400 && error.status < 500) {
      throw error;
    }
    throw new InstagramPublicationUncertainError(
      `Instagram Story publish outcome for container ${containerId} is uncertain.`,
      { containerId, cause: error },
    );
  }
  if (typeof onPublished === 'function') {
    try {
      await onPublished({ mediaId: published.mediaId, publishedAt: asOf });
    } catch (error) {
      throw new InstagramPublicationUncertainError(
        `Instagram Story media ${published.mediaId} exists but could not be persisted.`,
        { containerId, mediaId: published.mediaId, cause: error },
      );
    }
  }
  const media = await client.fetchMedia(published.mediaId);
  let stagingRemoved = false;
  if (staged.objectPath) {
    await staging.removeObject(staged.objectPath);
    stagingRemoved = true;
  }
  return {
    workflowState: 'published',
    status: 'published',
    externalId: published.mediaId,
    containerId,
    mediaId: published.mediaId,
    publicUrl: media.permalink,
    publishedAt: media.timestamp || asOf,
    stagingRemoved,
    asset: prepared.asset,
  };
}
