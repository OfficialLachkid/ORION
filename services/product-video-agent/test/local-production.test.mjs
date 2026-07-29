import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import { executeCaptionTiming, tokenizeApprovedCaptionText } from '../src/adapters/caption-adapter.mjs';
import {
  compileVerticalFfmpegArgs,
  createSceneAwareTimeline,
  executeApprovedRender,
  LocalFfmpegRenderPlanner,
  retimeTimelineClips,
} from '../src/adapters/render-adapter.mjs';
import { buildProductVideoApprovalCards } from '../src/approval-cards.mjs';
import { buildAssCaptions, groupCaptionWords } from '../src/caption-timing.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { executeApprovedLocalRender, executeApprovedNarration } from '../src/local-assembly.mjs';
import { generateLocalScriptPreview } from '../src/local-preview.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';
import { applyWorkflowApprovalDecision } from '../src/approval-decisions.mjs';
import { evaluateInternalEditorTestAssetGates } from '../src/compliance.mjs';
import { RenderJobSchema } from '../src/schemas.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const inputFile = 'services/product-video-agent/fixtures/example-product.json';
const configFile = 'services/product-video-agent/config.example.json';

async function createDryRun() {
  const config = await loadPipelineConfig(configFile, projectRoot);
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  return runProductVideoDryRun({ adapter, config, inputFile, projectRoot });
}

async function createLocalPreview() {
  const { manifest } = await createDryRun();
  const contentByAngle = {
    problem_solution: {
      hook: 'Dust hides where a cloth cannot reach.',
      body: 'A focused air stream clears narrow desk gaps.',
      callToAction: 'The reusable tool is ready for the next dusty corner.',
    },
    demonstration: {
      hook: 'Watch the loose debris move between these keys.',
      body: 'Interchangeable nozzles direct air around compact equipment.',
      callToAction: 'A broader attachment handles the open surface afterward.',
    },
    novelty: {
      hook: 'One rechargeable tool replaces another disposable can.',
      body: 'USB-C charging keeps the handheld air source reusable.',
      callToAction: 'Different brush heads add another way to loosen dust.',
    },
  };
  return generateLocalScriptPreview({
    manifest,
    scriptAdapter: {
      async checkReadiness() {
        return { status: 'ready', detail: 'Fixture local model ready.' };
      },
      async generateVariant({ product, scriptJob, runAt }) {
        const content = contentByAngle[scriptJob.angle];
        return {
          script_variant_id: `script-variant-${scriptJob.angle}`,
          product_id: product.product_id,
          angle: scriptJob.angle,
          target_duration_seconds: scriptJob.target_duration_seconds,
          hook: content.hook,
          body: content.body,
          call_to_action: content.callToAction,
          affiliate_disclosure: scriptJob.creative_brief.disclosure,
          spoken_text: `${content.hook} ${content.body} ${content.callToAction}`,
          generation_provider: 'fixture-local',
          model: 'fixture-model',
          status: 'awaiting_approval',
          approval_status: 'pending',
          created_at: runAt,
        };
      },
    },
  });
}

test('local production manifest includes licensed voice, captions, owned media, and workflow approvals', async () => {
  const { manifest } = await createDryRun();
  const ownedAssets = manifest.assets.filter((asset) => asset.source_provider === 'orion-owned-fixture');
  const ownedAsset = ownedAssets[0];
  const amazonAsset = manifest.assets.find((asset) => asset.source_provider === 'amazon-product-page');
  const ownedApproval = manifest.workflow_approvals.find((item) => item.subject_id === ownedAsset.asset_id);
  const amazonApproval = manifest.workflow_approvals.find((item) => item.subject_id === amazonAsset.asset_id);

  assert.equal(manifest.voice_license.voice_id, 'Kokoro-82M-v1.0');
  assert.equal(manifest.voice_license.dataset_license, 'permissive_and_non_copyrighted_sources');
  assert.equal(manifest.voice_license.commercial_use_status, 'approved');
  assert.deepEqual(
    manifest.voice_licenses.map((voice) => voice.voice_id),
    ['Kokoro-82M-v1.0'],
  );
  assert.deepEqual(
    manifest.voice_over_jobs.map((job) => job.voice_profile_id),
    ['us-female-kokoro-heart', 'us-male-kokoro-deep', 'us-female-kokoro-heart'],
  );
  assert.equal(manifest.caption_jobs.length, 3);
  assert.equal(manifest.workflow_approvals.length, 11);
  assert.equal(ownedApproval.state, 'approved');
  assert.equal(amazonApproval.state, 'blocked');
  assert.ok(manifest.gates.eligible_asset_ids.includes(ownedAsset.asset_id));
  assert.ok(manifest.render_jobs.every((job) => job.timeline.length === ownedAssets.length));
  assert.ok(manifest.render_jobs.every((job) => (
    ownedAssets.every((asset) => job.asset_ids.includes(asset.asset_id))
  )));
  assert.ok(manifest.script_jobs.every((job) => (
    job.creative_brief.key_facts.every((fact) => !/Example Labs|6000 mAh|100000 RPM|\bUSD\b/u.test(fact))
  )));
  assert.ok(manifest.script_jobs.every((job) => (
    job.creative_brief.key_facts.some((fact) => /USB-C/u.test(fact))
  )));
  assert.ok(manifest.render_jobs.every((job) => !job.asset_ids.includes(amazonAsset.asset_id)));
});

test('local synthesis changes create a new voice artifact identity', async () => {
  const config = await loadPipelineConfig(configFile, projectRoot);
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const baseline = await runProductVideoDryRun({ adapter, config, inputFile, projectRoot });
  const tunedConfig = structuredClone(config);
  tunedConfig.voice.profiles[0].synthesis.speed = 0.95;
  const tuned = await runProductVideoDryRun({ adapter, config: tunedConfig, inputFile, projectRoot });

  assert.notEqual(
    baseline.manifest.voice_over_jobs[0].voice_over_job_id,
    tuned.manifest.voice_over_jobs[0].voice_over_job_id,
  );
  assert.notEqual(
    baseline.manifest.voice_over_jobs[0].output_path,
    tuned.manifest.voice_over_jobs[0].output_path,
  );
  assert.notEqual(
    baseline.manifest.caption_jobs[0].caption_job_id,
    tuned.manifest.caption_jobs[0].caption_job_id,
  );
  assert.notEqual(
    baseline.manifest.render_jobs[0].render_job_id,
    tuned.manifest.render_jobs[0].render_job_id,
  );
});

test('Discord cards enable script review and disable unsafe asset/render approvals', async () => {
  const { manifest } = await createLocalPreview();
  const cards = buildProductVideoApprovalCards(manifest);
  const scriptCard = cards.find(({ approval }) => approval.stage === 'script');
  const amazonCard = cards.find(({ approval }) => {
    const asset = manifest.assets.find((item) => item.asset_id === approval.subject_id);
    return asset?.source_provider === 'amazon-product-page';
  });
  const renderCard = cards.find(({ approval }) => approval.stage === 'render');

  assert.equal(scriptCard.payload.components[0].components[0].disabled, false);
  assert.equal(scriptCard.event.channelKey, 'orionReview');
  assert.equal(amazonCard.payload.components[0].components[0].disabled, true);
  assert.equal(renderCard.payload.components[0].components[0].disabled, true);
  assert.equal(scriptCard.payload.embeds[0].fields.some((field) => field.name === 'Script Preview'), true);
  assert.equal(scriptCard.payload.embeds[0].fields.some((field) => (
    field.name === 'Publication Disclosure (not narrated)'
  )), true);
  assert.equal(amazonCard.payload.embeds[0].fields.some((field) => field.name === 'Rights'), true);
  assert.equal(renderCard.payload.embeds[0].fields.some((field) => field.name === 'Render Blockers'), true);
});

test('planning-only scripts and blocked asset decisions cannot be approved', async () => {
  const { manifest } = await createDryRun();
  const cards = buildProductVideoApprovalCards(manifest);
  const plannedScriptCard = cards.find(({ approval }) => approval.stage === 'script');
  const blockedAssetApproval = manifest.workflow_approvals.find((approval) => (
    approval.stage === 'asset' && approval.state === 'blocked'
  ));

  assert.equal(plannedScriptCard.payload.components[0].components[0].disabled, true);
  assert.throws(
    () => applyWorkflowApprovalDecision(manifest, {
      taskId: blockedAssetApproval.task_id,
      decision: 'approve',
      actor: 'operator-test',
      reason: 'Should not bypass rights checks.',
      decidedAt: '2026-07-20T01:00:00.000Z',
    }),
    /blocked and cannot be approved/u,
  );
});

test('ASS captions use audio-timed active words and balanced two-to-four-word groups', () => {
  const ass = buildAssCaptions([
    { start: 0, end: 0.3, word: 'This', probability: 0.99 },
    { start: 0.8, end: 1, word: 'is', probability: 0.98 },
    { start: 1, end: 1.5, word: 'local', probability: 0.97 },
  ], { maxWordsPerLine: 4 });

  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:00\.80/u);
  assert.match(ass, /\{\\c&H0000A5FF&\}This\{\\r\} is local/u);
  assert.match(ass, /PlayResX: 1080/u);
  assert.equal(ass.split('\n').filter((line) => line.startsWith('Dialogue:')).length, 3);

  const groups = groupCaptionWords(Array.from({ length: 9 }, (_, index) => ({ word: String(index) })), 4);
  assert.deepEqual(groups.map((group) => group.length), [3, 3, 3]);
  assert.deepEqual(
    tokenizeApprovedCaptionText('Split this two-in-one speaker; snap both halves back.'),
    ['Split', 'this', 'two', 'in', 'one', 'speaker', 'snap', 'both', 'halves', 'back.'],
  );

  const sentenceGroups = groupCaptionWords([
    { word: 'First' },
    { word: 'sentence.' },
    { word: 'Second' },
    { word: 'sentence' },
    { word: 'starts' },
    { word: 'cleanly.' },
  ], 4);
  assert.deepEqual(
    sentenceGroups.map((group) => group.map((word) => word.word)),
    [['First', 'sentence.'], ['Second', 'sentence', 'starts', 'cleanly.']],
  );
});

test('faster-whisper adapter writes validated word and ASS artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-caption-'));
  const job = {
    caption_job_id: 'caption-test',
    product_id: 'product-test',
    script_job_id: 'script-job-test',
    voice_over_job_id: 'voice-test',
    provider: 'faster_whisper',
    model: 'small.en',
    language: 'en-US',
    audio_path: 'audio/voice.wav',
    words_output_path: 'captions/voice.words.json',
    ass_output_path: 'captions/voice.ass',
    status: 'blocked',
    blockers: ['voice_over_not_complete'],
    words: [],
    duration_seconds: 0,
    execution_plan: {
      executable: '.venv/bin/python',
      args: ['worker.py', '--audio-path', 'audio/voice.wav', '--model', 'small.en', '--word-timestamps'],
      execute: false,
    },
    created_at: '2026-07-20T00:00:00.000Z',
  };
  const completed = await executeCaptionTiming(job, {
    projectRoot: root,
    expectedText: 'Local captions',
    async runProcess() {
      return {
        stdout: JSON.stringify({
          durationSeconds: 1.2,
          words: [
            { start: 0, end: 0.5, word: 'Local', probability: 0.99 },
            { start: 0.5, end: 1.2, word: 'captions', probability: 0.98 },
          ],
        }),
      };
    },
  });

  assert.equal(completed.status, 'complete');
  assert.equal(completed.words.length, 2);
  assert.equal(completed.words[1].word, 'captions');
  assert.match(await readFile(join(root, 'captions/voice.ass'), 'utf8'), /Local/u);
  assert.match(await readFile(join(root, 'captions/voice.words.json'), 'utf8'), /captions/u);
});

test('FFmpeg compiler uses an approved timeline, ASS captions, H.264, and AAC', async () => {
  const { manifest } = await createDryRun();
  const job = manifest.render_jobs[0];
  const assets = manifest.assets.filter((item) => job.asset_ids.includes(item.asset_id));
  const voiceJob = manifest.voice_over_jobs[0];
  const captionJob = manifest.caption_jobs[0];
  const args = compileVerticalFfmpegArgs({ job, assets, voiceJob, captionJob, projectRoot });
  const filter = args[args.indexOf('-filter_complex') + 1];

  assert.equal(args.filter((arg) => arg === '-loop').length, 3);
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.match(filter, /scale=1080:1920/u);
  assert.match(filter, /crop=1080:1920/u);
  assert.match(filter, /xfade=transition=fade/u);
  assert.match(filter, /ass=filename/u);
  assert.ok(args.includes('-shortest'));
});

test('FFmpeg compiler trims a video clip and refuses an unavailable timeline asset', async () => {
  const { manifest } = await createDryRun();
  const sourceJob = manifest.render_jobs[0];
  const assets = manifest.assets.filter((item) => sourceJob.asset_ids.includes(item.asset_id));
  const videoAsset = { ...assets[1], media_type: 'video' };
  const job = RenderJobSchema.parse({
    ...sourceJob,
    timeline: sourceJob.timeline.map((clip, index) => (
      index === 1
        ? { ...clip, media_type: 'video', source_start_seconds: 1.25 }
        : clip
    )),
  });
  const voiceJob = manifest.voice_over_jobs[0];
  const captionJob = manifest.caption_jobs[0];
  const args = compileVerticalFfmpegArgs({
    job,
    assets: [assets[0], videoAsset, assets[2]],
    voiceJob,
    captionJob,
    projectRoot,
  });

  assert.ok(!args.includes('-stream_loop'));
  assert.ok(args.includes('1.25'));
  assert.throws(
    () => compileVerticalFfmpegArgs({
      job,
      assets: [assets[0], videoAsset],
      voiceJob,
      captionJob,
      projectRoot,
    }),
    /timeline asset .* is unavailable/u,
  );
  const blockedJob = RenderJobSchema.parse({
    ...sourceJob,
    asset_ids: [],
    timeline: [],
  });
  assert.throws(
    () => compileVerticalFfmpegArgs({
      job: blockedJob,
      assets: [],
      voiceJob,
      captionJob,
      projectRoot,
    }),
    /at least one approved timeline clip/u,
  );
});

test('scene-aware planner uses four source shots and retimes without changing playback speed', async () => {
  const { manifest } = await createDryRun();
  const config = await loadPipelineConfig(configFile, projectRoot);
  const asset = {
    ...manifest.assets[0],
    media_type: 'video',
    video_analysis: {
      analyzer: 'ffmpeg_scene_detection',
      analyzed_at: '2026-07-27T09:00:00.000Z',
      duration_seconds: 27.696,
      frame_rate: 29.97,
      width: 642,
      height: 360,
      scene_threshold: 0.2,
      scene_boundaries_seconds: [16.751, 23.725],
    },
  };
  const planner = new LocalFfmpegRenderPlanner({
    ...config.render,
    purpose: 'internal_editor_test',
    platform_targets: config.content_strategy.platforms,
  });
  const job = planner.createJob({
    product: manifest.products[0],
    scriptJob: manifest.script_jobs[0],
    voiceJob: manifest.voice_over_jobs[0],
    captionJob: manifest.caption_jobs[0],
    assetGates: { eligible: [asset], blocked: [] },
    runAt: manifest.run_at,
  });
  const retimed = retimeTimelineClips(job.timeline, [asset], 17.94);
  const outputDuration = retimed.reduce((total, clip) => (
    total + clip.duration_seconds - clip.transition_duration_seconds
  ), 0);

  assert.equal(job.timeline.length, 4);
  assert.deepEqual(
    job.timeline.map((clip) => clip.source_start_seconds),
    [0, 8.376, 16.751, 23.725],
  );
  assert.equal(Number(outputDuration.toFixed(2)), 17.94);
  assert.ok(retimed.every((clip) => clip.duration_seconds > 3.9));
});

test('scene-aware planner spreads four shots across footage with rapid cuts', async () => {
  const { manifest } = await createDryRun();
  const asset = {
    ...manifest.assets[0],
    media_type: 'video',
    video_analysis: {
      analyzer: 'ffmpeg_scene_detection',
      analyzed_at: '2026-07-27T12:20:00.000Z',
      duration_seconds: 33.268,
      frame_rate: 29.97,
      width: 1920,
      height: 1080,
      scene_threshold: 0.2,
      scene_boundaries_seconds: [
        1.97, 2.604, 3.104, 3.672, 4.272, 4.873, 6.241, 7.275, 7.876,
        9.344, 10.312, 11.112, 12.047, 13.281, 13.882, 15.784, 16.751,
        18.62, 19.254, 19.821, 20.422, 21.022, 21.79, 24.626, 25.226,
        28.163, 29.03,
      ],
    },
  };
  const timeline = createSceneAwareTimeline([asset], manifest.script_jobs[0]);
  const retimed = retimeTimelineClips(timeline, [asset], 19);

  assert.equal(timeline.length, 4);
  assert.deepEqual(
    timeline.map((clip) => clip.source_start_seconds),
    [0, 7.876, 16.751, 25.226],
  );
  assert.ok(retimed.every((clip) => clip.duration_seconds >= 4.8));
});

test('internal editor-test footage is local-only, watermarked, and never publication eligible', async () => {
  const { manifest } = await createDryRun();
  const ownedAsset = manifest.assets.find((asset) => asset.source_provider === 'orion-owned-fixture');
  const internalAsset = {
    ...ownedAsset,
    source_provider: 'browser-observed-amazon-test-footage',
    retrieval_method: 'permitted_browser',
    rights_status: 'unverified',
    rights_basis: 'unknown',
    rights_evidence: null,
    usage_scope: 'internal_editor_test',
  };
  const gates = await evaluateInternalEditorTestAssetGates([internalAsset], projectRoot);
  const sourceJob = manifest.render_jobs[0];
  const internalJob = RenderJobSchema.parse({
    ...sourceJob,
    render_purpose: 'internal_editor_test',
    publication_eligible: false,
    watermark_required: true,
    asset_ids: [internalAsset.asset_id],
    timeline: [{
      ...sourceJob.timeline[0],
      asset_id: internalAsset.asset_id,
      transition_after: 'cut',
      transition_duration_seconds: 0,
    }],
  });
  const voiceJob = { ...manifest.voice_over_jobs[0], status: 'complete', blockers: [] };
  const captionJob = { ...manifest.caption_jobs[0], status: 'complete', blockers: [] };
  const args = compileVerticalFfmpegArgs({
    job: internalJob,
    asset: internalAsset,
    voiceJob,
    captionJob,
    projectRoot,
  });
  const completed = await executeApprovedRender(internalJob, {
    asset: internalAsset,
    voiceJob,
    captionJob,
    projectRoot,
    verifyOutput: false,
    async runProcess() {
      return { stdout: '' };
    },
  });

  assert.equal(gates.eligible.length, 1);
  assert.match(args[args.indexOf('-filter_complex') + 1], /INTERNAL TEST - DO NOT PUBLISH/u);
  assert.equal(completed.publication_eligible, false);
  assert.equal(completed.status, 'complete');
});

test('local narration refuses a pending script before invoking any process', async () => {
  const { manifest } = await createLocalPreview();
  let processCalls = 0;
  await assert.rejects(
    executeApprovedNarration({
      manifest,
      scriptVariantId: manifest.script_variants[0].script_variant_id,
      projectRoot,
      async runProcess() {
        processCalls += 1;
        return { stdout: '' };
      },
    }),
    /script approval is required/u,
  );
  assert.equal(processCalls, 0);
});

test('approved narration unlocks the render card and approved FFmpeg remains non-publishing', async () => {
  const preview = await createLocalPreview();
  const scriptVariant = preview.manifest.script_variants[0];
  const scriptApproval = preview.manifest.workflow_approvals.find((item) => (
    item.stage === 'script' && item.subject_id === scriptVariant.script_variant_id
  ));
  const scriptApproved = applyWorkflowApprovalDecision(preview.manifest, {
    taskId: scriptApproval.task_id,
    decision: 'approve',
    actor: 'operator-test',
    reason: 'Fixture script approved for local renderer validation.',
    decidedAt: '2026-07-20T01:00:00.000Z',
  });
  let processCalls = 0;
  let narrationInput = '';
  const narrated = await executeApprovedNarration({
    manifest: scriptApproved,
    scriptVariantId: scriptVariant.script_variant_id,
    projectRoot,
    verifyOutput: false,
    async writeCaptionArtifacts() {},
    async runProcess({ args, input }) {
      processCalls += 1;
      if (!args.includes('--word-timestamps')) narrationInput = input;
      return args.includes('--word-timestamps')
        ? {
            stdout: JSON.stringify({
              durationSeconds: 1,
              words: [{ start: 0, end: 1, word: 'Approved', probability: 0.99 }],
            }),
          }
        : { stdout: '' };
    },
  });
  const renderJob = narrated.render_jobs.find((job) => (
    job.voice_over_job_id === narrated.voice_over_jobs.find((job) => (
      job.script_variant_id === scriptVariant.script_variant_id
    )).voice_over_job_id
  ));
  const renderApproval = narrated.workflow_approvals.find((item) => (
    item.stage === 'render' && item.subject_id === renderJob.render_job_id
  ));

  assert.equal(narrated.mode, 'local_narration');
  assert.equal(renderApproval.state, 'pending');
  assert.deepEqual(renderJob.blockers, ['render_approval_pending']);
  assert.equal(processCalls, 2);
  assert.equal(narrationInput, scriptVariant.spoken_text);
  assert.doesNotMatch(narrationInput, /affiliate links/u);
  const captionJob = narrated.caption_jobs.find((job) => job.status === 'complete');
  assert.ok(captionJob.execution_plan.args.includes('--disable-vad-filter'));
  const completedVoiceJob = narrated.voice_over_jobs.find((job) => (
    job.script_variant_id === scriptVariant.script_variant_id
  ));
  assert.ok(completedVoiceJob.execution_plan.args.includes('--sentence-pause-ms'));
  assert.ok(completedVoiceJob.execution_plan.args.includes('--speed'));
  assert.ok(completedVoiceJob.execution_plan.args.includes('--prosody-mode'));

  const renderApproved = applyWorkflowApprovalDecision(narrated, {
    taskId: renderApproval.task_id,
    decision: 'approve',
    actor: 'operator-test',
    reason: 'Fixture render approved for local validation.',
    decidedAt: '2026-07-20T01:05:00.000Z',
  });
  const rendered = await executeApprovedLocalRender({
    manifest: renderApproved,
    scriptVariantId: scriptVariant.script_variant_id,
    projectRoot,
    config: { render: { executable: 'ffmpeg' } },
    verifyOutput: false,
    async runProcess({ executable }) {
      assert.equal(executable, 'ffmpeg');
      return { stdout: '' };
    },
  });

  assert.equal(rendered.mode, 'local_render');
  assert.equal(rendered.gates.render_ready, true);
  assert.equal(rendered.gates.publish_ready, false);
  assert.equal(rendered.external_calls.local_render, 'local_executed');
});
