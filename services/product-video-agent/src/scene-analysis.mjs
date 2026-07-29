import { dirname, join } from 'node:path';
import { runLocalProcess } from './process-runner.mjs';
import { resolveInsideRoot } from './paths.mjs';
import { OutputManifestSchema } from './schemas.mjs';
import { restoreArchivedAssetWorkingCopies } from './media-cache.mjs';
import { resolveFfmpegExecutable } from './runtime-executables.mjs';
import { createSceneAwareTimeline } from './adapters/render-adapter.mjs';

function parseFrameRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new Error('FFprobe returned an invalid frame rate.');
  }
  return numerator / denominator;
}

function parseSceneBoundaries(stderr, durationSeconds) {
  return [...stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/gu)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0.25 && value < durationSeconds - 0.25)
    .filter((value, index, values) => index === 0 || value - values[index - 1] >= 0.5)
    .map((value) => Number(value.toFixed(3)));
}

export async function analyzeManifestVideoScenes(options) {
  const projectRoot = options.projectRoot || process.cwd();
  const restored = await restoreArchivedAssetWorkingCopies({
    manifest: options.manifest,
    projectRoot,
  });
  const asset = restored.assets.find((item) => item.asset_id === options.assetId);
  if (!asset) throw new Error(`Video asset ${options.assetId} was not found.`);
  if (asset.media_type !== 'video' || !asset.local_path) {
    throw new Error('Scene analysis requires a local video asset.');
  }

  const ffmpeg = resolveFfmpegExecutable(options.config || { executable: 'auto' });
  const ffprobe = options.ffprobeExecutable || join(dirname(ffmpeg), 'ffprobe');
  const runProcess = options.runProcess || runLocalProcess;
  const assetPath = resolveInsideRoot(projectRoot, asset.local_path, 'Scene-analysis asset path');
  const probe = await runProcess({
    executable: ffprobe,
    args: [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'format=duration:stream=avg_frame_rate,width,height',
      '-of', 'json',
      assetPath,
    ],
    cwd: projectRoot,
  });
  const probePayload = JSON.parse(probe.stdout);
  const videoStream = probePayload.streams?.[0];
  const durationSeconds = Number(probePayload.format?.duration);
  if (!videoStream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('FFprobe did not return valid video metadata.');
  }

  const sceneThreshold = options.sceneThreshold ?? 0.2;
  const sceneScan = await runProcess({
    executable: ffmpeg,
    args: [
      '-hide_banner',
      '-i', assetPath,
      '-vf', `select=gt(scene\\,${sceneThreshold}),showinfo`,
      '-an',
      '-f', 'null',
      '-',
    ],
    cwd: projectRoot,
  });
  const videoAnalysis = {
    analyzer: 'ffmpeg_scene_detection',
    analyzed_at: options.analyzedAt || new Date().toISOString(),
    duration_seconds: Number(durationSeconds.toFixed(3)),
    frame_rate: Number(parseFrameRate(videoStream.avg_frame_rate).toFixed(3)),
    width: videoStream.width,
    height: videoStream.height,
    scene_threshold: sceneThreshold,
    scene_boundaries_seconds: parseSceneBoundaries(sceneScan.stderr, durationSeconds),
  };

  const assets = restored.assets.map((item) => (
    item.asset_id === asset.asset_id ? { ...item, video_analysis: videoAnalysis } : item
  ));
  const assetsById = new Map(assets.map((item) => [item.asset_id, item]));
  const scriptJobsById = new Map(restored.script_jobs.map((job) => [job.script_job_id, job]));
  const renderJobs = restored.render_jobs.map((renderJob) => {
    if (!renderJob.asset_ids.includes(asset.asset_id)) return renderJob;
    const scriptJob = scriptJobsById.get(renderJob.script_job_id);
    const renderAssets = renderJob.asset_ids.map((assetId) => assetsById.get(assetId)).filter(Boolean);
    if (!scriptJob || renderAssets.length === 0) return renderJob;
    return {
      ...renderJob,
      timeline: createSceneAwareTimeline(renderAssets, scriptJob),
    };
  });

  return OutputManifestSchema.parse({
    ...restored,
    assets,
    render_jobs: renderJobs,
    media_candidates: restored.media_candidates.map((candidate) => (
      candidate.product_id === asset.product_id
        && candidate.source_url === asset.source_url
        ? { ...candidate, video_analysis: videoAnalysis }
        : candidate
    )),
    notes: [
      ...restored.notes,
      `FFmpeg detected ${videoAnalysis.scene_boundaries_seconds.length} scene boundary/boundaries for asset ${asset.asset_id}.`,
      `Replanned ${renderJobs.filter((job, index) => job !== restored.render_jobs[index]).length} render timeline(s) with the scene analysis.`,
    ],
  });
}
