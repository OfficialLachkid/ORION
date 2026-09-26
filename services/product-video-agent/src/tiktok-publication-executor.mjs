import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  TIKTOK_VIDEO_INIT_ENDPOINT,
  buildTikTokDirectPostInitRequest,
  buildTikTokStatusFetchRequest,
} from './tiktok-publication.mjs';

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

function resolveAccessToken(target = {}, runtimeEnv = {}) {
  const tokenEnv = normalizeText(
    target.tiktok?.access_token_env
      || target.tiktok?.accessTokenEnv
      || target.metadata?.access_token_env
      || '',
  );
  const token = tokenEnv ? normalizeText(runtimeEnv[tokenEnv]) : '';
  if (!token) {
    throw new TikTokPublicationAuthRequiredError(
      tokenEnv
        ? `Missing TikTok access token env value: ${tokenEnv}`
        : 'Missing TikTok access token env configuration.',
      { tokenEnv },
    );
  }
  return {
    token,
    tokenEnv,
  };
}

function resolveRenderPath(publication = {}, videoRow = {}, projectRoot = process.cwd()) {
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
}) {
  assertFetch(fetchImpl);
  const { token, tokenEnv } = resolveAccessToken(target, runtimeEnv);
  const renderPath = resolveRenderPath(publication, videoRow, projectRoot);
  const fileStats = await statImpl(renderPath);
  const request = buildTikTokDirectPostInitRequest({
    publication,
    target,
    videoSizeBytes: fileStats.size,
  });

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
}) {
  assertFetch(fetchImpl);
  const { token } = resolveAccessToken(target, runtimeEnv);
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

