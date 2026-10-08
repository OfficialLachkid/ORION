import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashFileSha256 } from './tiktok-publication-executor.mjs';
import {
  DEFAULT_PUBLICATION_STAGING_BUCKET,
  DEFAULT_PUBLICATION_STAGING_MAX_BYTES,
  SupabasePublicationStaging,
} from './supabase-publication-staging.mjs';

const BUFFER_API_ENDPOINT = 'https://api.buffer.com';

function normalizeText(value) {
  return String(value || '').trim();
}

function resolveBufferConfig(target = {}) {
  const config = target.buffer && typeof target.buffer === 'object' ? target.buffer : {};
  return {
    organizationId: normalizeText(config.organization_id || config.organizationId),
    channelId: normalizeText(config.channel_id || config.channelId),
    expectedService: normalizeText(config.expected_service || config.expectedService || 'tiktok').toLowerCase(),
    expectedUsername: normalizeText(config.expected_username || config.expectedUsername)
      .replace(/^@/u, '')
      .toLowerCase(),
  };
}

function resolveApproval(publication = {}) {
  const approval = publication.metadata?.tiktok_direct_post_approval;
  if (!approval || approval.approved !== true) {
    throw new BufferPublicationValidationError('Buffer publication requires shared-review approval.', {
      code: 'buffer_consent_required',
    });
  }
  if (normalizeText(approval.publication_id) && approval.publication_id !== publication.id) {
    throw new BufferPublicationValidationError('Buffer approval belongs to a different publication.', {
      code: 'buffer_approval_publication_mismatch',
    });
  }
  if (normalizeText(approval.account_key) !== normalizeText(publication.account_key)) {
    throw new BufferPublicationValidationError('Buffer approval belongs to a different account.', {
      code: 'buffer_approval_account_mismatch',
    });
  }
  return approval;
}

function resolveRenderPath(publication = {}, videoRow = {}, projectRoot = process.cwd()) {
  const configuredPath = normalizeText(
    publication.metadata?.render_path || videoRow.render?.output_path,
  );
  if (!configuredPath) {
    throw new BufferPublicationValidationError('Buffer publication has no approved render path.', {
      code: 'buffer_render_path_missing',
    });
  }
  return resolve(projectRoot, configuredPath);
}

function mapBufferStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === 'sent') return 'published';
  if (normalized === 'error') return 'failed';
  return 'publishing';
}

function isDefiniteBufferApiError(error) {
  return error instanceof BufferPublicationApiError;
}

function getRecoveryWindow(asOf) {
  const timestamp = new Date(asOf);
  const center = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
  return {
    startDate: new Date(center.getTime() - 10 * 60 * 1000).toISOString(),
    endDate: new Date(center.getTime() + 10 * 60 * 1000).toISOString(),
  };
}

export class BufferPublicationValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BufferPublicationValidationError';
    this.code = details.code || 'buffer_publication_validation_failed';
  }
}

export class BufferPublicationApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BufferPublicationApiError';
    this.code = details.code || 'buffer_api_error';
    this.status = details.status || 0;
    this.payload = details.payload;
  }
}

export class BufferPublicationUncertainError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BufferPublicationUncertainError';
    this.code = 'buffer_create_uncertain';
    this.staging = details.staging || null;
    this.cause = details.cause;
  }
}

export class BufferApiClient {
  constructor(options = {}) {
    this.apiKey = normalizeText(options.apiKey);
    this.endpoint = normalizeText(options.endpoint) || BUFFER_API_ENDPOINT;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  assertConfigured() {
    if (!this.apiKey) throw new Error('Buffer delivery requires BUFFER_API_KEY.');
    if (typeof this.fetchImpl !== 'function') throw new Error('Buffer delivery requires fetch support.');
  }

  async request(query, variables = {}) {
    this.assertConfigured();
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok || payload.errors) {
      throw new BufferPublicationApiError(
        `Buffer API request failed (${response.status}): ${JSON.stringify(payload.errors || payload).slice(0, 600)}`,
        { status: response.status, payload },
      );
    }
    return payload.data || {};
  }

  async createVideoPost({
    channelId,
    text,
    videoUrl,
    thumbnailOffset = 1000,
    isAiGenerated = false,
  }) {
    const data = await this.request(`
      mutation CreateVideoPost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post {
              id
              status
              externalLink
              sentAt
              createdAt
              assets { source }
            }
          }
          ... on MutationError { message }
        }
      }
    `, {
      input: {
        text: String(text || ''),
        channelId: normalizeText(channelId),
        schedulingType: 'automatic',
        mode: 'shareNow',
        source: 'orion',
        aiAssisted: false,
        metadata: { tiktok: { isAiGenerated: isAiGenerated === true } },
        assets: [{
          video: {
            url: normalizeText(videoUrl),
            metadata: { thumbnailOffset: Number(thumbnailOffset || 1000) },
          },
        }],
      },
    });
    const result = data.createPost || {};
    if (result.__typename !== 'PostActionSuccess' || !result.post?.id) {
      throw new BufferPublicationApiError(
        `Buffer createPost failed: ${normalizeText(result.message) || result.__typename || 'unknown error'}`,
        { payload: result },
      );
    }
    return result.post;
  }

  async fetchPost(postId) {
    const data = await this.request(`
      query GetPost($input: PostInput!) {
        post(input: $input) {
          id
          status
          externalLink
          sentAt
          createdAt
          assets { source }
          error { message rawError supportUrl }
        }
      }
    `, { input: { id: normalizeText(postId) } });
    if (!data.post?.id) {
      throw new BufferPublicationApiError(`Buffer post ${postId} was not found.`, {
        code: 'buffer_post_not_found',
      });
    }
    return data.post;
  }

  async recoverVideoPost({ organizationId, channelId, videoUrl, text, asOf }) {
    const window = getRecoveryWindow(asOf);
    const data = await this.request(`
      query RecoverVideoPost($input: PostsInput!) {
        posts(first: 25, input: $input) {
          edges {
            node {
              id
              status
              text
              channelId
              externalLink
              sentAt
              createdAt
              assets { source }
              error { message rawError supportUrl }
            }
          }
        }
      }
    `, {
      input: {
        organizationId: normalizeText(organizationId),
        sort: [{ field: 'createdAt', direction: 'desc' }],
        filter: {
          channelIds: [normalizeText(channelId)],
          startDate: window.startDate,
          endDate: window.endDate,
          status: ['draft', 'needs_approval', 'scheduled', 'sending', 'sent', 'error'],
        },
      },
    });
    const posts = (data.posts?.edges || []).map((edge) => edge?.node).filter(Boolean);
    return posts.find((post) => (
      post.channelId === channelId
      && post.text === String(text || '')
      && (post.assets || []).some((asset) => normalizeText(asset?.source) === normalizeText(videoUrl))
    )) || null;
  }
}

export function createBufferApiClient(runtimeEnv = {}, options = {}) {
  return new BufferApiClient({
    apiKey: runtimeEnv.BUFFER_API_KEY || '',
    endpoint: runtimeEnv.BUFFER_API_ENDPOINT || BUFFER_API_ENDPOINT,
    fetchImpl: options.fetchImpl,
  });
}

export function createSupabaseStagingClient(runtimeEnv = {}, options = {}) {
  return new SupabasePublicationStaging({
    supabaseUrl: runtimeEnv.SUPABASE_URL || '',
    apiKey: runtimeEnv.SUPABASE_SECRET_KEY || '',
    bucketName: runtimeEnv.BUFFER_STAGING_BUCKET || DEFAULT_PUBLICATION_STAGING_BUCKET,
    maxFileBytes: Number(
      runtimeEnv.BUFFER_STAGING_MAX_FILE_BYTES || DEFAULT_PUBLICATION_STAGING_MAX_BYTES,
    ),
    fetchImpl: options.fetchImpl,
  });
}

export async function prepareBufferPublication({
  publication,
  videoRow,
  target,
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
}) {
  const approval = resolveApproval(publication);
  const buffer = resolveBufferConfig(target);
  if (!buffer.organizationId || !buffer.channelId) {
    throw new BufferPublicationValidationError(
      'Buffer target requires organization_id and channel_id.',
      { code: 'buffer_target_incomplete' },
    );
  }
  if (buffer.expectedService !== 'tiktok') {
    throw new BufferPublicationValidationError('Buffer target must be a TikTok channel.', {
      code: 'buffer_target_service_mismatch',
    });
  }
  if (normalizeText(approval.delivery_provider) !== 'buffer') {
    throw new BufferPublicationValidationError(
      'Shared approval was not issued for Buffer delivery.',
      { code: 'buffer_approval_provider_mismatch' },
    );
  }
  if (
    normalizeText(approval.buffer_organization_id) !== buffer.organizationId
    || normalizeText(approval.buffer_channel_id) !== buffer.channelId
  ) {
    throw new BufferPublicationValidationError(
      'Shared approval belongs to a different Buffer destination.',
      { code: 'buffer_approval_destination_mismatch' },
    );
  }
  const approvedUsername = normalizeText(approval.creator_username).replace(/^@/u, '').toLowerCase();
  if (buffer.expectedUsername && approvedUsername !== buffer.expectedUsername) {
    throw new BufferPublicationValidationError(
      'Shared approval belongs to a different TikTok creator.',
      { code: 'buffer_approval_creator_mismatch' },
    );
  }
  const renderPath = resolveRenderPath(publication, videoRow, projectRoot);
  const fileStats = await statImpl(renderPath);
  const videoSizeBytes = Number(fileStats?.size || 0);
  if (videoSizeBytes !== Number(approval.video_size_bytes)) {
    throw new BufferPublicationValidationError(
      `Approved video size no longer matches: expected ${approval.video_size_bytes}, got ${videoSizeBytes}.`,
      { code: 'buffer_video_size_mismatch' },
    );
  }
  const videoSha256 = await hashFileImpl(renderPath);
  if (videoSha256 !== normalizeText(approval.video_sha256)) {
    throw new BufferPublicationValidationError('Approved video SHA-256 no longer matches.', {
      code: 'buffer_video_hash_mismatch',
    });
  }
  return {
    approval,
    buffer,
    renderPath,
    videoSizeBytes,
    videoSha256,
  };
}

export async function publishBufferVideo({
  publication,
  videoRow,
  target,
  runtimeEnv = {},
  projectRoot = process.cwd(),
  asOf = new Date().toISOString(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
  stagingClient = createSupabaseStagingClient(runtimeEnv),
  bufferClient = createBufferApiClient(runtimeEnv),
  onStaged = null,
  onInitialized = null,
}) {
  const prepared = await prepareBufferPublication({
    publication,
    videoRow,
    target,
    projectRoot,
    statImpl,
    hashFileImpl,
  });
  const existingStagingUrl = normalizeText(publication.metadata?.buffer_staging_public_url);
  const existingObjectPath = normalizeText(publication.metadata?.buffer_staging_object_path);
  const staged = existingStagingUrl && existingObjectPath
    ? {
      publicUrl: existingStagingUrl,
      objectPath: existingObjectPath,
      sizeBytes: prepared.videoSizeBytes,
    }
    : await stagingClient.stageFile({
      publicationId: publication.id,
      filePath: prepared.renderPath,
    });

  if (typeof onStaged === 'function') {
    await onStaged({
      ...staged,
      stagedAt: asOf,
      videoSha256: prepared.videoSha256,
    });
  }
  if (typeof stagingClient.verifyPublicObject === 'function') {
    await stagingClient.verifyPublicObject(staged.publicUrl);
  }

  const createInput = {
    channelId: prepared.buffer.channelId,
    text: String(prepared.approval.caption || ''),
    videoUrl: staged.publicUrl,
    thumbnailOffset: Number(prepared.approval.video_cover_timestamp_ms || 1000),
    isAiGenerated: prepared.approval.is_aigc === true,
  };
  let post;
  let recovered = false;
  try {
    post = await bufferClient.createVideoPost(createInput);
  } catch (error) {
    if (isDefiniteBufferApiError(error)) throw error;
    try {
      post = await bufferClient.recoverVideoPost({
        organizationId: prepared.buffer.organizationId,
        channelId: prepared.buffer.channelId,
        videoUrl: staged.publicUrl,
        text: createInput.text,
        asOf,
      });
      recovered = Boolean(post?.id);
    } catch {
      post = null;
    }
    if (!post?.id) {
      throw new BufferPublicationUncertainError(
        'Buffer createPost outcome is uncertain; automatic re-creation is blocked pending recovery.',
        { staging: staged, cause: error },
      );
    }
  }

  if (typeof onInitialized === 'function') {
    try {
      await onInitialized({
        externalId: post.id,
        postId: post.id,
        initializedAt: post.createdAt || asOf,
        rawStatus: post.status || '',
        recovered,
      });
    } catch (error) {
      throw new BufferPublicationUncertainError(
        `Buffer post ${post.id} exists but its id could not be persisted; automatic re-creation is blocked.`,
        { staging: staged, cause: error },
      );
    }
  }

  const workflowState = mapBufferStatus(post.status);
  let stagingRemoved = false;
  if (workflowState === 'published') {
    await stagingClient.removeObject(staged.objectPath);
    stagingRemoved = true;
  }
  return {
    platform: 'tiktok_video',
    provider: 'buffer',
    action: recovered ? 'publish_recovered' : 'publish_upload',
    status: workflowState,
    workflowState,
    rawStatus: post.status || '',
    externalId: post.id,
    postId: post.id,
    publicUrl: post.externalLink || '',
    publishedAt: post.sentAt || '',
    uploadedAt: asOf,
    stagingObjectPath: staged.objectPath,
    stagingPublicUrl: staged.publicUrl,
    stagingRemoved,
    recovered,
  };
}

export async function fetchBufferPublicationStatus({
  postId,
  publication,
  target,
  runtimeEnv = {},
  asOf = new Date().toISOString(),
  stagingClient = createSupabaseStagingClient(runtimeEnv),
  bufferClient = createBufferApiClient(runtimeEnv),
}) {
  const buffer = resolveBufferConfig(target);
  const videoUrl = normalizeText(publication?.metadata?.buffer_staging_public_url);
  let post = null;
  if (normalizeText(postId)) {
    post = await bufferClient.fetchPost(postId);
  } else if (videoUrl) {
    post = await bufferClient.recoverVideoPost({
      organizationId: buffer.organizationId,
      channelId: buffer.channelId,
      videoUrl,
      text: String(publication?.metadata?.tiktok_direct_post_approval?.caption || ''),
      asOf: publication?.metadata?.buffer_create_attempted_at || asOf,
    });
  }
  if (!post?.id) {
    throw new BufferPublicationUncertainError(
      'Buffer post could not yet be recovered from the uncertain create attempt.',
      {
        staging: {
          objectPath: publication?.metadata?.buffer_staging_object_path || '',
          publicUrl: videoUrl,
        },
      },
    );
  }

  const status = mapBufferStatus(post.status);
  const objectPath = normalizeText(publication?.metadata?.buffer_staging_object_path);
  let stagingRemoved = false;
  if (status === 'published' && objectPath) {
    await stagingClient.removeObject(objectPath);
    stagingRemoved = true;
  }
  return {
    platform: 'tiktok_video',
    provider: 'buffer',
    action: 'status_fetch',
    status,
    rawStatus: post.status || '',
    failReason: normalizeText(post.error?.message || post.error?.rawError),
    postId: post.id,
    externalId: post.id,
    publicUrl: post.externalLink || '',
    publishedAt: post.sentAt || '',
    stagingRemoved,
    payload: post,
  };
}
