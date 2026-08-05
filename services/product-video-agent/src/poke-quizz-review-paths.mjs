import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';

const PREFERRED_POKE_QUIZZ_CATALOG_CANDIDATES = Object.freeze([
  'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
  'data/runtime/product-video-agent/pokedex/gen1-gen8-localized.json',
  'data/runtime/product-video-agent/pokedex/gen1-gen7-localized.json',
  'data/runtime/product-video-agent/pokedex/gen1-gen6-localized.json',
]);

const POKE_QUIZZ_CATALOG_BUILD_PLANS = Object.freeze([
  Object.freeze({
    output: 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
    sources: [
      'data/runtime/product-video-agent/pokedex/gen1-gen7-localized.json',
      'data/runtime/product-video-agent/pokedex/gen8-localized.json',
      'data/runtime/product-video-agent/pokedex/gen9-localized.json',
    ],
  }),
  Object.freeze({
    output: 'data/runtime/product-video-agent/pokedex/gen1-gen8-localized.json',
    sources: [
      'data/runtime/product-video-agent/pokedex/gen1-gen7-localized.json',
      'data/runtime/product-video-agent/pokedex/gen8-localized.json',
    ],
  }),
]);

function normalizeStoredPath(value) {
  return String(value || '').trim();
}

async function mergeLocalizedCatalogs(sourcePaths = [], outputPath = '') {
  const absoluteSourcePaths = sourcePaths.map((relativePath) => resolve(projectRoot, relativePath));
  const payloads = await Promise.all(
    absoluteSourcePaths.map((filePath) => readFile(filePath, 'utf8').then(JSON.parse)),
  );
  const byId = new Map();
  for (const rows of payloads) {
    for (const row of rows) {
      byId.set(row.id, row);
    }
  }
  const mergedRows = [...byId.values()].sort((left, right) => {
    const dexDelta = Number(left.national_dex_number || 0) - Number(right.national_dex_number || 0);
    if (dexDelta !== 0) {
      return dexDelta;
    }
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  const absoluteOutputPath = resolve(projectRoot, outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(mergedRows, null, 2)}\n`, 'utf8');
  return outputPath;
}

export function resolvePreferredPokeQuizzCatalogJsonPath() {
  return PREFERRED_POKE_QUIZZ_CATALOG_CANDIDATES.find(
    (relativePath) => existsSync(resolve(projectRoot, relativePath)),
  ) || '';
}

export async function ensurePreferredPokeQuizzCatalogJsonPath() {
  const existing = resolvePreferredPokeQuizzCatalogJsonPath();
  if (existing === 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json') {
    return existing;
  }

  for (const plan of POKE_QUIZZ_CATALOG_BUILD_PLANS) {
    if (existsSync(resolve(projectRoot, plan.output))) {
      return plan.output;
    }
    const canBuild = plan.sources.every((relativePath) => existsSync(resolve(projectRoot, relativePath)));
    if (!canBuild) {
      continue;
    }
    return mergeLocalizedCatalogs(plan.sources, plan.output);
  }

  return existing;
}

export function resolveStoredPokeQuizzReviewPaths(publication = {}) {
  const metadata = publication?.metadata || {};
  return {
    planPath: normalizeStoredPath(metadata.review_plan_path || metadata.plan_path),
    catalogJsonPath: normalizeStoredPath(metadata.review_catalog_json_path || metadata.catalog_json_path),
    templatePath: normalizeStoredPath(metadata.review_template_path || metadata.template_path),
    configPath: normalizeStoredPath(metadata.review_config_path || metadata.config_path),
  };
}

export async function resolvePokeQuizzReviewTaskPaths(publication = {}) {
  const storedPaths = resolveStoredPokeQuizzReviewPaths(publication);
  if (storedPaths.catalogJsonPath) {
    return storedPaths;
  }

  const fallbackCatalogJsonPath = await ensurePreferredPokeQuizzCatalogJsonPath();
  return {
    ...storedPaths,
    catalogJsonPath: fallbackCatalogJsonPath,
  };
}

export function buildPersistedPokeQuizzReviewPathPatch({
  planPath = '',
  catalogJsonPath = '',
  templatePath = '',
  configPath = '',
} = {}) {
  return {
    review_plan_path: normalizeStoredPath(planPath),
    review_catalog_json_path: normalizeStoredPath(catalogJsonPath),
    review_template_path: normalizeStoredPath(templatePath),
    review_config_path: normalizeStoredPath(configPath),
  };
}
