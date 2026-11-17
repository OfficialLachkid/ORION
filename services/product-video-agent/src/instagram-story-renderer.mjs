import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { hashFileSha256 } from './tiktok-publication-executor.mjs';
import { runLocalProcess } from './process-runner.mjs';
import { resolveFfmpegExecutable } from './runtime-executables.mjs';
import { resolveAvailablePublicationRender } from './publication-render-path.mjs';
import { InstagramPublicationValidationError } from './instagram-publication.mjs';
import {
  avatarImageDataUri,
  resolveInstagramStoryAvatar,
} from './instagram-story-avatar.mjs';
import {
  INSTAGRAM_STORY_LEGACY_RECIPE_VERSION,
  INSTAGRAM_STORY_VARIANT_SET_VERSION,
  buildLegacyInstagramStoryRecipe,
  buildInstagramStoryRecipe,
  resolveInstagramStoryVariant,
} from './instagram-story-recipes.mjs';

export const INSTAGRAM_STORY_WIDTH = 1080;
export const INSTAGRAM_STORY_HEIGHT = 1920;
export const INSTAGRAM_STORY_DEFAULT_DURATION_SECONDS = 8;

function normalizeText(value) {
  return String(value || '').trim();
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

function framedMaskSvg() {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1330"><rect width="850" height="1330" rx="56" fill="#fff"/></svg>');
}

function progressFilter(recipe, durationSeconds, inputLabel) {
  if (!recipe.progressBar) return `[${inputLabel}]format=yuv420p[v]`;
  return `[${inputLabel}]drawbox=x=${recipe.progressBarX}:y=${recipe.progressBarY}:w='min(${recipe.progressBarWidth},${recipe.progressBarWidth}*t/${durationSeconds})':h=${recipe.progressBarHeight}:color=${recipe.progressBarColor}:t=fill,format=yuv420p[v]`;
}

function buildFilterComplex(recipe, durationSeconds) {
  if (recipe.presentation === 'framed') {
    return [
      '[0:v]split=2[bgsrc][fgsrc]',
      '[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:5,eq=brightness=-0.32:saturation=0.72,setsar=1[bg]',
      '[fgsrc]scale=850:1330:force_original_aspect_ratio=increase,crop=850:1330,format=rgba[fg]',
      '[2:v]format=rgba,alphaextract[mask]',
      '[fg][mask]alphamerge[rounded]',
      '[bg][rounded]overlay=115:290[stage]',
      '[1:v]scale=1080:1920,format=rgba[brand]',
      '[stage][brand]overlay=0:0:format=auto[composed]',
      progressFilter(recipe, durationSeconds, 'composed'),
    ].join(';');
  }
  return [
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base]',
    '[1:v]scale=1080:1920,format=rgba[brand]',
    '[base][brand]overlay=0:0:format=auto[composed]',
    progressFilter(recipe, durationSeconds, 'composed'),
  ].join(';');
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
  resolveAvatar = resolveInstagramStoryAvatar,
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
  const persistedVariantKey = normalizeText(publication.metadata?.instagram_story?.variant_key);
  const legacyRecipe = recipeVersion === INSTAGRAM_STORY_LEGACY_RECIPE_VERSION
    && !persistedVariantKey;
  const variantKey = legacyRecipe
    ? 'legacy_v1'
    : resolveInstagramStoryVariant({ publication, sourcePublication, target });
  const outputDirectory = join(dirname(renderPath), 'instagram-stories');
  const outputPath = join(
    outputDirectory,
    legacyRecipe
      ? `${safeSegment(publication.id)}--${safeSegment(recipeVersion)}.mp4`
      : `${safeSegment(publication.id)}--${safeSegment(recipeVersion)}--${safeSegment(variantKey)}.mp4`,
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
        variantKey,
        variantSetVersion: legacyRecipe
          ? INSTAGRAM_STORY_LEGACY_RECIPE_VERSION
          : INSTAGRAM_STORY_VARIANT_SET_VERSION,
        avatarSource: legacyRecipe ? 'legacy_recipe' : 'cached_render',
        reused: true,
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const suffix = randomUUID();
  const overlayPath = join(outputDirectory, `.story-overlay-${suffix}.png`);
  const maskPath = join(outputDirectory, `.story-mask-${suffix}.png`);
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
  const avatar = legacyRecipe
    ? null
    : await resolveAvatar({ target, runtimeEnv, projectRoot });
  const recipe = legacyRecipe
    ? buildLegacyInstagramStoryRecipe({ username })
    : buildInstagramStoryRecipe({
      variantKey,
      username,
      title: publication.title || sourcePublication.title,
      avatarDataUri: avatarImageDataUri(avatar.image),
      target,
    });

  try {
    await sharpImpl(recipe.overlaySvg).png().toFile(overlayPath);
    if (recipe.presentation === 'framed') {
      await sharpImpl(framedMaskSvg()).png().toFile(maskPath);
    }
    const visualInputs = [
      '-i', renderPath,
      '-loop', '1', '-framerate', '30', '-i', overlayPath,
      ...(recipe.presentation === 'framed'
        ? ['-loop', '1', '-framerate', '30', '-i', maskPath]
        : []),
    ];
    await runProcess({
      executable: ffmpegExecutable,
      cwd: projectRoot,
      timeoutMs: 300_000,
      args: [
        '-hide_banner', '-loglevel', 'error', '-y',
        ...visualInputs,
        '-filter_complex', buildFilterComplex(recipe, durationSeconds),
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
      rm(maskPath, { force: true }),
      rm(temporaryOutputPath, { force: true }),
    ]);
  }

  return {
    outputPath,
    videoSha256: await hashFileImpl(outputPath),
    sourceVideoSha256: actualSourceSha256,
    durationSeconds,
    variantKey,
    variantSetVersion: recipe.variantSetVersion,
    avatarSource: avatar?.source || 'legacy_recipe',
    reused: false,
  };
}
