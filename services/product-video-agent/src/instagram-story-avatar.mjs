import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { InstagramPublicationValidationError } from './instagram-publication.mjs';
import { createInstagramGraphClient } from './instagram-publication-executor.mjs';

export const INSTAGRAM_STORY_AVATAR_CACHE_TTL_HOURS = 168;
const MAX_AVATAR_DOWNLOAD_BYTES = 5 * 1024 * 1024;

function normalizeText(value) {
  return String(value || '').trim();
}

function safeSegment(value, fallback = 'instagram-account') {
  const normalized = normalizeText(value)
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || fallback;
}

function resolveCacheTtlMs(runtimeEnv = {}, target = {}) {
  const configured = Number(
    target.instagram?.story?.avatar_cache_ttl_hours
      ?? target.instagram?.story?.avatarCacheTtlHours
      ?? runtimeEnv.INSTAGRAM_STORY_AVATAR_CACHE_TTL_HOURS
      ?? INSTAGRAM_STORY_AVATAR_CACHE_TTL_HOURS,
  );
  const hours = Number.isFinite(configured)
    ? Math.max(1, Math.min(Math.floor(configured), 24 * 30))
    : INSTAGRAM_STORY_AVATAR_CACHE_TTL_HOURS;
  return hours * 60 * 60 * 1000;
}

function resolveIdentity(target = {}) {
  const accountKey = normalizeText(target.account_key || target.accountKey);
  const instagramUserId = normalizeText(target.instagram?.user_id || target.instagram?.userId);
  const expectedUsername = normalizeText(
    target.instagram?.expected_username || target.instagram?.expectedUsername,
  ).replace(/^@/u, '').toLowerCase();
  const accessTokenEnv = normalizeText(
    target.instagram?.access_token_env || target.instagram?.accessTokenEnv,
  );
  if (!accountKey || !instagramUserId || !expectedUsername || !accessTokenEnv) {
    throw new InstagramPublicationValidationError(
      'Instagram Story avatar resolution requires the configured account identity.',
      { code: 'instagram_story_avatar_identity_missing' },
    );
  }
  return { accountKey, instagramUserId, expectedUsername, accessTokenEnv };
}

function avatarCachePath({ projectRoot, runtimeEnv, identity }) {
  const cacheDir = normalizeText(runtimeEnv.INSTAGRAM_STORY_AVATAR_CACHE_DIR)
    || join(projectRoot, 'data', 'runtime', 'instagram-story-avatars');
  const filename = `${safeSegment(identity.accountKey)}--${safeSegment(identity.instagramUserId)}.png`;
  return { cacheDir, cachePath: join(cacheDir, filename) };
}

async function readCache(cachePath, { statImpl, readFileImpl }) {
  try {
    const fileStats = await statImpl(cachePath);
    if (Number(fileStats?.size || 0) <= 0) return null;
    return {
      image: await readFileImpl(cachePath),
      modifiedAtMs: Number(fileStats.mtimeMs || 0),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function fallbackAvatarSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1756B8"/><stop offset="1" stop-color="#071B3A"/></linearGradient></defs>
    <circle cx="96" cy="96" r="96" fill="url(#g)"/>
    <circle cx="96" cy="70" r="34" fill="#FFFFFF" fill-opacity="0.88"/>
    <path d="M35 168c8-40 31-61 61-61s53 21 61 61" fill="#FFFFFF" fill-opacity="0.88"/>
  </svg>`);
}

async function normalizeAvatar(image, sharpImpl) {
  return sharpImpl(image).resize(192, 192, { fit: 'cover' }).png().toBuffer();
}

async function downloadProfileImage(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Instagram profile image download failed (${response.status}).`);
  }
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_AVATAR_DOWNLOAD_BYTES) {
    throw new Error('Instagram profile image exceeds the avatar download limit.');
  }
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length === 0 || image.length > MAX_AVATAR_DOWNLOAD_BYTES) {
    throw new Error('Instagram profile image is empty or exceeds the avatar download limit.');
  }
  return image;
}

export async function resolveInstagramStoryAvatar({
  target = {},
  runtimeEnv = {},
  projectRoot = process.cwd(),
  asOfMs = Date.now(),
  graphClient = null,
  fetchImpl = globalThis.fetch,
  sharpImpl = sharp,
  mkdirImpl = mkdir,
  readFileImpl = readFile,
  renameImpl = rename,
  statImpl = stat,
  writeFileImpl = writeFile,
} = {}) {
  const identity = resolveIdentity(target);
  const { cacheDir, cachePath } = avatarCachePath({ projectRoot, runtimeEnv, identity });
  const cached = await readCache(cachePath, { statImpl, readFileImpl });
  const cacheAgeMs = cached ? Math.max(0, asOfMs - cached.modifiedAtMs) : Number.POSITIVE_INFINITY;
  if (cached && cacheAgeMs <= resolveCacheTtlMs(runtimeEnv, target)) {
    return { ...identity, image: cached.image, cachePath, source: 'cache', stale: false };
  }

  try {
    if (typeof fetchImpl !== 'function') throw new Error('Instagram avatar lookup requires fetch support.');
    const client = graphClient || createInstagramGraphClient(runtimeEnv, target);
    const profile = await client.request('me', {
      query: { fields: 'id,user_id,username,account_type,profile_picture_url' },
    });
    const returnedUserId = normalizeText(profile.user_id);
    const returnedUsername = normalizeText(profile.username).replace(/^@/u, '').toLowerCase();
    if (returnedUserId !== identity.instagramUserId || returnedUsername !== identity.expectedUsername) {
      throw new InstagramPublicationValidationError(
        'Instagram Story avatar identity does not match the configured account.',
        { code: 'instagram_story_avatar_identity_mismatch' },
      );
    }
    const profilePictureUrl = normalizeText(profile.profile_picture_url);
    if (!profilePictureUrl) throw new Error('Instagram did not return profile_picture_url.');
    const image = await normalizeAvatar(
      await downloadProfileImage(profilePictureUrl, fetchImpl),
      sharpImpl,
    );
    await mkdirImpl(cacheDir, { recursive: true });
    const temporaryPath = `${cachePath}.tmp-${process.pid}-${asOfMs}`;
    await writeFileImpl(temporaryPath, image);
    await renameImpl(temporaryPath, cachePath);
    return { ...identity, image, cachePath, source: 'instagram_graph', stale: false };
  } catch (error) {
    if (cached) {
      return {
        ...identity,
        image: cached.image,
        cachePath,
        source: 'stale_cache',
        stale: true,
        refreshError: error.message,
      };
    }
    return {
      ...identity,
      image: await normalizeAvatar(fallbackAvatarSvg(), sharpImpl),
      cachePath,
      source: 'generic_fallback',
      stale: false,
      refreshError: error.message,
    };
  }
}

export function avatarImageDataUri(image) {
  return `data:image/png;base64,${Buffer.from(image).toString('base64')}`;
}
