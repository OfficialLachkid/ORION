import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DEFAULT_PUBLICATION_STAGING_BUCKET,
  DEFAULT_PUBLICATION_STAGING_MAX_BYTES,
  SupabasePublicationStaging,
} from './supabase-publication-staging.mjs';
import {
  InstagramPublicationValidationError,
  resolveInstagramReelApproval,
} from './instagram-publication.mjs';
import { hashFileSha256 } from './tiktok-publication-executor.mjs';

export const DEFAULT_INSTAGRAM_GRAPH_ENDPOINT = 'https://graph.instagram.com';

export class InstagramGraphApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InstagramGraphApiError';
    this.code = details.code || 'instagram_graph_api_error';
    this.status = details.status || 0;
    this.payload = details.payload || null;
  }
}

export class InstagramPublicationUncertainError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InstagramPublicationUncertainError';
    this.code = 'instagram_publish_uncertain';
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeVersion(value) {
  return normalizeText(value).replace(/^\/+|\/+$/gu, '');
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function graphErrorMessage(payload) {
  if (typeof payload === 'string') return payload;
  return normalizeText(
    payload?.error?.error_user_msg
      || payload?.error?.message
      || payload?.message
      || JSON.stringify(payload || {}),
  );
}

export class InstagramGraphClient {
  constructor(options = {}) {
    this.accessToken = normalizeText(options.accessToken);
    this.apiVersion = normalizeVersion(options.apiVersion);
    this.endpoint = normalizeText(options.endpoint || DEFAULT_INSTAGRAM_GRAPH_ENDPOINT)
      .replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  assertConfigured() {
    if (!this.accessToken || !this.apiVersion) {
      throw new InstagramPublicationValidationError(
        'Instagram Graph delivery requires an access token and explicit API version.',
        { code: 'instagram_auth_required' },
      );
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Instagram Graph delivery requires fetch support.');
    }
  }

  buildUrl(pathname, query = {}) {
    const path = `${this.apiVersion}/${String(pathname || '').replace(/^\/+/, '')}`;
    const url = new URL(path, `${this.endpoint}/`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request(pathname, options = {}) {
    this.assertConfigured();
    const response = await this.fetchImpl(this.buildUrl(pathname, options.query), {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(options.body ? { body: new URLSearchParams(options.body) } : {}),
    });
    const payload = await readResponse(response);
    if (!response.ok || payload?.error) {
      throw new InstagramGraphApiError(
        `Instagram Graph request failed (${response.status}): ${graphErrorMessage(payload).slice(0, 500)}`,
        { status: response.status, payload },
      );
    }
    return payload || {};
  }

  async createReelContainer({ instagramUserId, videoUrl, caption, shareToFeed }) {
    const payload = await this.request(`${instagramUserId}/media`, {
      method: 'POST',
      body: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        share_to_feed: shareToFeed ? 'true' : 'false',
      },
    });
    const containerId = normalizeText(payload.id);
    if (!containerId) {
      throw new InstagramGraphApiError('Instagram did not return a Reel container id.', {
        code: 'instagram_container_id_missing',
        payload,
      });
    }
    return { containerId, payload };
  }

  async fetchContainerStatus(containerId) {
    const payload = await this.request(containerId, {
      query: { fields: 'status_code,status' },
    });
    return {
      containerId: normalizeText(payload.id || containerId),
      statusCode: normalizeText(payload.status_code).toUpperCase(),
      status: normalizeText(payload.status),
      payload,
    };
  }

  async publishReel({ instagramUserId, containerId }) {
    const payload = await this.request(`${instagramUserId}/media_publish`, {
      method: 'POST',
      body: { creation_id: containerId },
    });
    const mediaId = normalizeText(payload.id);
    if (!mediaId) {
      throw new InstagramGraphApiError('Instagram did not return a published media id.', {
        code: 'instagram_media_id_missing',
        payload,
      });
    }
    return { mediaId, payload };
  }

  async fetchMedia(mediaId) {
    const payload = await this.request(mediaId, {
      query: { fields: 'id,media_type,permalink,timestamp' },
    });
    return {
      mediaId: normalizeText(payload.id || mediaId),
      mediaType: normalizeText(payload.media_type),
      permalink: normalizeText(payload.permalink),
      timestamp: normalizeText(payload.timestamp),
      payload,
    };
  }

  async fetchAuthenticatedProfile() {
    const payload = await this.request('me', {
      query: { fields: 'id,username,account_type' },
    });
    return {
      id: normalizeText(payload.id),
      username: normalizeText(payload.username).replace(/^@/u, '').toLowerCase(),
      accountType: normalizeText(payload.account_type),
      payload,
    };
  }
}

function resolveStoredTarget(publication = {}, target = {}) {
  const stored = publication.metadata?.publisher_target || {};
  return Object.keys(target).length > 0 ? target : stored;
}

function resolveRenderPath(publication = {}, videoRow = {}, projectRoot = process.cwd()) {
  const configuredPath = normalizeText(
    publication.metadata?.instagram_reel_approval?.render_path
      || publication.metadata?.render_path
      || videoRow.render?.output_path,
  );
  if (!configuredPath) {
    throw new InstagramPublicationValidationError(
      'Instagram publication is missing the approved MP4 render path.',
      { code: 'instagram_render_path_missing' },
    );
  }
  return resolve(projectRoot, configuredPath);
}

export function createInstagramGraphClient(runtimeEnv = {}, target = {}, options = {}) {
  const accessTokenEnv = normalizeText(
    target.instagram?.access_token_env || target.instagram?.accessTokenEnv,
  );
  return new InstagramGraphClient({
    accessToken: accessTokenEnv ? runtimeEnv[accessTokenEnv] : '',
    apiVersion: runtimeEnv.INSTAGRAM_GRAPH_API_VERSION || '',
    endpoint: runtimeEnv.INSTAGRAM_GRAPH_ENDPOINT || DEFAULT_INSTAGRAM_GRAPH_ENDPOINT,
    fetchImpl: options.fetchImpl,
  });
}

export function createInstagramStagingClient(runtimeEnv = {}, options = {}) {
  return new SupabasePublicationStaging({
    supabaseUrl: runtimeEnv.SUPABASE_URL || '',
    apiKey: runtimeEnv.SUPABASE_SECRET_KEY || '',
    bucketName: runtimeEnv.INSTAGRAM_STAGING_BUCKET
      || runtimeEnv.BUFFER_STAGING_BUCKET
      || DEFAULT_PUBLICATION_STAGING_BUCKET,
    maxFileBytes: Number(
      runtimeEnv.INSTAGRAM_STAGING_MAX_FILE_BYTES
        || runtimeEnv.BUFFER_STAGING_MAX_FILE_BYTES
        || DEFAULT_PUBLICATION_STAGING_MAX_BYTES,
    ),
    fetchImpl: options.fetchImpl,
  });
}

export async function prepareInstagramReelPublication({
  publication,
  videoRow,
  target = {},
  runtimeEnv = {},
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
}) {
  const resolvedTarget = resolveStoredTarget(publication, target);
  const renderPath = resolveRenderPath(publication, videoRow, projectRoot);
  const fileStats = await statImpl(renderPath);
  const videoSizeBytes = Number(fileStats?.size || 0);
  const videoSha256 = await hashFileImpl(renderPath);
  const approval = resolveInstagramReelApproval({
    publication,
    target: resolvedTarget,
    renderPath,
    videoSizeBytes,
    videoSha256,
  });
  if (!approval.accessTokenEnv || !normalizeText(runtimeEnv[approval.accessTokenEnv])) {
    throw new InstagramPublicationValidationError(
      `Instagram access token is missing from ${approval.accessTokenEnv || 'the target configuration'}.`,
      { code: 'instagram_auth_required' },
    );
  }
  if (!normalizeText(runtimeEnv.INSTAGRAM_GRAPH_API_VERSION)) {
    throw new InstagramPublicationValidationError(
      'INSTAGRAM_GRAPH_API_VERSION must be set explicitly before live delivery.',
      { code: 'instagram_api_version_required' },
    );
  }
  return {
    approval,
    target: resolvedTarget,
    renderPath,
    videoSizeBytes,
    videoSha256,
  };
}

export async function publishInstagramReel({
  publication,
  videoRow,
  target = {},
  runtimeEnv = {},
  projectRoot = process.cwd(),
  asOf = new Date().toISOString(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
  stagingClient = null,
  graphClient = null,
  onStaged = null,
  onInitialized = null,
  onPublished = null,
}) {
  const prepared = await prepareInstagramReelPublication({
    publication,
    videoRow,
    target,
    runtimeEnv,
    projectRoot,
    statImpl,
    hashFileImpl,
  });
  const client = graphClient || createInstagramGraphClient(runtimeEnv, prepared.target);
  const staging = stagingClient || createInstagramStagingClient(runtimeEnv);
  const existingMediaId = normalizeText(publication.metadata?.instagram_media_id);
  if (existingMediaId) {
    const media = await client.fetchMedia(existingMediaId);
    const existingObjectPath = normalizeText(
      publication.metadata?.instagram_staging_object_path,
    );
    let stagingRemoved = Boolean(publication.metadata?.instagram_staging_removed_at);
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
    };
  }

  let containerId = normalizeText(publication.external_id);
  let staged = {
    objectPath: normalizeText(publication.metadata?.instagram_staging_object_path),
    publicUrl: normalizeText(publication.metadata?.instagram_staging_public_url),
  };
  if (!containerId) {
    if (!staged.objectPath || !staged.publicUrl) {
      staged = await staging.stageFile({
        publicationId: publication.id,
        filePath: prepared.renderPath,
        pathPrefix: 'instagram',
      });
    }
    if (typeof onStaged === 'function') {
      await onStaged({
        ...staged,
        stagedAt: asOf,
        videoSha256: prepared.videoSha256,
      });
    }
    await staging.verifyPublicObject(staged.publicUrl);
    const initialized = await client.createReelContainer({
      instagramUserId: prepared.approval.instagramUserId,
      videoUrl: staged.publicUrl,
      caption: prepared.approval.caption,
      shareToFeed: prepared.approval.shareToFeed,
    });
    containerId = initialized.containerId;
    if (typeof onInitialized === 'function') {
      try {
        await onInitialized({
          externalId: containerId,
          containerId,
          initializedAt: asOf,
        });
      } catch (error) {
        throw new InstagramPublicationUncertainError(
          `Instagram container ${containerId} exists but could not be persisted.`,
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
      stagingObjectPath: staged.objectPath,
      stagingPublicUrl: staged.publicUrl,
      stagingRemoved: false,
    };
  }

  const container = await client.fetchContainerStatus(containerId);
  if (container.statusCode === 'ERROR' || container.statusCode === 'EXPIRED') {
    throw new InstagramGraphApiError(
      `Instagram Reel container ${containerId} failed: ${container.status || container.statusCode}.`,
      { code: 'instagram_container_failed', payload: container.payload },
    );
  }
  if (container.statusCode !== 'FINISHED') {
    return {
      workflowState: 'publishing',
      status: container.statusCode || 'IN_PROGRESS',
      rawStatus: container.status,
      externalId: containerId,
      containerId,
      stagingRemoved: false,
    };
  }

  let published;
  try {
    published = await client.publishReel({
      instagramUserId: prepared.approval.instagramUserId,
      containerId,
    });
  } catch (error) {
    if (error instanceof InstagramGraphApiError && error.status >= 400 && error.status < 500) {
      throw error;
    }
    throw new InstagramPublicationUncertainError(
      `Instagram publish outcome for container ${containerId} is uncertain; automatic retry is blocked.`,
      { containerId, cause: error },
    );
  }
  if (typeof onPublished === 'function') {
    try {
      await onPublished({ mediaId: published.mediaId, publishedAt: asOf });
    } catch (error) {
      throw new InstagramPublicationUncertainError(
        `Instagram media ${published.mediaId} exists but could not be persisted.`,
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
  };
}
