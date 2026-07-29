#!/usr/bin/env node

import { argv } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from './src/adapters/fixture-adapter.mjs';
import { OllamaScriptAdapter } from './src/adapters/ollama-script-adapter.mjs';
import { loadPipelineConfig } from './src/config.mjs';
import { generateLocalScriptPreview } from './src/local-preview.mjs';
import {
  FileProductVideoStateStore,
  SupabaseProductVideoStateStore,
} from './src/persistence.mjs';
import { runProductVideoDryRun } from './src/pipeline.mjs';
import { inspectProductVideoRuntime } from './src/runtime-readiness.mjs';
import { buildProductVideoApprovalCards } from './src/approval-cards.mjs';
import { executeApprovedLocalRender, executeApprovedNarration } from './src/local-assembly.mjs';
import { resolveInsideRoot } from './src/paths.mjs';
import { applyWorkflowApprovalDecision } from './src/approval-decisions.mjs';
import {
  assertProductVideoResourcesAvailable,
  inspectProductVideoResourceAvailability,
} from './src/resource-preflight.mjs';
import { withLocalMediaJobLock } from './src/media-job-lock.mjs';
import {
  applyOperatorScriptRevision,
  createOperatorScriptFallback,
} from './src/script-revisions.mjs';
import { loadRuntimeConfig } from '../lib/runtime-config.mjs';
import { archiveManifestAssets } from './src/asset-archive.mjs';
import {
  cleanupVerifiedWorkingMedia,
  restoreArchivedAssetWorkingCopies,
} from './src/media-cache.mjs';
import { analyzeManifestVideoScenes } from './src/scene-analysis.mjs';
import {
  setTemporarySourceRetention,
  sweepExpiredTemporarySources,
} from './src/media-retention.mjs';

const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serviceDirectory, '../..');

function getArgValue(flag, fallback = '') {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }

  return argv[index + 1] || fallback;
}

function hasFlag(flag) {
  return argv.includes(flag);
}

function printHelp() {
  process.stdout.write([
    'Usage: node services/product-video-agent/index.mjs [options]',
    '',
    'Options:',
    '  --input-file <path>   Manual/fixture product JSON.',
    '  --config <path>       Local dry-run configuration JSON.',
    '  --output-dir <path>   Override the generated manifest directory.',
    '  --run-at <ISO date>   Override the deterministic run timestamp.',
    '  --doctor              Inspect local Ollama, TTS, caption, and FFmpeg readiness.',
    '  --resource-preflight  Check that Ollama and conflicting heavy jobs are idle.',
    '  --execute-local-scripts  Generate pending-review scripts with local Ollama.',
    '  --internal-editor-test  Force watermarked, non-publishable render planning.',
    '  --approval-cards     Print Discord card payloads without sending them.',
    '  --manifest <path>     Existing manifest used to regenerate approval cards.',
    '  --decide-workflow <manifest>  Apply an operator approval decision locally.',
    '  --revise-script <manifest>  Apply an auditable operator script revision.',
    '  --create-operator-script <manifest>  Create a pending script after model failure.',
    '  --script-file <path>  JSON containing hook, body, and call_to_action.',
    '  --script-job-id <id>  Planned script job used by an operator fallback.',
    '  --task-id <id>        Workflow task ID for a decision.',
    '  --decision <value>    approve or reject.',
    '  --actor <name>        Operator identity recording the decision.',
    '  --reason <text>       Required rejection reason; optional approval note.',
    '  --execute-approved-narration <manifest>  Run local TTS and caption timing.',
    '  --execute-approved-render <manifest>  Execute one fully approved local render.',
    '  --script-variant-id <id>  Approved script variant to render.',
    '  --write-manifest <path>  Write the updated manifest inside the repository.',
    '  --no-persist          Validate and print the summary without writing state.',
    '  --print-manifest      Print the full review manifest.',
    '  --persist-supabase <manifest>  Upsert one validated manifest into compact video tables.',
    '  --archive-assets <manifest>  Hash-verify and archive referenced local source assets.',
    '  --cleanup-local-media <manifest>  Remove Mac copies only after verified T7 archival.',
    '  --restore-local-assets <manifest>  Restore missing render sources from verified T7 copies.',
    '  --analyze-video-scenes <manifest>  Detect local video scenes with FFmpeg/FFprobe.',
    '  --set-source-retention <manifest>  Set an expiry for archived internal-test footage.',
    '  --retention-hours <hours>  Temporary source lifetime used by the retention command.',
    '  --sweep-expired-media <manifest>  SHA-verify and delete expired temporary source footage.',
    '  --as-of <ISO date>     Deterministic retention sweep timestamp.',
    '  --asset-id <id>       Asset selected for local scene analysis.',
    '  --help                Show this help.',
    '',
    'The default dry run makes no model or external calls.',
    'Local script execution is opt-in and cannot trigger TTS, rendering, downloads, or publishing.',
    'Approved rendering still requires approved manifest records and never publishes.',
  ].join('\n'));
}

async function writeOrPrintManifest(manifest) {
  const outputPath = getArgValue('--write-manifest');
  if (!outputPath) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return null;
  }
  const absolutePath = resolveInsideRoot(projectRoot, outputPath, 'Output manifest path');
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ manifest_path: absolutePath, mode: manifest.mode }, null, 2)}\n`);
  return absolutePath;
}

async function runResourceGuarded(config, operation) {
  await assertProductVideoResourcesAvailable(config);
  return operation();
}

async function loadProductVideoConfig(configPath, overrides = {}) {
  const config = await loadPipelineConfig(configPath, projectRoot, overrides);
  const { env } = loadRuntimeConfig();
  return {
    ...config,
    archive: {
      ...config.archive,
      preferred_root: config.archive.preferred_root
        || env.VIDEO_GENERATION_ARCHIVE_ROOT
        || null,
      fallback_root: config.archive.fallback_root
        || env.VIDEO_GENERATION_FALLBACK_ROOT
        || null,
    },
  };
}

async function main() {
  if (hasFlag('--help')) {
    printHelp();
    return;
  }

  const retentionManifestPath = getArgValue('--set-source-retention');
  if (retentionManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, retentionManifestPath, 'Retention manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const retained = setTemporarySourceRetention({
      manifest,
      assetId: getArgValue('--asset-id'),
      retentionHours: Number(getArgValue('--retention-hours')),
      now: getArgValue('--as-of', new Date().toISOString()),
    });
    await writeOrPrintManifest(retained);
    return;
  }

  const sweepManifestPath = getArgValue('--sweep-expired-media');
  if (sweepManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, sweepManifestPath, 'Retention sweep manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const swept = await sweepExpiredTemporarySources({
      manifest,
      asOf: getArgValue('--as-of', new Date().toISOString()),
    });
    await writeOrPrintManifest(swept.manifest);
    process.stdout.write(`${JSON.stringify(swept.report, null, 2)}\n`);
    return;
  }

  const sceneManifestPath = getArgValue('--analyze-video-scenes');
  if (sceneManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, sceneManifestPath, 'Scene-analysis manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const config = await loadProductVideoConfig(
      getArgValue('--config', 'services/product-video-agent/config.example.json'),
    );
    const analyzed = await analyzeManifestVideoScenes({
      manifest,
      assetId: getArgValue('--asset-id'),
      analyzedAt: getArgValue('--analyzed-at', new Date().toISOString()),
      config,
      projectRoot,
    });
    await writeOrPrintManifest(analyzed);
    return;
  }

  const cleanupManifestPath = getArgValue('--cleanup-local-media');
  if (cleanupManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, cleanupManifestPath, 'Cleanup manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const result = await cleanupVerifiedWorkingMedia({ manifest, projectRoot });
    await writeOrPrintManifest(result.manifest);
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    return;
  }

  const restoreManifestPath = getArgValue('--restore-local-assets');
  if (restoreManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, restoreManifestPath, 'Restore manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const restored = await restoreArchivedAssetWorkingCopies({ manifest, projectRoot });
    await writeOrPrintManifest(restored);
    return;
  }

  const archiveManifestPath = getArgValue('--archive-assets');
  if (archiveManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, archiveManifestPath, 'Asset archive manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const config = await loadProductVideoConfig(
      getArgValue('--config', 'services/product-video-agent/config.example.json'),
    );
    const archived = await archiveManifestAssets({ manifest, config, projectRoot });
    await writeOrPrintManifest(archived);
    return;
  }

  const supabaseManifestPath = getArgValue('--persist-supabase');
  if (supabaseManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, supabaseManifestPath, 'Supabase manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const runtimeConfig = loadRuntimeConfig();
    const store = new SupabaseProductVideoStateStore({
      supabaseUrl: runtimeConfig.env.SUPABASE_URL,
      apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY,
    });
    const result = await store.saveRun(manifest);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const revisionManifestPath = getArgValue('--revise-script');
  if (revisionManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, revisionManifestPath, 'Revision manifest path');
    const scriptPath = resolveInsideRoot(projectRoot, getArgValue('--script-file'), 'Script revision path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const content = JSON.parse(await readFile(scriptPath, 'utf8'));
    const revised = applyOperatorScriptRevision(manifest, {
      scriptVariantId: getArgValue('--script-variant-id'),
      content,
      actor: getArgValue('--actor'),
      reason: getArgValue('--reason'),
      revisedAt: getArgValue('--revised-at', new Date().toISOString()),
    });
    await writeOrPrintManifest(revised);
    return;
  }

  const operatorScriptManifestPath = getArgValue('--create-operator-script');
  if (operatorScriptManifestPath) {
    const manifestPath = resolveInsideRoot(
      projectRoot,
      operatorScriptManifestPath,
      'Operator script manifest path',
    );
    const scriptPath = resolveInsideRoot(
      projectRoot,
      getArgValue('--script-file'),
      'Operator script path',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const content = JSON.parse(await readFile(scriptPath, 'utf8'));
    const revised = createOperatorScriptFallback(manifest, {
      scriptJobId: getArgValue('--script-job-id'),
      content,
      actor: getArgValue('--actor'),
      reason: getArgValue('--reason'),
      revisedAt: getArgValue('--revised-at', new Date().toISOString()),
    });
    await writeOrPrintManifest(revised);
    return;
  }

  const decisionManifestPath = getArgValue('--decide-workflow');
  if (decisionManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, decisionManifestPath, 'Decision manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const decided = applyWorkflowApprovalDecision(manifest, {
      taskId: getArgValue('--task-id'),
      decision: getArgValue('--decision'),
      actor: getArgValue('--actor'),
      reason: getArgValue('--reason'),
      decidedAt: getArgValue('--decided-at', new Date().toISOString()),
    });
    await writeOrPrintManifest(decided);
    return;
  }

  const existingManifestPath = getArgValue('--manifest');
  if (hasFlag('--approval-cards') && existingManifestPath) {
    const manifestPath = resolveInsideRoot(projectRoot, existingManifestPath, 'Approval-card manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const cards = buildProductVideoApprovalCards(manifest);
    process.stdout.write(`${JSON.stringify(cards.map(({ approval, payload }) => ({ approval, payload })), null, 2)}\n`);
    return;
  }

  const narrationManifestPath = getArgValue('--execute-approved-narration');
  const renderManifestPath = getArgValue('--execute-approved-render');
  if (narrationManifestPath || renderManifestPath) {
    const inputPath = narrationManifestPath || renderManifestPath;
    const manifestPath = resolveInsideRoot(projectRoot, inputPath, 'Approved manifest path');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const scriptVariantId = getArgValue('--script-variant-id');
    if (!scriptVariantId) {
      throw new Error('--script-variant-id is required for local narration or rendering.');
    }
    const config = await loadProductVideoConfig(
      getArgValue('--config', 'services/product-video-agent/config.example.json'),
    );
    const result = await runResourceGuarded(
      config,
      () => narrationManifestPath
        ? executeApprovedNarration({
            manifest,
            scriptVariantId,
            projectRoot,
            maxWordsPerLine: config.captions.max_words_per_line,
          })
        : executeApprovedLocalRender({ manifest, scriptVariantId, projectRoot, config }),
    );
    await writeOrPrintManifest(result);
    return;
  }

  const inputFile = getArgValue(
    '--input-file',
    'services/product-video-agent/fixtures/example-product.json',
  );
  const configPath = getArgValue(
    '--config',
    'services/product-video-agent/config.example.json',
  );
  const runAt = getArgValue('--run-at');
  const outputDirectory = getArgValue('--output-dir');
  const loadedConfig = await loadProductVideoConfig(configPath, {
    ...(runAt ? { run_at: runAt } : {}),
    ...(outputDirectory ? { output_directory: outputDirectory } : {}),
  });
  const config = hasFlag('--internal-editor-test')
    ? {
        ...loadedConfig,
        render: {
          ...loadedConfig.render,
          purpose: 'internal_editor_test',
        },
      }
    : loadedConfig;
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const store = hasFlag('--no-persist')
    ? null
    : new FileProductVideoStateStore({
      projectRoot,
      outputDirectory: config.output_directory,
    });
  if (hasFlag('--doctor')) {
    const report = await inspectProductVideoRuntime({ config, projectRoot });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (hasFlag('--resource-preflight')) {
    const report = await inspectProductVideoResourceAvailability(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'ready') process.exitCode = 75;
    return;
  }

  const executeLocalScripts = hasFlag('--execute-local-scripts');
  const dryRun = await runProductVideoDryRun({
    adapter,
    config,
    inputFile,
    projectRoot,
    store: executeLocalScripts ? null : store,
  });
  const result = executeLocalScripts
    ? await runResourceGuarded(config, () => (
      withLocalMediaJobLock({ projectRoot }, () => generateLocalScriptPreview({
        manifest: dryRun.manifest,
        scriptAdapter: new OllamaScriptAdapter(config.script),
        store,
      }))
    ))
    : dryRun;

  if (hasFlag('--approval-cards')) {
    const cards = buildProductVideoApprovalCards(result.manifest);
    process.stdout.write(`${JSON.stringify(cards.map(({ approval, payload }) => ({
      approval,
      payload,
    })), null, 2)}\n`);
    return;
  }

  if (hasFlag('--print-manifest')) {
    process.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({
    run_id: result.manifest.run_id,
    mode: result.manifest.mode,
    manifest_path: result.persistence?.manifestPath || null,
    product: result.manifest.products[0].canonical_name,
    overall_score: result.manifest.product_scores[0].overall_score,
    script_variants: result.manifest.script_variants.length,
    workflow_approvals: result.manifest.workflow_approvals.length,
    publication_targets: result.manifest.content_strategy.platforms,
    render_ready: result.manifest.gates.render_ready,
    publish_ready: result.manifest.gates.publish_ready,
    blocked_asset_ids: result.manifest.gates.blocked_asset_ids,
    incurred_cost: result.manifest.cost.incurred,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
