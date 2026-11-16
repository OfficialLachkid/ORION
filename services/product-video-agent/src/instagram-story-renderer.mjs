import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { hashFileSha256 } from './tiktok-publication-executor.mjs';
import { runLocalProcess } from './process-runner.mjs';
import { resolveFfmpegExecutable } from './runtime-executables.mjs';
import { resolveAvailablePublicationRender } from './publication-render-path.mjs';
import { InstagramPublicationValidationError } from './instagram-publication.mjs';

export const INSTAGRAM_STORY_WIDTH = 1080;
export const INSTAGRAM_STORY_HEIGHT = 1920;
export const INSTAGRAM_STORY_DEFAULT_DURATION_SECONDS = 8;

function normalizeText(value) {
  return String(value || '').trim();
}

function xmlEscape(value) {
  return normalizeText(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function safeSegment(value, fallback = 'story') {
  const segment = normalizeText(value)
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return segment || fallback;
}

function resolveDurationSeconds(publication = {}) {
  const configured = Number(publication.metadata?.instagram_story?.duration_seconds);
  if (!Number.isFinite(configured)) return INSTAGRAM_STORY_DEFAULT_DURATION_SECONDS;
  return Math.max(3, Math.min(Math.floor(configured), 15));
}

function buildOverlaySvg({ username }) {
  const account = xmlEscape(normalizeText(username).replace(/^@/u, '') || 'our profile');
  return Buffer.from(`
    <svg width="${INSTAGRAM_STORY_WIDTH}" height="${INSTAGRAM_STORY_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#050914" stop-opacity="0.78"/>
          <stop offset="1" stop-color="#050914" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#050914" stop-opacity="0"/>
          <stop offset="1" stop-color="#050914" stop-opacity="0.9"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="360" fill="url(#top)"/>
      <rect y="1420" width="1080" height="500" fill="url(#bottom)"/>
      <rect x="358" y="108" width="364" height="94" rx="47" fill="#121C33" fill-opacity="0.92" stroke="#3FE4FF" stroke-width="4"/>
      <text x="540" y="170" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="800" fill="#FFFFFF" letter-spacing="4">NEW VIDEO</text>
      <text x="540" y="1660" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="62" font-weight="800" fill="#FFFFFF">WATCH THE FULL VIDEO</text>
      <text x="540" y="1748" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="700" fill="#3FE4FF">@${account}</text>
    </svg>
  `);
}

function resolveSourceApproval(sourcePublication = {}) {
  const approval = sourcePublication.metadata?.instagram_reel_approval || {};
  const renderPath = normalizeText(approval.render_path || sourcePublication.metadata?.render_path);
  const sourceSha256 = normalizeText(approval.video_sha256);
  if (!renderPath || !sourceSha256) {
    throw new InstagramPublicationValidationError(
      'Instagram Story rendering requires the immutable approved Reel path and hash.',
      { code: 'instagram_story_source_approval_missing' },
    );
  }
  return { approval, renderPath, sourceSha256 };
}

export async function renderInstagramStoryVideo({
  publication,
  sourcePublication,
  target = {},
  runtimeEnv = {},
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
  runProcess = runLocalProcess,
  sharpImpl = sharp,
}) {
  const { approval, renderPath: configuredPath, sourceSha256 } = resolveSourceApproval(
    sourcePublication,
  );
  const { renderPath } = await resolveAvailablePublicationRender({
    configuredPath,
    projectRoot,
    statImpl,
  });
  const actualSourceSha256 = await hashFileImpl(renderPath);
  if (actualSourceSha256 !== sourceSha256) {
    throw new InstagramPublicationValidationError(
      'Instagram Story source video no longer matches the approved Reel hash.',
      { code: 'instagram_story_source_hash_mismatch' },
    );
  }

  const recipeVersion = normalizeText(publication.metadata?.instagram_story?.recipe_version);
  if (!recipeVersion) {
    throw new InstagramPublicationValidationError(
      'Instagram Story rendering requires a versioned recipe.',
      { code: 'instagram_story_recipe_missing' },
    );
  }
  const outputDirectory = join(dirname(renderPath), 'instagram-stories');
  const outputPath = join(
    outputDirectory,
    `${safeSegment(publication.id)}--${safeSegment(recipeVersion)}.mp4`,
  );
  await mkdir(outputDirectory, { recursive: true });

  try {
    const existing = await statImpl(outputPath);
    if (Number(existing?.size || 0) > 0) {
      return {
        outputPath,
        videoSha256: await hashFileImpl(outputPath),
        sourceVideoSha256: actualSourceSha256,
        durationSeconds: resolveDurationSeconds(publication),
        reused: true,
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const suffix = randomUUID();
  const overlayPath = join(outputDirectory, `.story-overlay-${suffix}.png`);
  const temporaryOutputPath = join(outputDirectory, `.story-render-${suffix}.mp4`);
  const username = normalizeText(
    target.instagram?.expected_username
      || target.instagram?.expectedUsername
      || approval.creator_username,
  );
  const durationSeconds = resolveDurationSeconds(publication);
  const ffmpegExecutable = resolveFfmpegExecutable(
    { executable: 'auto' },
    { environment: runtimeEnv },
  );

  try {
    await sharpImpl(buildOverlaySvg({ username })).png().toFile(overlayPath);
    await runProcess({
      executable: ffmpegExecutable,
      cwd: projectRoot,
      timeoutMs: 300_000,
      args: [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', renderPath,
        '-loop', '1', '-framerate', '30', '-i', overlayPath,
        '-filter_complex',
        '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base];[1:v]scale=1080:1920[brand];[base][brand]overlay=0:0:format=auto,format=yuv420p[v]',
        '-map', '[v]', '-map', '0:a?',
        '-t', String(durationSeconds),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        temporaryOutputPath,
      ],
    });
    await rename(temporaryOutputPath, outputPath);
  } finally {
    await Promise.all([
      rm(overlayPath, { force: true }),
      rm(temporaryOutputPath, { force: true }),
    ]);
  }

  return {
    outputPath,
    videoSha256: await hashFileImpl(outputPath),
    sourceVideoSha256: actualSourceSha256,
    durationSeconds,
    reused: false,
  };
}
