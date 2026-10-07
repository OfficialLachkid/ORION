import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { upsertEnvValues } from '../../lib/env-file.mjs';
import {
  TIKTOK_VIDEO_INIT_ENDPOINT,
  buildTikTokDirectPostInitRequest,
  buildTikTokStatusFetchRequest,
  resolveTikTokDirectPostApproval,
  validateTikTokCreatorCapabilities,
} from './tiktok-publication.mjs';
import {
  buildTikTokCredentialEnvValues,
  fetchTikTokCreatorInfo,
  refreshTikTokAccessToken,
  resolveTikTokCredentialEnvKeys,
} from './tiktok-oauth.mjs';
import { probeMediaDurationSeconds } from './media-duration.mjs';
import { resolveFfmpegExecutable } from './runtime-executables.mjs';

export class TikTokPublicationAuthRequiredError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TikTokPublicationAuthRequiredError';
    this.code = 'tiktok_auth_required';
    this.details = details;
  }
}

export class TikTokPublicationApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TikTokPublicationApiError';
    this.code = details.code || 'tiktok_api_error';
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

async function resolveAccessToken(target = {}, runtimeEnv = {}, options = {}) {
  const keys = resolveTikTokCredentialEnvKeys(target);
  const token = normalizeText(runtimeEnv[keys.accessToken]);
  const expiresAt = Date.parse(normalizeText(runtimeEnv[keys.accessTokenExpiresAt]));
  const now = options.now instanceof Date ? options.now : new Date();
  const refreshSkewMs = Number.isFinite(options.refreshSkewMs)
    ? options.refreshSkewMs
    : 10 * 60 * 1000;
  const accessTokenIsFresh = token && (
    !Number.isFinite(expiresAt)
    || expiresAt > now.getTime() + refreshSkewMs
  );
  if (accessTokenIsFresh) {
    return { token, tokenEnv: keys.accessToken };
  }

  const refreshToken = normalizeText(runtimeEnv[keys.refreshToken]);
  const clientConfig = {
    clientKey: normalizeText(runtimeEnv.TIKTOK_CLIENT_KEY),
    clientSecret: normalizeText(runtimeEnv.TIKTOK_CLIENT_SECRET),
  };
  if (!refreshToken || !clientConfig.clientKey || !clientConfig.clientSecret) {
    throw new TikTokPublicationAuthRequiredError(
      token
        ? `TikTok access token ${keys.accessToken} expired and cannot be refreshed.`
        : `Missing TikTok access token env value: ${keys.accessToken}`,
      {
        tokenEnv: keys.accessToken,
        refreshTokenEnv: keys.refreshToken,
      },
    );
  }

  let refreshed;
  try {
    refreshed = await refreshTikTokAccessToken(clientConfig, refreshToken, {
      fetch: options.fetchImpl,
    });
  } catch (error) {
    throw new TikTokPublicationAuthRequiredError(
      `TikTok access-token refresh failed: ${error.message}`,
      {
        tokenEnv: keys.accessToken,
        refreshTokenEnv: keys.refreshToken,
      },
    );
  }

  const credentialValues = buildTikTokCredentialEnvValues(target, {
    ...refreshed,
    openId: refreshed.openId || runtimeEnv[keys.openId],
    scope: refreshed.scope || runtimeEnv[keys.scopes],
  }, { now });
  const persistEnvValues = options.persistEnvValues || upsertEnvValues;
  const envFilePath = resolve(options.projectRoot || process.cwd(), 'config', 'product-video', '.env');
  persistEnvValues(envFilePath, credentialValues);
  Object.assign(runtimeEnv, credentialValues);

  return {
    token: refreshed.accessToken,
    tokenEnv: keys.accessToken,
    refreshed: true,
  };
}

export function resolveTikTokRenderPath(publication = {}, videoRow = {}, projectRoot = process.cwd()) {
  const renderPath = normalizeText(
    publication.metadata?.render_path
      || videoRow.render?.output_path
      || '',
  );
  if (!renderPath) {
    throw new Error(`TikTok publication ${publication.id || ''} has no render path.`);
  }
  return resolve(projectRoot, renderPath);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('TikTok publication requires fetch support.');
  }
}

function createTikTokHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
  };
}

function throwForTikTokError(payload = {}, response = null, action = 'TikTok request') {
  const errorPayload = payload.error || {};
  const code = normalizeText(errorPayload.code);
  const message = normalizeText(errorPayload.message);
  if (code && code !== 'ok') {
    throw new TikTokPublicationApiError(`${action} failed: ${message || code}`, {
      code,
      message,
      logId: errorPayload.log_id || '',
      status: response?.status || 0,
      payload,
    });
  }
}

async function uploadFileInChunks({
  uploadUrl,
  renderPath,
  videoSizeBytes,
  chunkSizeBytes,
  fetchImpl,
  openImpl = open,
}) {
  let fileHandle = null;
  try {
    fileHandle = await openImpl(renderPath, 'r');
    for (let offset = 0; offset < videoSizeBytes; offset += chunkSizeBytes) {
      const remaining = videoSizeBytes - offset;
      const currentChunkSize = Math.min(chunkSizeBytes, remaining);
      const buffer = Buffer.alloc(currentChunkSize);
      const { bytesRead } = await fileHandle.read(buffer, 0, currentChunkSize, offset);
      const body = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      const start = offset;
      const end = offset + bytesRead - 1;
      const response = await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(bytesRead),
          'Content-Range': `bytes ${start}-${end}/${videoSizeBytes}`,
        },
        body,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new TikTokPublicationApiError(
          `TikTok upload chunk failed (${response.status}): ${text.slice(0, 600) || 'no body'}`,
          { status: response.status, body: text },
        );
      }
    }
  } finally {
    await fileHandle?.close?.();
  }
}

export async function hashFileSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function prepareTikTokDirectPost({
  publication,
  videoRow,
  target,
  runtimeEnv,
  projectRoot,
  fetchImpl,
  statImpl,
  asOf,
  persistEnvValues,
  fetchCreatorInfoImpl,
  probeDurationImpl,
  hashFileImpl,
}) {
  assertFetch(fetchImpl);
  const { token, tokenEnv } = await resolveAccessToken(target, runtimeEnv, {
    fetchImpl,
    projectRoot,
    now: new Date(asOf),
    persistEnvValues,
  });
  const renderPath = resolveTikTokRenderPath(publication, videoRow, projectRoot);
  const fileStats = await statImpl(renderPath);
  const videoSha256 = await hashFileImpl(renderPath);
  const postSettings = resolveTikTokDirectPostApproval({
    publication,
    target,
    renderPath,
    videoSizeBytes: fileStats.size,
    videoSha256,
  });
  const creatorInfo = await fetchCreatorInfoImpl(token, { fetch: fetchImpl });
  const ffmpegExecutable = resolveFfmpegExecutable(
    { executable: 'auto' },
    { environment: runtimeEnv },
  );
  const videoDurationSeconds = await probeDurationImpl({
    ffmpegExecutable,
    mediaPath: renderPath,
    cwd: projectRoot,
  });
  const capabilities = validateTikTokCreatorCapabilities({
    postSettings,
    creatorInfo,
    target,
    videoDurationSeconds,
  });
  const request = buildTikTokDirectPostInitRequest({
    postSettings,
    target,
    videoSizeBytes: fileStats.size,
  });
  return {
    capabilities,
    creatorInfo,
    fileStats,
    postSettings,
    renderPath,
    request,
    token,
    tokenEnv,
  };
}

export async function preflightTikTokVideo({
  publication,
  videoRow,
  target,
  runtimeEnv = {},
  projectRoot = process.cwd(),
  fetchImpl = globalThis.fetch,
  statImpl = stat,
  asOf = new Date().toISOString(),
  persistEnvValues,
  fetchCreatorInfoImpl = fetchTikTokCreatorInfo,
  probeDurationImpl = probeMediaDurationSeconds,
  hashFileImpl = hashFileSha256,
}) {
  const prepared = await prepareTikTokDirectPost({
    publication,
    videoRow,
    target,
    runtimeEnv,
    projectRoot,
    fetchImpl,
    statImpl,
    asOf,
    persistEnvValues,
    fetchCreatorInfoImpl,
    probeDurationImpl,
    hashFileImpl,
  });
  return {
    platform: 'tiktok_video',
    action: 'preflight',
    creatorUsername: prepared.capabilities.creatorUsername,
    creatorNickname: prepared.capabilities.creatorNickname,
    privacyOptions: prepared.capabilities.privacyOptions,
    videoDurationSeconds: prepared.capabilities.videoDurationSeconds,
    maxVideoPostDurationSeconds: prepared.capabilities.maxVideoPostDurationSeconds,
    renderPath: prepared.renderPath,
    videoSizeBytes: prepared.fileStats.size,
    request: prepared.request.body,
  };
}

export async function publishTikTokVideo({
  publication,
  videoRow,
  target,
  runtimeEnv = {},
  projectRoot = process.cwd(),
  fetchImpl = globalThis.fetch,
  statImpl = stat,
  openImpl = open,
  asOf = new Date().toISOString(),
  persistEnvValues,
  fetchCreatorInfoImpl = fetchTikTokCreatorInfo,
  probeDurationImpl = probeMediaDurationSeconds,
  hashFileImpl = hashFileSha256,
  onInitialized = null,
}) {
  const prepared = await prepareTikTokDirectPost({
    publication,
    videoRow,
    target,
    runtimeEnv,
    projectRoot,
    fetchImpl,
    statImpl,
    asOf,
    persistEnvValues,
    fetchCreatorInfoImpl,
    probeDurationImpl,
    hashFileImpl,
  });
  const {
    fileStats,
    renderPath,
    request,
    token,
    tokenEnv,
  } = prepared;

  const initResponse = await fetchImpl(request.endpoint || TIKTOK_VIDEO_INIT_ENDPOINT, {
    method: 'POST',
    headers: createTikTokHeaders(token),
    body: JSON.stringify(request.body),
  });
  const initPayload = await parseJsonResponse(initResponse);
  if (!initResponse.ok) {
    throw new TikTokPublicationApiError(
      `TikTok Direct Post init failed (${initResponse.status}): ${JSON.stringify(initPayload).slice(0, 600)}`,
      { status: initResponse.status, payload: initPayload },
    );
  }
  throwForTikTokError(initPayload, initResponse, 'TikTok Direct Post init');

  const publishId = normalizeText(initPayload.data?.publish_id);
  const uploadUrl = normalizeText(initPayload.data?.upload_url);
  if (!publishId || !uploadUrl) {
    throw new TikTokPublicationApiError('TikTok Direct Post init did not return publish_id and upload_url.', {
      payload: initPayload,
    });
  }

  if (typeof onInitialized === 'function') {
    await onInitialized({
      publishId,
      externalId: publishId,
      initializedAt: asOf,
      tokenEnv,
      renderPath,
      videoSizeBytes: fileStats.size,
    });
  }

  await uploadFileInChunks({
    uploadUrl,
    renderPath,
    videoSizeBytes: fileStats.size,
    chunkSizeBytes: request.body.source_info.chunk_size,
    fetchImpl,
    openImpl,
  });

  return {
    platform: 'tiktok_video',
    action: 'publish_upload',
    status: 'publishing',
    workflowState: 'publishing',
    publishId,
    externalId: publishId,
    uploadUrl,
    uploadedAt: asOf,
    tokenEnv,
    renderPath,
    videoSizeBytes: fileStats.size,
    request: request.body,
  };
}

export function mapTikTokPublishStatus(rawStatus) {
  const status = normalizeText(rawStatus).toUpperCase();
  if (!status) return 'publishing';
  if (status.includes('COMPLETE') || status.includes('PUBLIC')) {
    return 'published';
  }
  if (status.includes('FAIL') || status.includes('REJECT') || status.includes('ERROR')) {
    return 'failed';
  }
  return 'publishing';
}

export async function fetchTikTokPublicationStatus({
  publishId,
  target,
  runtimeEnv = {},
  fetchImpl = globalThis.fetch,
  projectRoot = process.cwd(),
  asOf = new Date().toISOString(),
  persistEnvValues,
}) {
  assertFetch(fetchImpl);
  const { token } = await resolveAccessToken(target, runtimeEnv, {
    fetchImpl,
    projectRoot,
    now: new Date(asOf),
    persistEnvValues,
  });
  const request = buildTikTokStatusFetchRequest(publishId);
  const response = await fetchImpl(request.endpoint, {
    method: 'POST',
    headers: createTikTokHeaders(token),
    body: JSON.stringify(request.body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new TikTokPublicationApiError(
      `TikTok status fetch failed (${response.status}): ${JSON.stringify(payload).slice(0, 600)}`,
      { status: response.status, payload },
    );
  }
  throwForTikTokError(payload, response, 'TikTok status fetch');

  const rawStatus = normalizeText(payload.data?.status || payload.data?.publish_status);
  return {
    platform: 'tiktok_video',
    action: 'status_fetch',
    status: mapTikTokPublishStatus(rawStatus),
    rawStatus,
    payload,
  };
}
