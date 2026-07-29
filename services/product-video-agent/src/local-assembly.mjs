import { evaluateAssetGates, evaluateInternalEditorTestAssetGates } from './compliance.mjs';
import { OutputManifestSchema, RenderJobSchema, WorkflowApprovalSchema } from './schemas.mjs';
import { executeApprovedVoiceOver } from './adapters/tts-adapter.mjs';
import { executeCaptionTiming } from './adapters/caption-adapter.mjs';
import {
  executeApprovedRender,
  retimeTimelineClips,
} from './adapters/render-adapter.mjs';
import { archiveVerifiedMedia } from './archive-manager.mjs';
import { withLocalMediaJobLock } from './media-job-lock.mjs';
import { resolveInsideRoot } from './paths.mjs';
import { resolveFfmpegExecutable } from './runtime-executables.mjs';
import { restoreArchivedAssetWorkingCopies } from './media-cache.mjs';

function archiveSlug(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80);
}

function requireApproval(manifest, stage, subjectId) {
  const approval = manifest.workflow_approvals.find((item) => (
    item.stage === stage && item.subject_id === subjectId
  ));
  if (!approval || approval.state !== 'approved') {
    throw new Error(`${stage} approval is required for ${subjectId}.`);
  }
  return approval;
}

function replaceById(items, idKey, replacement) {
  return items.map((item) => item[idKey] === replacement[idKey] ? replacement : item);
}

function findAssemblyBundle(manifest, scriptVariantId) {
  const scriptVariant = manifest.script_variants.find((item) => (
    item.script_variant_id === scriptVariantId
  ));
  if (!scriptVariant) {
    throw new Error(`Script variant ${scriptVariantId} was not found.`);
  }
  const voiceJob = manifest.voice_over_jobs.find((item) => (
    item.script_variant_id === scriptVariant.script_variant_id
  ));
  const captionJob = manifest.caption_jobs.find((item) => (
    item.voice_over_job_id === voiceJob?.voice_over_job_id
  ));
  const renderJob = manifest.render_jobs.find((item) => (
    item.voice_over_job_id === voiceJob?.voice_over_job_id
  ));
  if (!voiceJob || !captionJob || !renderJob) {
    throw new Error('Voice, caption, and render jobs are required for local assembly.');
  }
  return { scriptVariant, voiceJob, captionJob, renderJob };
}

async function findApprovedAssets(manifest, renderJob, projectRoot) {
  const assetGates = renderJob.render_purpose === 'internal_editor_test'
    ? await evaluateInternalEditorTestAssetGates(manifest.assets, projectRoot)
    : await evaluateAssetGates(manifest.assets, projectRoot);
  const eligibleById = new Map(assetGates.eligible.map((asset) => [asset.asset_id, asset]));
  const timelineAssetIds = [...new Set(
    [...renderJob.timeline]
      .sort((left, right) => left.sequence_index - right.sequence_index)
      .map((clip) => clip.asset_id),
  )];
  if (timelineAssetIds.length === 0) {
    throw new Error('At least one approved visual timeline clip is required for local assembly.');
  }
  const assets = timelineAssetIds.map((assetId) => eligibleById.get(assetId));
  if (assets.some((asset) => !asset)) {
    throw new Error(renderJob.render_purpose === 'internal_editor_test'
      ? 'Every internal editor-test timeline asset must be approved, local, and hash-verified.'
      : 'Every render timeline asset must have verified usage rights and a matching local hash.');
  }
  for (const asset of assets) {
    requireApproval(manifest, 'asset', asset.asset_id);
  }
  return assets;
}

async function executeApprovedNarrationUnlocked(options) {
  const projectRoot = options.projectRoot || process.cwd();
  const sourceManifest = await restoreArchivedAssetWorkingCopies({
    manifest: options.manifest,
    projectRoot,
  });
  const bundle = findAssemblyBundle(sourceManifest, options.scriptVariantId);
  requireApproval(sourceManifest, 'script', bundle.scriptVariant.script_variant_id);
  if (bundle.scriptVariant.status !== 'approved' || bundle.scriptVariant.approval_status !== 'approved') {
    throw new Error('The selected script variant is not approved in the manifest.');
  }
  await findApprovedAssets(sourceManifest, bundle.renderJob, projectRoot);

  const completedVoiceJob = await executeApprovedVoiceOver(bundle.voiceJob, bundle.scriptVariant, {
    projectRoot,
    runProcess: options.runProcess,
    verifyOutput: options.verifyOutput,
  });
  const completedCaptionJob = await executeCaptionTiming(bundle.captionJob, {
    projectRoot,
    runProcess: options.runProcess,
    maxWordsPerLine: options.maxWordsPerLine,
    expectedText: bundle.scriptVariant.spoken_text,
    writeCaptionArtifacts: options.writeCaptionArtifacts,
  });
  const preparedRenderJob = RenderJobSchema.parse({
    ...bundle.renderJob,
    timeline: retimeTimelineClips(
      bundle.renderJob.timeline,
      sourceManifest.assets,
      completedCaptionJob.duration_seconds + 0.8,
    ),
    blockers: ['render_approval_pending'],
  });
  const workflowApprovals = sourceManifest.workflow_approvals.map((approval) => {
    if (approval.stage !== 'render' || approval.subject_id !== bundle.renderJob.render_job_id) {
      return approval;
    }
    return WorkflowApprovalSchema.parse({
      ...approval,
      state: 'pending',
      blocking_reasons: [],
    });
  });

  return OutputManifestSchema.parse({
    ...sourceManifest,
    mode: 'local_narration',
    voice_over_jobs: replaceById(sourceManifest.voice_over_jobs, 'voice_over_job_id', completedVoiceJob),
    caption_jobs: replaceById(sourceManifest.caption_jobs, 'caption_job_id', completedCaptionJob),
    render_jobs: replaceById(sourceManifest.render_jobs, 'render_job_id', preparedRenderJob),
    workflow_approvals: workflowApprovals,
    external_calls: {
      ...sourceManifest.external_calls,
      local_tts: 'local_executed',
      local_caption: 'local_executed',
    },
    notes: [
      ...sourceManifest.notes,
      'Approved narration and word-timed captions completed locally; render approval is now pending.',
    ],
  });
}

async function executeApprovedLocalRenderUnlocked(options) {
  const projectRoot = options.projectRoot || process.cwd();
  const sourceManifest = await restoreArchivedAssetWorkingCopies({
    manifest: options.manifest,
    projectRoot,
  });
  const bundle = findAssemblyBundle(sourceManifest, options.scriptVariantId);
  requireApproval(sourceManifest, 'script', bundle.scriptVariant.script_variant_id);
  requireApproval(sourceManifest, 'render', bundle.renderJob.render_job_id);
  const assets = await findApprovedAssets(sourceManifest, bundle.renderJob, projectRoot);
  const completedRenderJob = await executeApprovedRender(bundle.renderJob, {
    assets,
    voiceJob: bundle.voiceJob,
    captionJob: bundle.captionJob,
    projectRoot,
    ffmpegExecutable: resolveFfmpegExecutable(options.config || {
      executable: bundle.renderJob.execution_plan.executable,
    }),
    runProcess: options.runProcess,
    verifyOutput: options.verifyOutput,
  });
  const archiveEnabled = options.config?.archive?.enabled !== false;
  const archiveResult = options.verifyOutput === false || !archiveEnabled
    ? null
    : await archiveVerifiedMedia({
        sourcePath: resolveInsideRoot(
          projectRoot,
          completedRenderJob.output_path,
          'Completed render path',
        ),
        relativePath: bundle.renderJob.render_purpose === 'internal_editor_test'
          ? `Archive/Tests/Test Renders/ORION-${archiveSlug(sourceManifest.products[0].canonical_name)}-${completedRenderJob.render_job_id}.mp4`
          : `Masters/ORION-${archiveSlug(sourceManifest.products[0].canonical_name)}-${completedRenderJob.render_job_id}.mp4`,
        renderJobId: completedRenderJob.render_job_id,
        preferredRoot: options.config?.archive?.preferred_root,
        fallbackRoot: options.config?.archive?.fallback_root,
        deviceId: options.config?.archive?.device_id,
      });

  return OutputManifestSchema.parse({
    ...sourceManifest,
    mode: bundle.renderJob.render_purpose === 'internal_editor_test'
      ? 'internal_editor_test'
      : 'local_render',
    render_jobs: replaceById(sourceManifest.render_jobs, 'render_job_id', completedRenderJob),
    gates: { ...sourceManifest.gates, render_ready: true },
    external_calls: { ...sourceManifest.external_calls, local_render: 'local_executed' },
    archive_results: [
      ...sourceManifest.archive_results,
      ...(archiveResult ? [archiveResult] : []),
    ],
    notes: [
      ...sourceManifest.notes,
      bundle.renderJob.render_purpose === 'internal_editor_test'
        ? 'Internal editor-test render completed from an approved local timeline with a mandatory do-not-publish watermark.'
        : 'One local render completed from approved narration and a rights-verified multi-clip timeline.',
      ...(archiveResult ? [
        archiveResult.status === 'archived'
          ? 'The completed render was SHA-256 verified in the external SSD archive.'
          : 'The external SSD was unavailable; a SHA-256-verified Desktop fallback copy is pending SSD archival.',
      ] : []),
      'Publishing remains disabled and separately approval-gated.',
    ],
  });
}

export function executeApprovedNarration(options) {
  return withLocalMediaJobLock(options, () => executeApprovedNarrationUnlocked(options));
}

export function executeApprovedLocalRender(options) {
  return withLocalMediaJobLock(options, () => executeApprovedLocalRenderUnlocked(options));
}
