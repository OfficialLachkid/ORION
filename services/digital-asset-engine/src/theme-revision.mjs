import process from 'node:process';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { discordRequest } from './discord-review.mjs';
import { prepareItchThemeCandidate } from './itch-theme.mjs';
import { postItchThemeReview } from './theme-review.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function inferReleaseVersion(productRoot, theme) {
  if (Object.hasOwn(theme, 'release_version')) return theme.release_version || null;
  const targetVersion = String(theme.target_version || '');
  if (!/^\d+\.\d+\.\d+$/u.test(targetVersion)) return null;
  const pointer = await readOptionalJson(resolve(productRoot, 'releases', targetVersion, 'latest-candidate.json'));
  return pointer?.manifest_hash === theme.manifest_hash ? targetVersion : null;
}

function revisionStatePath(productRoot) {
  return resolve(productRoot, 'review', 'itch-theme-revision.json');
}

export async function queueItchThemeRevision(options) {
  const archiveRoot = String(options.archiveRoot || '').trim();
  const productSlug = String(options.productSlug || '').trim();
  if (!archiveRoot || !productSlug) throw new Error('Theme revision queueing requires an archive root and product slug.');
  const store = options.store || new CanonicalProductStore(archiveRoot);
  const product = options.product || await store.loadProduct(productSlug);
  const productRoot = store.productRoot(product);
  const themePath = resolve(productRoot, 'review', 'itch-theme.json');
  const theme = await readJson(themePath);
  if (theme.status !== 'changes_requested'
    || theme.last_decision?.decision !== 'request_changes'
    || !String(theme.last_decision.reason || '').trim()) {
    throw new Error('A theme revision requires recorded human feedback for the current candidate.');
  }
  const statePath = revisionStatePath(productRoot);
  const previous = await readOptionalJson(statePath);
  const requestId = String(theme.last_decision.discord_interaction_id || '');
  if (previous?.request_interaction_id === requestId
    && ['queued', 'running', 'completed'].includes(previous.status)) {
    return { state: previous, statePath, reused: true };
  }
  const now = options.now || new Date().toISOString();
  const state = {
    schema_version: '1.0',
    status: 'queued',
    product_id: product.product_id,
    product_slug: product.slug,
    target_version: theme.target_version,
    release_version: await inferReleaseVersion(productRoot, theme),
    manifest_hash: theme.manifest_hash,
    listing_hash: theme.listing_hash,
    parent_theme_hash: theme.theme_hash,
    parent_candidate_path: theme.candidate_path,
    previous_design: theme.design,
    feedback: String(theme.last_decision.reason).trim(),
    reviewer_discord_id: theme.last_decision.reviewer_discord_id,
    request_interaction_id: requestId,
    revision_number: Math.max(2, Number(theme.revision?.number || 1) + 1),
    channel_id: theme.channel_id,
    discord_message_id: theme.discord_message_id,
    public_url: theme.public_url,
    storefront_stage: theme.storefront_stage,
    worker_pid: null,
    created_at: now,
    updated_at: now,
  };
  await writeJsonAtomic(statePath, state);
  return { state, statePath, reused: false };
}

async function markFailure(runtimeConfig, state, error, fetchImpl) {
  const token = runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  if (!token || !state.channel_id || !state.discord_message_id) return;
  await discordRequest(token, `/channels/${state.channel_id}/messages/${state.discord_message_id}`, {
    method: 'PATCH',
    body: {
      content: `Theme revision ${state.revision_number} stopped safely: ${String(error.message || error).split('\n')[0].slice(0, 1200)}`,
    },
    fetchImpl,
  }).catch(() => {});
}

export async function runItchThemeRevisionJob(options) {
  const statePath = resolve(String(options.statePath || ''));
  let state = await readJson(statePath);
  if (state.status === 'completed') return { ...state, statePath, reused: true };
  if (!['queued', 'running'].includes(state.status)) {
    throw new Error(`Theme revision job cannot run from status ${state.status}.`);
  }
  const productRoot = dirname(dirname(statePath));
  const archiveRoot = dirname(productRoot);
  const theme = await readJson(resolve(productRoot, 'review', 'itch-theme.json'));
  if (theme.status !== 'changes_requested' || theme.theme_hash !== state.parent_theme_hash) {
    throw new Error('Theme revision job is stale relative to the current review candidate.');
  }
  const runtimeConfig = options.runtimeConfig || {};
  const runningAt = options.now || new Date().toISOString();
  state = {
    ...state,
    status: 'running',
    worker_pid: process.pid,
    started_at: state.started_at || runningAt,
    updated_at: runningAt,
  };
  await writeJsonAtomic(statePath, state);
  try {
    const candidate = await (options.prepareTheme || prepareItchThemeCandidate)({
      outputRoot: archiveRoot,
      slug: state.product_slug,
      releaseVersion: state.release_version || undefined,
      revision: {
        number: state.revision_number,
        parent_theme_hash: state.parent_theme_hash,
        feedback: state.feedback,
        previous_design: state.previous_design,
      },
      ollamaEndpoint: runtimeConfig.env?.OLLAMA_URL || 'http://127.0.0.1:11434',
      themeModel: runtimeConfig.env?.DIGITAL_ASSET_THEME_MODEL || 'llama3.1:8b',
      profileDir: runtimeConfig.env?.ITCH_PLAYWRIGHT_PROFILE,
      env: runtimeConfig.env,
      now: options.now,
    });
    const posted = await (options.postTheme || postItchThemeReview)({
      runtimeConfig,
      outputRoot: archiveRoot,
      slug: state.product_slug,
      candidate,
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    const completedAt = options.now || new Date().toISOString();
    state = {
      ...state,
      status: 'completed',
      worker_pid: null,
      candidate_theme_hash: posted.theme_hash,
      candidate_path: posted.candidate_path,
      discord_message_id: posted.discord_message_id,
      completed_at: completedAt,
      updated_at: completedAt,
    };
    await writeJsonAtomic(statePath, state);
    return { ...state, statePath, reused: false };
  } catch (error) {
    const failedAt = options.now || new Date().toISOString();
    state = {
      ...state,
      status: 'failed',
      worker_pid: null,
      error: String(error.stack || error.message || error),
      failed_at: failedAt,
      updated_at: failedAt,
    };
    await writeJsonAtomic(statePath, state);
    await markFailure(runtimeConfig, state, error, options.fetchImpl);
    throw error;
  }
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function recoverItchThemeRevisionJobs(options) {
  const archiveRoot = String(options.archiveRoot || '').trim();
  if (!archiveRoot) return { scanned: 0, recovered: [], active: [] };
  let entries;
  try {
    entries = await readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { scanned: 0, recovered: [], active: [] };
    throw error;
  }
  const processAlive = options.processAlive || defaultProcessAlive;
  const report = { scanned: 0, recovered: [], active: [] };
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const statePath = revisionStatePath(resolve(archiveRoot, entry.name));
    const state = await readOptionalJson(statePath);
    if (!state) continue;
    report.scanned += 1;
    if (state.status === 'running' && processAlive(Number(state.worker_pid))) {
      report.active.push({ product_slug: state.product_slug, worker_pid: Number(state.worker_pid) });
      continue;
    }
    if (!['queued', 'running'].includes(state.status)) continue;
    const recoveredAt = options.now || new Date().toISOString();
    const recovered = {
      ...state,
      status: 'queued',
      worker_pid: null,
      recovery_count: Number(state.recovery_count || 0) + 1,
      recovered_at: recoveredAt,
      updated_at: recoveredAt,
      ...(state.status === 'running' ? { interrupted_at: recoveredAt } : {}),
    };
    await writeJsonAtomic(statePath, recovered);
    report.recovered.push({
      product_slug: recovered.product_slug || basename(dirname(dirname(statePath))),
      path: statePath,
      scheduled: options.scheduleJob?.(statePath) === true,
    });
  }
  return report;
}
