import { createStableId } from '../ids.mjs';
import { RenderJobSchema } from '../schemas.mjs';
import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveInsideRoot } from '../paths.mjs';
import { runLocalProcess } from '../process-runner.mjs';
import { resolveFfmpegExecutable } from '../runtime-executables.mjs';

const TIMELINE_ROLES = ['hook', 'demonstration', 'b_roll', 'detail'];
const DEFAULT_FADE_SECONDS = 0.35;
const TARGET_VIDEO_SHOTS = 4;

function splitVideoIntoShots(asset) {
  const analysis = asset.video_analysis;
  if (asset.media_type !== 'video' || !analysis) {
    return [{ asset, sourceStart: 0, maxDuration: Number.POSITIVE_INFINITY }];
  }
  const availableStarts = [
    0,
    ...analysis.scene_boundaries_seconds,
  ].filter((value, index, values) => index === 0 || value > values[index - 1]);
  const selectedStarts = availableStarts.length <= TARGET_VIDEO_SHOTS
    ? availableStarts
    : Array.from({ length: TARGET_VIDEO_SHOTS }, (_, index) => {
        const target = (analysis.duration_seconds * index) / TARGET_VIDEO_SHOTS;
        return availableStarts.reduce((selected, candidate) => (
          Math.abs(candidate - target) < Math.abs(selected - target) ? candidate : selected
        ), availableStarts[0]);
      }).filter((value, index, values) => index === 0 || value > values[index - 1]);
  const boundaries = [...selectedStarts, analysis.duration_seconds];
  const shots = selectedStarts.map((start, index) => ({
    asset,
    sourceStart: start,
    maxDuration: boundaries[index + 1] - start,
  })).filter((shot) => shot.maxDuration >= 0.5);

  while (shots.length < TARGET_VIDEO_SHOTS) {
    const longestIndex = shots.reduce((selected, shot, index) => (
      shot.maxDuration > shots[selected].maxDuration ? index : selected
    ), 0);
    const longest = shots[longestIndex];
    if (longest.maxDuration < 4) break;
    const halfDuration = longest.maxDuration / 2;
    shots.splice(
      longestIndex,
      1,
      { ...longest, maxDuration: halfDuration },
      {
        ...longest,
        sourceStart: longest.sourceStart + halfDuration,
        maxDuration: halfDuration,
      },
    );
  }
  return shots;
}

function allocateDurations(shots, outputDuration) {
  const overlapDuration = Math.max(0, shots.length - 1) * DEFAULT_FADE_SECONDS;
  let remaining = outputDuration + overlapDuration;
  const durations = Array(shots.length).fill(0);
  let active = shots.map((_, index) => index);

  while (active.length > 0) {
    const share = remaining / active.length;
    const capped = active.filter((index) => shots[index].maxDuration < share);
    if (capped.length === 0) {
      for (const index of active) durations[index] = share;
      remaining = 0;
      break;
    }
    for (const index of capped) {
      durations[index] = shots[index].maxDuration;
      remaining -= durations[index];
    }
    active = active.filter((index) => !capped.includes(index));
  }
  if (remaining > 0.01) {
    throw new Error('Approved video scenes are too short for the target narration duration.');
  }
  return durations;
}

export function createSceneAwareTimeline(assets, scriptJob) {
  const shots = assets.flatMap((asset) => splitVideoIntoShots(asset));
  const durations = allocateDurations(shots, scriptJob.target_duration_seconds);

  return shots.map((shot, sequenceIndex) => {
    const isLast = sequenceIndex === shots.length - 1;
    return {
      clip_id: createStableId('render-clip', {
        scriptJobId: scriptJob.script_job_id,
        assetId: shot.asset.asset_id,
        sequenceIndex,
        sourceStart: shot.sourceStart,
      }),
      asset_id: shot.asset.asset_id,
      sequence_index: sequenceIndex,
      role: isLast ? 'payoff' : TIMELINE_ROLES[sequenceIndex % TIMELINE_ROLES.length],
      media_type: shot.asset.media_type,
      source_start_seconds: Number(shot.sourceStart.toFixed(3)),
      duration_seconds: Number(durations[sequenceIndex].toFixed(3)),
      fit: 'cover',
      transition_after: isLast ? 'cut' : 'fade',
      transition_duration_seconds: isLast ? 0 : DEFAULT_FADE_SECONDS,
    };
  });
}

export function retimeTimelineClips(timeline, assets, outputDuration) {
  const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const ordered = [...timeline].sort((left, right) => left.sequence_index - right.sequence_index);
  const shots = ordered.map((clip, index) => {
    const asset = assetsById.get(clip.asset_id);
    if (clip.media_type === 'image' || !asset?.video_analysis) {
      return { maxDuration: Number.POSITIVE_INFINITY };
    }
    const nextStart = ordered.slice(index + 1).find((candidate) => (
      candidate.asset_id === clip.asset_id
      && candidate.source_start_seconds > clip.source_start_seconds
    ))?.source_start_seconds;
    return {
      maxDuration: (nextStart || asset.video_analysis.duration_seconds)
        - clip.source_start_seconds,
    };
  });
  const durations = allocateDurations(shots, outputDuration);
  return ordered.map((clip, index) => ({
    ...clip,
    duration_seconds: Number(durations[index].toFixed(3)),
  }));
}

export class LocalFfmpegRenderPlanner {
  constructor(config) {
    this.config = config;
    this.name = 'ffmpeg';
  }

  createJob({ product, scriptJob, voiceJob, captionJob, assetGates, runAt }) {
    const executable = resolveFfmpegExecutable(this.config);
    const renderPurpose = this.config.purpose || 'publication_candidate';
    const jobId = createStableId('render', {
      editorVersion: 'scene-aware-v1',
      scriptJobId: scriptJob.script_job_id,
      voiceOverJobId: voiceJob.voice_over_job_id,
      captionJobId: captionJob.caption_job_id,
      templateId: this.config.template_id,
      renderPurpose,
      fps: this.config.fps,
    });
    const outputPath = `data/runtime/product-video-agent/renders/${jobId}.mp4`;
    const blockers = [
      'approved_script_variant_missing',
      'voice_over_not_complete',
      'captions_not_complete',
      'render_approval_pending',
      'local_render_execution_not_enabled',
    ];
    const eligibleVisualAssets = assetGates.eligible.filter((asset) => (
      asset.media_type === 'image' || asset.media_type === 'video'
    ));
    const nonVisualAssetIds = assetGates.eligible
      .filter((asset) => asset.media_type !== 'image' && asset.media_type !== 'video')
      .map((asset) => asset.asset_id);
    if (eligibleVisualAssets.length === 0) {
      blockers.push(renderPurpose === 'internal_editor_test'
        ? 'no_approved_internal_test_assets'
        : 'no_rights_verified_local_assets');
    }
    const timeline = createSceneAwareTimeline(eligibleVisualAssets, scriptJob);

    return RenderJobSchema.parse({
      render_job_id: jobId,
      product_id: product.product_id,
      script_job_id: scriptJob.script_job_id,
      voice_over_job_id: voiceJob.voice_over_job_id,
      caption_job_id: captionJob.caption_job_id,
      renderer: this.name,
      render_purpose: renderPurpose,
      publication_eligible: renderPurpose === 'publication_candidate',
      watermark_required: renderPurpose === 'internal_editor_test',
      template_id: this.config.template_id,
      aspect_ratio: '9:16',
      width: 1080,
      height: 1920,
      fps: this.config.fps,
      platform_targets: this.config.platform_targets,
      asset_ids: eligibleVisualAssets.map((asset) => asset.asset_id),
      excluded_asset_ids: [
        ...assetGates.blocked.map(({ asset }) => asset.asset_id),
        ...nonVisualAssetIds,
      ],
      timeline,
      output_path: outputPath,
      status: 'blocked',
      blockers,
      estimated_cost: 0,
      execution_plan: {
        executable,
        args: [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          '<approved-asset-list>',
          '-i',
          voiceJob.output_path,
          '-vf',
          'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass=<approved-word-timed-captions>',
          '-r',
          String(this.config.fps),
          '-c:v',
          'libx264',
          '-c:a',
          'aac',
          outputPath,
        ],
        execute: false,
      },
      created_at: runAt,
    });
  }
}

function escapeFfmpegFilterPath(filePath) {
  return filePath
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
}

function orderedTimeline(job) {
  return [...job.timeline].sort((left, right) => left.sequence_index - right.sequence_index);
}

function resolveTimelineAssets(job, assets) {
  if (job.timeline.length === 0) {
    throw new Error('FFmpeg rendering requires at least one approved timeline clip.');
  }
  const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  return orderedTimeline(job).map((clip) => {
    const asset = assetsById.get(clip.asset_id);
    if (!asset) {
      throw new Error(`Render timeline asset ${clip.asset_id} is unavailable.`);
    }
    if (asset.media_type !== clip.media_type) {
      throw new Error(`Render timeline media type does not match asset ${clip.asset_id}.`);
    }
    return { clip, asset };
  });
}

function buildVisualInputs(timelineAssets, job, projectRoot) {
  return timelineAssets.flatMap(({ clip, asset }) => {
    const assetPath = resolveInsideRoot(projectRoot, asset.local_path, 'Render asset path');
    if (asset.media_type === 'image') {
      return ['-loop', '1', '-framerate', String(job.fps), '-t', String(clip.duration_seconds), '-i', assetPath];
    }
    return [
      '-ss', String(clip.source_start_seconds),
      '-t', String(clip.duration_seconds),
      '-i', assetPath,
    ];
  });
}

function buildTimelineFilter(timelineAssets, job) {
  const filters = timelineAssets.map(({ clip }, index) => (
    `[${index}:v]scale=${job.width}:${job.height}:force_original_aspect_ratio=increase,`
    + `crop=${job.width}:${job.height},fps=${job.fps},setsar=1,settb=AVTB,`
    + `trim=duration=${clip.duration_seconds},setpts=PTS-STARTPTS[v${index}]`
  ));
  let outputLabel = 'v0';
  let outputDuration = timelineAssets[0].clip.duration_seconds;

  for (let index = 1; index < timelineAssets.length; index += 1) {
    const previousClip = timelineAssets[index - 1].clip;
    const transitionDuration = previousClip.transition_after === 'fade'
      ? previousClip.transition_duration_seconds
      : 0.001;
    const offset = Math.max(0, outputDuration - transitionDuration);
    filters.push(
      `[${outputLabel}][v${index}]xfade=transition=fade:duration=${transitionDuration}`
      + `:offset=${Number(offset.toFixed(3))}[vx${index}]`,
    );
    outputLabel = `vx${index}`;
    outputDuration += timelineAssets[index].clip.duration_seconds - transitionDuration;
  }
  return { filters, outputLabel };
}

export function compileVerticalFfmpegArgs({
  job,
  assets,
  asset,
  voiceJob,
  captionJob,
  projectRoot,
}) {
  const timelineAssets = resolveTimelineAssets(job, assets || [asset]);
  const voicePath = resolveInsideRoot(projectRoot, voiceJob.output_path, 'Render voice path');
  const captionPath = resolveInsideRoot(projectRoot, captionJob.ass_output_path, 'Render caption path');
  const outputPath = resolveInsideRoot(projectRoot, job.output_path, 'Render output path');
  const visualInputs = buildVisualInputs(timelineAssets, job, projectRoot);
  const { filters, outputLabel } = buildTimelineFilter(timelineAssets, job);
  const finishingFilters = [
    `ass=filename='${escapeFfmpegFilterPath(captionPath)}'`,
    ...(job.watermark_required ? [
      "drawtext=text='INTERNAL TEST - DO NOT PUBLISH':fontcolor=white:fontsize=38:box=1:boxcolor=black@0.78:boxborderw=14:x=(w-text_w)/2:y=48",
    ] : []),
  ].join(',');
  filters.push(`[${outputLabel}]${finishingFilters}[vout]`);
  const audioInputIndex = timelineAssets.length;

  return [
    '-y',
    ...visualInputs,
    '-i',
    voicePath,
    '-map',
    '[vout]',
    '-map',
    `${audioInputIndex}:a:0`,
    '-filter_complex',
    filters.join(';'),
    '-r',
    String(job.fps),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export async function executeApprovedRender(jobInput, options) {
  const job = RenderJobSchema.parse(jobInput);
  const assets = options.assets || [options.asset];
  const { voiceJob, captionJob } = options;
  const timelineAssets = resolveTimelineAssets(job, assets);
  for (const { asset } of timelineAssets) {
    const publicationAssetApproved = job.render_purpose === 'publication_candidate'
      && job.publication_eligible
      && asset.usage_scope === 'publication'
      && asset.rights_status === 'verified'
      && asset.approval_status === 'approved';
    const internalAssetApproved = job.render_purpose === 'internal_editor_test'
      && !job.publication_eligible
      && job.watermark_required
      && asset.usage_scope === 'internal_editor_test'
      && asset.approval_status === 'approved'
      && [
        'manual_upload',
        'permitted_browser',
        'fixture',
      ].includes(asset.retrieval_method);
    if (!publicationAssetApproved && !internalAssetApproved) {
      throw new Error('FFmpeg rendering requires every timeline asset to be approved for the render purpose.');
    }
  }
  if (voiceJob.status !== 'complete') {
    throw new Error('FFmpeg rendering requires a completed voice-over.');
  }
  if (captionJob.status !== 'complete') {
    throw new Error('FFmpeg rendering requires completed word-timed captions.');
  }

  const projectRoot = options.projectRoot || process.cwd();
  const outputPath = resolveInsideRoot(projectRoot, job.output_path, 'Render output path');
  await mkdir(dirname(outputPath), { recursive: true });
  const args = compileVerticalFfmpegArgs({ job, assets, voiceJob, captionJob, projectRoot });
  const runProcess = options.runProcess || runLocalProcess;
  const executable = options.ffmpegExecutable || job.execution_plan.executable;
  await runProcess({ executable, args, cwd: projectRoot });
  if (options.verifyOutput !== false) {
    await access(outputPath);
  }

  return RenderJobSchema.parse({ ...job, status: 'complete', blockers: [] });
}
