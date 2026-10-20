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
import {
  ResearchConfigSchema,
  ResearchObservationSchema,
  ResearchRecommendationSchema,
} from './schemas.mjs';

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

function magicSimulationRecommendation(observations, observedAt) {
  const distinct = [];
  const preferred = [
    /fantasy|magic|wizard|spell|potion|rpg/iu,
    /effect|vfx|particle/iu,
  ];
  for (const pattern of preferred) {
    const match = observations.find((row) => pattern.test(row.title)
      && !distinct.some((item) => item.observation_id === row.observation_id));
    if (match) distinct.push(match);
  }
  for (const row of observations) {
    if (distinct.length >= 2) break;
    if (!distinct.some((item) => item.observation_id === row.observation_id)) distinct.push(row);
  }
  if (distinct.length < 2) throw new Error('The magic workflow simulation requires at least two stored observations.');
  const expiresAt = new Date(new Date(observedAt).getTime() + (90 * 24 * 60 * 60 * 1000)).toISOString();
  const stamp = observedAt.replace(/[-:.Z]/gu, '').slice(0, 14).toLowerCase();
  return ResearchRecommendationSchema.parse({
    schema_version: '1.0',
    recommendation_id: `sim-magic-${stamp}`,
    simulation: true,
    action: 'new_product',
    existing_product_slug: null,
    title: 'Arcane Relics & Potions',
    summary: 'Workflow simulation: create a cohesive pack of eight static arcane inventory and world-object sprites, then test generation, packaging, Discord review, and creative approval without marketplace staging.',
    rationale: [
      'This is an operator-requested end-to-end workflow test, not an autonomous market conclusion.',
      'Static inventory and world objects exercise the proven base-sprite pipeline without pretending that generalized spell animation recipes are production-ready.',
      'The selected scope is visually different from Neon Plasma Armory and therefore tests whether ORION can carry a new theme consistently.',
    ],
    confidence: 75,
    evidence_ids: distinct.map((row) => row.observation_id),
    opportunity: {
      schema_version: '1.0',
      opportunity_id: `simulation-arcane-relics-${stamp}`,
      status: 'validated',
      title: 'Arcane Relics & Potions',
      category: '2D game assets',
      product_type: 'pixel-art fantasy inventory and world-object sprite pack',
      theme: 'arcane fantasy alchemy',
      target_audience: ['2D RPG developers', 'indie game developers', 'fantasy game prototypers'],
      observed_at: observedAt,
      expires_at: expiresAt,
      signals: {
        trend_direction: 'stable',
        demand: 'medium',
        competition: 'medium',
        cross_marketplace_evidence: 'weak',
        confidence: 75,
      },
      generation: {
        seed: 14900,
        medium: 'pixel_art',
        perspective: 'consistent centered three-quarter inventory icon view',
        width: 96,
        height: 96,
        source_width: 1024,
        source_height: 1024,
        max_palette_colors: 24,
        palette: ['#171329', '#2c204f', '#513b79', '#8157a6', '#b481d1', '#ead7ff', '#193f58', '#1f7d8d', '#44c6bf', '#b9fff1', '#7a3d2b', '#cf7048', '#f4b96b', '#fff0b8'],
        outline: 'Use a crisp dark-purple one-to-two-pixel outline with readable silhouettes',
        lighting: 'Soft upper-left magical illumination with small cyan, violet, or warm-gold emissive accents',
        background: 'transparent',
        chroma_key: '#ff00ff',
        assets: [
          ['mana-potion', 'Mana Potion', 'potion', 'A corked round glass mana potion containing luminous blue-violet liquid', ['Transparent glass silhouette, bright liquid core, tiny arcane bubbles, no label or text']],
          ['healing-elixir', 'Healing Elixir', 'potion', 'A stoppered faceted healing elixir containing warm ruby and gold liquid', ['Clearly distinct bottle silhouette, subtle restorative spark, no medical symbol or text']],
          ['arcane-crystal', 'Arcane Crystal', 'crystal', 'A floating faceted arcane crystal with a small metal base clasp', ['Strong readable gemstone silhouette, contained inner glow, no scenery']],
          ['rune-stone', 'Rune Stone', 'relic', 'A palm-sized weathered rune stone with one original glowing geometric sigil', ['Use an original abstract sigil, no alphabet, no readable text']],
          ['spell-tome', 'Spell Tome', 'book', 'A closed leather spell tome with metal corners and a luminous central gem', ['Three-quarter view, original geometric cover ornament, no readable lettering']],
          ['alchemist-flask', 'Alchemist Flask', 'alchemy-tool', 'A reinforced alchemist flask with swirling teal and violet reagent', ['Distinct laboratory glass shape, metal neck brace, exactly one vessel']],
          ['ritual-candle', 'Ritual Candle', 'ritual-object', 'A short wax ritual candle in a small engraved metal holder with a magical flame', ['Original geometric engravings, contained flame, no floor or cast shadow']],
          ['enchanted-wand', 'Enchanted Wand', 'focus', 'A compact enchanted wand with a carved wooden grip and crystal focus tip', ['Diagonal presentation inside canvas, complete object visible, no hand or character']],
        ].map(([asset_key, name, kind, description, prompt_notes]) => ({
          asset_key,
          name,
          kind,
          description,
          prompt_notes,
          alpha_mode: 'chroma',
          alpha_palette: [],
          alpha_tolerance: 48,
        })),
      },
      commercial: {
        base_price: { amount: 3.99, currency: 'USD' },
        marketplace_candidates: ['itch.io'],
      },
      risk: {
        ip_risk: 'low',
        prohibited_references: ['existing game franchises', 'recognizable copyrighted symbols', 'artist signatures'],
        notes: ['Workflow simulation; human creative approval is required before any marketplace setup.'],
      },
      evidence: distinct.map((row) => ({
        label: row.title,
        source: row.listing_url,
        observed_at: row.observed_at,
      })),
    },
  });
}

export async function createMagicWorkflowSimulation(options) {
  const config = ResearchConfigSchema.parse(options.config);
  const observedAt = options.now || new Date().toISOString();
  const store = createStore(options);
  const recent = await store.listRecentObservations(config.source.id);
  const report = buildEvidenceReport(recent, config.minimum_snapshots);
  if (report.snapshot_count < config.minimum_snapshots) {
    throw new Error(`The workflow simulation requires ${config.minimum_snapshots} completed research snapshots.`);
  }
  const recommendation = magicSimulationRecommendation(recent, observedAt);
  const evidenceHash = researchEvidenceHash(report, recommendation);
  await store.insertRecommendation({
    recommendation_id: recommendation.recommendation_id,
    source_id: config.source.id,
    evidence_hash: evidenceHash,
    status: 'awaiting_review',
    recommendation,
    evidence_observation_ids: recommendation.evidence_ids,
    created_at: observedAt,
  });
  const discord = await (options.postReview || postResearchReview)({
    runtimeConfig: options.runtimeConfig,
    config,
    report,
    recommendation,
    evidenceHash,
    fetchImpl: options.fetchImpl,
  });
  await store.updateRecommendation(recommendation.recommendation_id, {
    discord_channel_id: discord.channelId,
    discord_message_id: discord.messageId,
  });
  return { report, recommendation, evidenceHash, discord };
}

export async function runResearchCollection(options) {
  const config = ResearchConfigSchema.parse(options.config);
  if (options.scheduled && !config.scheduling.enabled) {
    throw new Error('Automatic research scheduling is disabled in the research config.');
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
