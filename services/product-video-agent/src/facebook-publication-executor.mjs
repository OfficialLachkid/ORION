import { readFile, stat } from 'node:fs/promises';
import {
  FacebookPublicationValidationError,
  resolveFacebookReelApproval,
} from './facebook-publication.mjs';
import { hashFileSha256 } from './tiktok-publication-executor.mjs';
import {
  buildPublicationRenderPathCandidates,
  resolveAvailablePublicationRender,
} from './publication-render-path.mjs';

export const DEFAULT_FACEBOOK_GRAPH_ENDPOINT = 'https://graph.facebook.com';

export class FacebookGraphApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FacebookGraphApiError';
    this.code = details.code || 'facebook_graph_api_error';
    this.status = details.status || 0;
    this.payload = details.payload || null;
  }
}

export class FacebookPublicationUncertainError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FacebookPublicationUncertainError';
    this.code = 'facebook_publish_uncertain';
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

function normalizeVideoStatus(payload = {}) {
  return normalizeText(
    payload?.status?.video_status
      || payload?.status?.publishing_phase?.status
      || payload?.status?.processing_phase?.status
      || payload?.status?.uploading_phase?.status
      || payload?.video_status
      || payload?.status,
  ).toLowerCase();
}

function isPublishedStatus(status) {
  return ['published', 'ready', 'complete', 'completed'].includes(status);
}

export class FacebookGraphClient {
  constructor(options = {}) {
    this.accessToken = normalizeText(options.accessToken);
    this.apiVersion = normalizeVersion(options.apiVersion);
    this.endpoint = normalizeText(options.endpoint || DEFAULT_FACEBOOK_GRAPH_ENDPOINT)
      .replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  assertConfigured() {
    if (!this.accessToken || !this.apiVersion) {
      throw new FacebookPublicationValidationError(
        'Facebook Graph delivery requires a Page access token and explicit API version.',
        { code: 'facebook_auth_required' },
      );
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Facebook Graph delivery requires fetch support.');
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
      throw new FacebookGraphApiError(
        `Facebook Graph request failed (${response.status}): ${graphErrorMessage(payload).slice(0, 500)}`,
        { status: response.status, payload },
      );
    }
    return payload || {};
  }

  async fetchPageIdentity(pageId) {
    const payload = await this.request(pageId, {
      query: { fields: 'id,name,username,link' },
    });
    return {
      pageId: normalizeText(payload.id),
      name: normalizeText(payload.name),
      username: normalizeText(payload.username),
      link: normalizeText(payload.link),
      payload,
    };
  }

  async startReelUpload(pageId) {
    const payload = await this.request(`${pageId}/video_reels`, {
      method: 'POST',
      body: { upload_phase: 'START' },
    });
    const videoId = normalizeText(payload.video_id);
    const uploadUrl = normalizeText(payload.upload_url);
    if (!videoId || !uploadUrl) {
      throw new FacebookGraphApiError('Facebook did not return a Reel video id and upload URL.', {
        code: 'facebook_upload_session_missing',
        payload,
      });
    }
    return { videoId, uploadUrl, payload };
  }

  async uploadReelBytes({ uploadUrl, bytes, fileSize }) {
    this.assertConfigured();
    const response = await this.fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${this.accessToken}`,
        offset: '0',
        file_size: String(fileSize),
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
    const payload = await readResponse(response);
    if (!response.ok || payload?.error || payload?.success === false) {
      throw new FacebookGraphApiError(
        `Facebook Reel upload failed (${response.status}): ${graphErrorMessage(payload).slice(0, 500)}`,
        { status: response.status, payload },
      );
    }
    return { payload };
  }

  async finishReel({ pageId, videoId, description }) {
    const payload = await this.request(`${pageId}/video_reels`, {
      method: 'POST',
      body: {
        upload_phase: 'FINISH',
        video_id: videoId,
        video_state: 'PUBLISHED',
        description,
      },
    });
    return { payload };
  }

  async fetchReel(videoId) {
    const payload = await this.request(videoId, {
      query: { fields: 'id,status,permalink_url,created_time' },
    });
    return {
      videoId: normalizeText(payload.id || videoId),
      status: normalizeVideoStatus(payload),
      permalink: normalizeText(payload.permalink_url),
      createdTime: normalizeText(payload.created_time),
      payload,
    };
  }
}

function resolveStoredTarget(publication = {}, target = {}) {
  const stored = publication.metadata?.publisher_target || {};
  return Object.keys(target).length > 0 ? target : stored;
}

function resolveConfiguredRenderPath(publication = {}, videoRow = {}) {
  const configuredPath = normalizeText(
    publication.metadata?.facebook_reel_approval?.render_path
      || publication.metadata?.render_path
      || videoRow.render?.output_path,
  );
  if (!configuredPath) {
    throw new FacebookPublicationValidationError(
      'Facebook publication is missing the approved MP4 render path.',
      { code: 'facebook_render_path_missing' },
    );
  }
  return configuredPath;
}

export function createFacebookGraphClient(runtimeEnv = {}, target = {}, options = {}) {
  const accessTokenEnv = normalizeText(
    target.facebook?.access_token_env || target.facebook?.accessTokenEnv,
  );
  return new FacebookGraphClient({
    accessToken: accessTokenEnv ? runtimeEnv[accessTokenEnv] : '',
    apiVersion: runtimeEnv.FACEBOOK_GRAPH_API_VERSION || '',
    endpoint: runtimeEnv.FACEBOOK_GRAPH_ENDPOINT || DEFAULT_FACEBOOK_GRAPH_ENDPOINT,
    fetchImpl: options.fetchImpl,
  });
}

export async function prepareFacebookReelPublication({
  publication,
  videoRow,
  target = {},
  runtimeEnv = {},
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
}) {
  const resolvedTarget = resolveStoredTarget(publication, target);
  const configuredRenderPath = resolveConfiguredRenderPath(publication, videoRow);
  const [approvedRenderPath] = buildPublicationRenderPathCandidates(
    configuredRenderPath,
    projectRoot,
  );
  const { renderPath, fileStats } = await resolveAvailablePublicationRender({
    configuredPath: configuredRenderPath,
    projectRoot,
    statImpl,
  });
  const videoSizeBytes = Number(fileStats?.size || 0);
  const videoSha256 = await hashFileImpl(renderPath);
  const approval = resolveFacebookReelApproval({
    publication,
    target: resolvedTarget,
    renderPath: approvedRenderPath,
    videoSizeBytes,
    videoSha256,
  });
  if (!approval.pageId) {
    throw new FacebookPublicationValidationError(
      'Facebook target requires a Page id.',
      { code: 'facebook_page_id_required' },
    );
  }
  if (!approval.accessTokenEnv || !normalizeText(runtimeEnv[approval.accessTokenEnv])) {
    throw new FacebookPublicationValidationError(
      `Facebook Page access token is missing from ${approval.accessTokenEnv || 'the target configuration'}.`,
      { code: 'facebook_auth_required' },
    );
  }
  if (!normalizeText(runtimeEnv.FACEBOOK_GRAPH_API_VERSION)) {
    throw new FacebookPublicationValidationError(
      'FACEBOOK_GRAPH_API_VERSION must be set explicitly before live delivery.',
      { code: 'facebook_api_version_required' },
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

export async function publishFacebookReel({
  publication,
  videoRow,
  target = {},
  runtimeEnv = {},
  projectRoot = process.cwd(),
  asOf = new Date().toISOString(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
  readFileImpl = readFile,
  graphClient = null,
  onInitialized = null,
  onUploaded = null,
  onFinishRequested = null,
}) {
  const prepared = await prepareFacebookReelPublication({
    publication,
    videoRow,
    target,
    runtimeEnv,
    projectRoot,
    statImpl,
    hashFileImpl,
  });
  const client = graphClient || createFacebookGraphClient(runtimeEnv, prepared.target);
  let videoId = normalizeText(publication.external_id);
  let uploadUrl = normalizeText(publication.metadata?.facebook_upload_url);

  if (!videoId) {
    const initialized = await client.startReelUpload(prepared.approval.pageId);
    videoId = initialized.videoId;
    uploadUrl = initialized.uploadUrl;
    if (typeof onInitialized === 'function') {
      try {
        await onInitialized({ videoId, uploadUrl, initializedAt: asOf });
      } catch (error) {
        throw new FacebookPublicationUncertainError(
          `Facebook upload session ${videoId} exists but could not be persisted.`,
          { videoId, cause: error },
        );
      }
    }
  }

  const uploadCompleted = Boolean(normalizeText(publication.metadata?.facebook_upload_completed_at));
  if (!uploadCompleted) {
    if (!uploadUrl) {
      throw new FacebookPublicationUncertainError(
        `Facebook upload session ${videoId} is missing its upload URL.`,
        { videoId },
      );
    }
    const bytes = await readFileImpl(prepared.renderPath);
    await client.uploadReelBytes({
      uploadUrl,
      bytes,
      fileSize: prepared.videoSizeBytes,
    });
    if (typeof onUploaded === 'function') {
      await onUploaded({ videoId, uploadedAt: asOf });
    }
    return {
      workflowState: 'publishing',
      status: 'uploaded',
      externalId: videoId,
      videoId,
      uploadUrl,
      uploadedAt: asOf,
    };
  }

  const finishRequested = Boolean(normalizeText(
    publication.metadata?.facebook_finish_requested_at,
  ));
  if (!finishRequested) {
    try {
      await client.finishReel({
        pageId: prepared.approval.pageId,
        videoId,
        description: prepared.approval.description,
      });
    } catch (error) {
      if (error instanceof FacebookGraphApiError && error.status >= 400 && error.status < 500) {
        throw error;
      }
      throw new FacebookPublicationUncertainError(
        `Facebook publish outcome for Reel ${videoId} is uncertain; automatic retry is blocked.`,
        { videoId, cause: error },
      );
    }
    if (typeof onFinishRequested === 'function') {
      try {
        await onFinishRequested({ videoId, requestedAt: asOf });
      } catch (error) {
        throw new FacebookPublicationUncertainError(
          `Facebook Reel ${videoId} was submitted but its receipt could not be persisted.`,
          { videoId, cause: error },
        );
      }
    }
    return {
      workflowState: 'publishing',
      status: 'processing',
      externalId: videoId,
      videoId,
      uploadedAt: publication.uploaded_at || asOf,
    };
  }

  const reel = await client.fetchReel(videoId);
  if (['error', 'failed', 'expired'].includes(reel.status)) {
    throw new FacebookGraphApiError(
      `Facebook Reel ${videoId} failed with status ${reel.status}.`,
      { code: 'facebook_reel_failed', payload: reel.payload },
    );
  }
  const published = isPublishedStatus(reel.status) || Boolean(reel.permalink);
  return {
    workflowState: published ? 'published' : 'publishing',
    status: reel.status || 'processing',
    externalId: videoId,
    videoId,
    publicUrl: reel.permalink,
    publishedAt: published ? reel.createdTime || asOf : '',
    uploadedAt: publication.uploaded_at || asOf,
  };
}
