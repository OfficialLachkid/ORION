import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { buildEvidenceReport } from './analyzer.mjs';
import { postResearchReview, researchEvidenceHash } from './discord-review.mjs';
import { fetchItchBrowseView } from './itch-browse-adapter.mjs';
import {
  generateResearchRecommendation,
  ResearchRecommendationQualityError,
} from './ollama-recommendation-adapter.mjs';
import { DigitalAssetResearchStore } from './research-store.mjs';
import { ResearchConfigSchema, ResearchObservationSchema } from './schemas.mjs';

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function loadResearchConfig(path, projectRoot = process.cwd(), overrides = {}) {
  const parsed = ResearchConfigSchema.parse(JSON.parse(await readFile(resolve(projectRoot, path), 'utf8')));
  const configuredRoot = overrides.archiveRoot || parsed.archive_root;
  return {
    ...parsed,
    archive_root: isAbsolute(configuredRoot) ? resolve(configuredRoot) : resolve(projectRoot, configuredRoot),
  };
}

function runArchivePath(config, observedAt, runId) {
  const date = observedAt.slice(0, 10);
  return resolve(config.archive_root, 'runs', date, runId);
}

function createStore(options) {
  return options.store || new DigitalAssetResearchStore({
    supabaseUrl: options.runtimeConfig?.env?.SUPABASE_URL,
    apiKey: options.runtimeConfig?.env?.SUPABASE_SECRET_KEY
      || options.runtimeConfig?.env?.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl: options.fetchImpl,
  });
}

export async function loadExistingProductCatalog(root) {
  if (!root) return [];
  let entries;
  try { entries = await readdir(resolve(root), { withFileTypes: true }); } catch { return []; }
  const products = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const product = JSON.parse(await readFile(resolve(root, entry.name, 'product.json'), 'utf8'));
      products.push({
        slug: product.slug,
        title: product.title,
        version: product.version,
        category: product.category,
        product_type: product.product_type,
        theme: product.theme,
        assets: (product.assets || []).map((asset) => ({ name: asset.name, kind: asset.kind })),
      });
    } catch {
      // Non-product folders and incomplete archives are not research candidates.
    }
  }
  return products;
}

export async function analyzeResearchHistory(options) {
  const config = ResearchConfigSchema.parse(options.config);
  const observedAt = options.now || new Date().toISOString();
  const store = createStore(options);
  const recent = await store.listRecentObservations(config.source.id);
  let report = buildEvidenceReport(recent, config.minimum_snapshots);
  let recommendation = null;
  let evidenceHash = null;
  let discord = null;
  let analysisIssue = null;
  if (report.status === 'eligible_for_local_analysis') {
    const existingProducts = options.existingProducts || await loadExistingProductCatalog(
      options.runtimeConfig?.env?.DIGITAL_ASSET_ARCHIVE_ROOT,
    );
    try {
      recommendation = await (options.generateRecommendation || generateResearchRecommendation)({
        report,
        model: config.model,
        existingProducts,
        fetchImpl: options.fetchImpl,
      });
      evidenceHash = researchEvidenceHash(report, recommendation);
      await store.insertRecommendation({
        recommendation_id: recommendation.recommendation_id,
        source_id: config.source.id,
        evidence_hash: evidenceHash,
        status: 'awaiting_review',
        recommendation,
        evidence_observation_ids: recommendation.evidence_ids,
        created_at: observedAt,
      });
    } catch (error) {
      if (!(error instanceof ResearchRecommendationQualityError)) throw error;
      analysisIssue = error.message;
      report = {
        ...report,
        status: 'monitoring',
        reason: 'Two snapshots were compared, but no recommendation passed ORION evidence-quality gates. Research remains in monitoring and no generation was started.',
      };
    }
  }
  if (options.postToDiscord) {
    discord = await (options.postReview || postResearchReview)({
      runtimeConfig: options.runtimeConfig,
      config,
      report,
      recommendation,
      evidenceHash,
      fetchImpl: options.fetchImpl,
    });
    if (recommendation) {
      await store.updateRecommendation(recommendation.recommendation_id, {
        discord_channel_id: discord.channelId,
        discord_message_id: discord.messageId,
      });
    }
  }
  return { report, recommendation, evidenceHash, discord, analysisIssue };
}

export async function runResearchCollection(options) {
  const config = ResearchConfigSchema.parse(options.config);
  if (config.scheduling.enabled && !options.allowScheduled) {
    throw new Error('Automatic research scheduling is intentionally disabled for the MVP. Run it manually.');
  }
  const observedAt = options.now || new Date().toISOString();
  const runId = options.runId || randomUUID();
  const store = createStore(options);
  const archivePath = runArchivePath(config, observedAt, runId);
  await store.insertRun({
    run_id: runId,
    source_id: config.source.id,
    status: 'running',
    started_at: observedAt,
    raw_archive_path: archivePath,
    observation_count: 0,
  });

  try {
    const results = [];
    for (let index = 0; index < config.source.views.length; index += 1) {
      if (index > 0 && config.request_delay_ms) await (options.sleepImpl || wait)(config.request_delay_ms);
      results.push(await (options.fetchView || fetchItchBrowseView)({
        runId,
        sourceId: config.source.id,
        view: config.source.views[index],
        userAgent: config.source.user_agent,
        maximumItems: config.maximum_items_per_view,
        observedAt,
        fetchImpl: options.fetchImpl,
      }));
    }
    const observations = results.flatMap((result) => result.observations)
      .map((row) => ResearchObservationSchema.parse(row));
    await mkdir(archivePath, { recursive: true });
    await Promise.all(results.map((result, index) => writeFile(
      resolve(archivePath, `${config.source.views[index].id}.html`),
      result.html,
      'utf8',
    )));
    await writeFile(resolve(archivePath, 'run.json'), `${JSON.stringify({
      run_id: runId,
      source_id: config.source.id,
      observed_at: observedAt,
      views: config.source.views.map((view, index) => ({
        ...view,
        final_url: results[index].finalUrl,
        observation_count: results[index].observations.length,
      })),
    }, null, 2)}\n`, 'utf8');
    await store.insertObservations(observations);
    await store.updateRun(runId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      observation_count: observations.length,
    });

    const analysis = await analyzeResearchHistory({ ...options, config, store, now: observedAt });
    return { runId, archivePath, observationCount: observations.length, ...analysis };
  } catch (error) {
    await store.updateRun(runId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: String(error.message || error).slice(0, 2000),
    }).catch(() => {});
    throw error;
  }
}
