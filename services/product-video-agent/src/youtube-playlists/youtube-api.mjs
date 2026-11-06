const YOUTUBE_PLAYLISTS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlists';
const YOUTUBE_PLAYLIST_ITEMS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlistItems';

async function readJsonResponse(response) {
  const bodyText = await response.text();
  let payload = {};
  try {
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    payload = {};
  }
  return { bodyText, payload };
}

function youtubeErrorReason(payload = {}) {
  return String(payload?.error?.errors?.[0]?.reason || '').trim();
}

export class YoutubePlaylistApiError extends Error {
  constructor(message, { status = 0, reason = '', bodyText = '' } = {}) {
    super(message);
    this.name = 'YoutubePlaylistApiError';
    this.status = status;
    this.reason = reason;
    this.bodyText = bodyText;
    this.code = reason === 'quotaExceeded' ? 'quota_exceeded' : 'youtube_playlist_api_error';
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500
      || ['backendError', 'internalError', 'rateLimitExceeded', 'quotaExceeded'].includes(reason);
    this.ambiguous = status === 0 || status === 408 || status >= 500;
  }
}

async function requestYoutubeJson(url, {
  accessToken,
  method = 'GET',
  body,
  fetchImpl = globalThis.fetch,
} = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new YoutubePlaylistApiError(error.message || String(error), {
      status: 0,
      reason: 'networkError',
    });
  }

  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    const reason = youtubeErrorReason(payload);
    throw new YoutubePlaylistApiError(
      `YouTube playlist request failed (${response.status}): ${bodyText || 'no body'}`,
      { status: response.status, reason, bodyText },
    );
  }
  return payload;
}

export async function createYoutubePlaylist({
  accessToken,
  title,
  description = '',
  privacy = 'public',
  fetchImpl = globalThis.fetch,
} = {}) {
  const url = new URL(YOUTUBE_PLAYLISTS_ENDPOINT);
  url.searchParams.set('part', 'snippet,status');
  url.searchParams.set('fields', 'id,snippet/title,status/privacyStatus');
  const payload = await requestYoutubeJson(url, {
    accessToken,
    method: 'POST',
    body: {
      snippet: { title, description },
      status: { privacyStatus: privacy },
    },
    fetchImpl,
  });
  return {
    playlistId: String(payload?.id || '').trim(),
    title: String(payload?.snippet?.title || title || '').trim(),
    privacy: String(payload?.status?.privacyStatus || privacy || '').trim(),
  };
}

export async function updateYoutubePlaylist({
  accessToken,
  playlistId,
  title,
  description = '',
  privacy = 'public',
  fetchImpl = globalThis.fetch,
} = {}) {
  const url = new URL(YOUTUBE_PLAYLISTS_ENDPOINT);
  url.searchParams.set('part', 'snippet,status');
  url.searchParams.set('fields', 'id,snippet/title,status/privacyStatus');
  const payload = await requestYoutubeJson(url, {
    accessToken,
    method: 'PUT',
    body: {
      id: playlistId,
      snippet: { title, description },
      status: { privacyStatus: privacy },
    },
    fetchImpl,
  });
  return {
    playlistId: String(payload?.id || playlistId || '').trim(),
    title: String(payload?.snippet?.title || title || '').trim(),
    privacy: String(payload?.status?.privacyStatus || privacy || '').trim(),
  };
}

export async function findYoutubePlaylistByTitle({
  accessToken,
  title,
  fetchImpl = globalThis.fetch,
  maxPages = 3,
} = {}) {
  const expectedTitle = String(title || '').trim();
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(YOUTUBE_PLAYLISTS_ENDPOINT);
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('fields', 'nextPageToken,items(id,snippet/title,status/privacyStatus)');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await requestYoutubeJson(url, { accessToken, fetchImpl });
    const match = (Array.isArray(payload?.items) ? payload.items : [])
      .find((item) => String(item?.snippet?.title || '').trim() === expectedTitle);
    if (match?.id) {
      return {
        found: true,
        playlistId: String(match.id).trim(),
        title: String(match.snippet?.title || expectedTitle).trim(),
        privacy: String(match.status?.privacyStatus || '').trim(),
      };
    }
    pageToken = String(payload?.nextPageToken || '').trim();
    if (!pageToken) break;
  }
  return { found: false, playlistId: '', title: expectedTitle, privacy: '' };
}

export async function findYoutubePlaylistItem({
  accessToken,
  playlistId,
  videoId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const url = new URL(YOUTUBE_PLAYLIST_ITEMS_ENDPOINT);
  url.searchParams.set('part', 'id');
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('fields', 'items/id');
  const payload = await requestYoutubeJson(url, { accessToken, fetchImpl });
  const playlistItemId = String(payload?.items?.[0]?.id || '').trim();
  return playlistItemId ? { found: true, playlistItemId } : { found: false, playlistItemId: '' };
}

export async function insertYoutubePlaylistItem({
  accessToken,
  playlistId,
  videoId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const url = new URL(YOUTUBE_PLAYLIST_ITEMS_ENDPOINT);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('fields', 'id,snippet/playlistId,snippet/resourceId/videoId');
  const payload = await requestYoutubeJson(url, {
    accessToken,
    method: 'POST',
    body: {
      snippet: {
        playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId,
        },
      },
    },
    fetchImpl,
  });
  return {
    playlistItemId: String(payload?.id || '').trim(),
    playlistId: String(payload?.snippet?.playlistId || playlistId || '').trim(),
    videoId: String(payload?.snippet?.resourceId?.videoId || videoId || '').trim(),
  };
}
