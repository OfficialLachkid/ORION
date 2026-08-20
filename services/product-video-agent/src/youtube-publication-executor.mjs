import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildYoutubeCommentInsertPlan,
  buildYoutubePreviewUploadPlan,
  buildYoutubeScheduleUpdatePlan,
} from './youtube-publication.mjs';
import { extractYoutubeOAuthClientCredentials, refreshYoutubeAccessToken } from './youtube-oauth.mjs';

const YOUTUBE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos';
const YOUTUBE_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_COMMENT_THREADS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/commentThreads';
const YOUTUBE_VIDEO_STATUS_BATCH_SIZE = 25;

async function readJsonResponse(response) {
  const bodyText = await response.text();
  let payload = {};
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = {};
    }
  }
  return { bodyText, payload };
}

function buildShortsUrl(videoId) {
  return `https://youtube.com/shorts/${videoId}`;
}

function normalizeYoutubeVideoStatus(videoId, item = null, payload = {}) {
  if (!item?.id) {
    return {
      externalId: videoId,
      found: false,
      privacyStatus: '',
      publishAt: null,
      publishedAt: null,
      title: '',
      publicUrl: buildShortsUrl(videoId),
      payload,
    };
  }

  return {
    externalId: videoId,
    found: true,
    privacyStatus: String(item.status?.privacyStatus || '').trim().toLowerCase(),
    publishAt: item.status?.publishAt || null,
    publishedAt: item.snippet?.publishedAt || null,
    title: String(item.snippet?.title || '').trim(),
    publicUrl: buildShortsUrl(videoId),
    payload,
  };
}

function chunkValues(values = [], size = YOUTUBE_VIDEO_STATUS_BATCH_SIZE) {
  const normalizedSize = Number(size);
  const chunkSize = Number.isFinite(normalizedSize) && normalizedSize > 0
    ? Math.floor(normalizedSize)
    : YOUTUBE_VIDEO_STATUS_BATCH_SIZE;
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function resolveVideoMimeType(filePath) {
  if (String(filePath || '').toLowerCase().endsWith('.mov')) return 'video/quicktime';
  if (String(filePath || '').toLowerCase().endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

function buildMultipartUploadBody(boundary, metadataBody, fileBuffer, mimeType) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadataBody)}\r\n`, 'utf8'),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`, 'utf8'),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
}

export async function loadYoutubeClientCredentials(secretPath, projectRoot) {
  const absolutePath = resolve(projectRoot, secretPath);
  const payload = JSON.parse(await readFile(absolutePath, 'utf8'));
  return {
    absolutePath,
    ...extractYoutubeOAuthClientCredentials(payload),
  };
}

export function resolvePublicationRenderPath(publication, videoRow) {
  const candidates = [
    publication?.metadata?.render_path,
    videoRow?.render?.output_path,
    videoRow?.render?.render_path,
    videoRow?.render?.selected_output_path,
    videoRow?.render?.jobs?.[0]?.output_path,
  ];
  const resolved = candidates.find((value) => String(value || '').trim());
  if (!resolved) {
    throw new Error(`Could not resolve a local render path for publication ${publication?.id || '(unknown)'}.`);
  }
  return String(resolved);
}

export async function uploadYoutubePreviewVideo({
  publication,
  videoRow,
  channelProfile,
  clientConfig,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  const renderPath = resolvePublicationRenderPath(publication, videoRow);
  const fileBuffer = await readFile(renderPath);
  const accessToken = await refreshYoutubeAccessToken(clientConfig, refreshToken, { fetch: fetchImpl });
  const requestPlan = buildYoutubePreviewUploadPlan(publication, channelProfile);
  const boundary = `orion-youtube-${Date.now().toString(16)}`;
  const mimeType = resolveVideoMimeType(renderPath);
  const body = buildMultipartUploadBody(boundary, requestPlan.body, fileBuffer, mimeType);
  const uploadUrl = new URL(YOUTUBE_UPLOAD_ENDPOINT);
  uploadUrl.searchParams.set('uploadType', 'multipart');
  uploadUrl.searchParams.set('part', requestPlan.part.join(','));

  const response = await fetchImpl(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken.accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      Accept: 'application/json',
    },
    body,
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube preview upload failed (${response.status}): ${bodyText || 'no body'}`);
  }
  if (!payload?.id) {
    throw new Error('YouTube preview upload succeeded but returned no video id.');
  }

  return {
    externalId: payload.id,
    previewUrl: buildShortsUrl(payload.id),
    uploadedAt: new Date().toISOString(),
    payload,
    renderPath,
  };
}

export async function scheduleYoutubePublication({
  publication,
  scheduledFor,
  clientConfig,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  const accessToken = await refreshYoutubeAccessToken(clientConfig, refreshToken, { fetch: fetchImpl });
  const requestPlan = buildYoutubeScheduleUpdatePlan(publication, scheduledFor);
  const response = await fetchImpl(`${YOUTUBE_VIDEOS_ENDPOINT}?part=${requestPlan.part.join(',')}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestPlan.body),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube schedule update failed (${response.status}): ${bodyText || 'no body'}`);
  }

  return {
    externalId: publication.external_id,
    scheduledFor: new Date(scheduledFor).toISOString(),
    payload,
  };
}

export async function fetchYoutubeVideoStatus({
  externalId,
  clientConfig,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  const videoId = String(externalId || '').trim();
  if (!videoId) {
    throw new Error('YouTube status lookup requires a video id.');
  }

  const accessToken = await refreshYoutubeAccessToken(clientConfig, refreshToken, { fetch: fetchImpl });
  const url = new URL(YOUTUBE_VIDEOS_ENDPOINT);
  url.searchParams.set('part', 'status,snippet');
  url.searchParams.set('id', videoId);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken.accessToken}`,
      Accept: 'application/json',
    },
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube status lookup failed (${response.status}): ${bodyText || 'no body'}`);
  }

  const item = Array.isArray(payload?.items) ? payload.items[0] : null;
  return normalizeYoutubeVideoStatus(videoId, item, payload);
}

export async function fetchYoutubeVideoStatuses({
  externalIds,
  clientConfig,
  refreshToken,
  fetchImpl = globalThis.fetch,
  batchSize = YOUTUBE_VIDEO_STATUS_BATCH_SIZE,
}) {
  const ids = [...new Set(
    (Array.isArray(externalIds) ? externalIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  if (ids.length === 0) {
    return [];
  }

  const accessToken = await refreshYoutubeAccessToken(clientConfig, refreshToken, { fetch: fetchImpl });
  const results = [];

  for (const batchIds of chunkValues(ids, batchSize)) {
    const url = new URL(YOUTUBE_VIDEOS_ENDPOINT);
    url.searchParams.set('part', 'status,snippet');
    url.searchParams.set('id', batchIds.join(','));
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken.accessToken}`,
        Accept: 'application/json',
      },
    });
    const { bodyText, payload } = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`YouTube status lookup failed (${response.status}): ${bodyText || 'no body'}`);
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const itemsById = new Map(items.map((item) => [String(item?.id || '').trim(), item]));
    for (const videoId of batchIds) {
      results.push(normalizeYoutubeVideoStatus(videoId, itemsById.get(videoId) || null, payload));
    }
  }

  return results;
}

export async function deleteYoutubeVideo({
  externalId,
  clientConfig,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  const videoId = String(externalId || '').trim();
  if (!videoId) {
    throw new Error('YouTube delete requires a video id.');
  }

  const accessToken = await refreshYoutubeAccessToken(clientConfig, refreshToken, { fetch: fetchImpl });
  const response = await fetchImpl(`${YOUTUBE_VIDEOS_ENDPOINT}?id=${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken.accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const { bodyText } = await readJsonResponse(response);
    throw new Error(`YouTube delete failed (${response.status}): ${bodyText || 'no body'}`);
  }

  return {
    externalId: videoId,
    deletedAt: new Date().toISOString(),
  };
}

export class YoutubeCommentPostError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'YoutubeCommentPostError';
    this.status = Number(options.status || 0);
    this.reason = String(options.reason || '').trim();
    this.bodyText = String(options.bodyText || '').trim();
    this.payload = options.payload || {};
  }
}

function extractYoutubeErrorReason(payload = {}) {
  const nestedReason = payload?.error?.errors?.[0]?.reason;
  if (nestedReason) {
    return String(nestedReason).trim();
  }
  return String(payload?.error?.status || '').trim();
}

export async function postYoutubeTopLevelComment({
  externalId,
  textOriginal,
  clientConfig,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  const videoId = String(externalId || '').trim();
  if (!videoId) {
    throw new Error('YouTube comment post requires a video id.');
  }

  const commentText = String(textOriginal || '').trim();
  if (!commentText) {
    throw new Error('YouTube comment post requires comment text.');
  }

  const accessToken = await refreshYoutubeAccessToken(clientConfig, refreshToken, { fetch: fetchImpl });
  const requestPlan = buildYoutubeCommentInsertPlan(videoId, commentText);
  const response = await fetchImpl(`${YOUTUBE_COMMENT_THREADS_ENDPOINT}?part=${requestPlan.part.join(',')}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestPlan.body),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new YoutubeCommentPostError(
      `YouTube comment post failed (${response.status}): ${bodyText || 'no body'}`,
      {
        status: response.status,
        reason: extractYoutubeErrorReason(payload),
        bodyText,
        payload,
      },
    );
  }

  const commentId = String(payload?.id || '').trim()
    || String(payload?.snippet?.topLevelComment?.id || '').trim();
  if (!commentId) {
    throw new YoutubeCommentPostError('YouTube comment post succeeded but returned no comment id.', {
      status: response.status,
      reason: 'missing_comment_id',
      bodyText,
      payload,
    });
  }

  return {
    externalId: videoId,
    commentId,
    postedAt: new Date().toISOString(),
    payload,
  };
}
