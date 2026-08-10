#!/usr/bin/env node

import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { createHeaders, fetchJson, getRuntimeApiKey } from '../../../../scripts/lib/supabase-bridge-api.mjs';
import { enrichPokedexRows } from '../../src/pokedex-enrichment.mjs';
import { fetchSerebiiPokedex } from '../../src/pokedex-source.mjs';
import { expandPokedexRowsWithPokeApiVarieties } from '../../src/pokedex-varieties.mjs';
import {
  buildPokeQuizzShinySpritePath,
  buildPokeQuizzSilhouettePath,
  buildPokeQuizzSpritePath,
  buildPokeQuizzTypeIconPath,
  POKE_QUIZZ_ASSET_LAYOUT,
} from '../../src/poke-quizz-asset-layout.mjs';
import { resolvePreferredShinySpriteSourceUrl } from '../../src/pokemon-db-shiny-sprites.mjs';
import { runLocalProcess } from '../../src/process-runner.mjs';
import { resolveFfmpegExecutable } from '../../src/runtime-executables.mjs';

function parseGenerationList(input) {
  return String(input || '1,2,3,4,5,6,7,8,9')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function buildLocalizedRowsOutputPath(generations = []) {
  const orderedGenerations = [...new Set(
    (Array.isArray(generations) ? generations : [])
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
  )].sort((left, right) => left - right);

  if (orderedGenerations.length === 0) {
    return 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json';
  }

  if (orderedGenerations.length === 1) {
    return `data/runtime/product-video-agent/pokedex/gen${orderedGenerations[0]}-localized.json`;
  }

  const isContiguous = orderedGenerations.every((generation, index) => (
    index === 0 || generation === (orderedGenerations[index - 1] + 1)
  ));
  if (isContiguous) {
    return `data/runtime/product-video-agent/pokedex/gen${orderedGenerations[0]}-gen${orderedGenerations.at(-1)}-localized.json`;
  }

  return `data/runtime/product-video-agent/pokedex/${orderedGenerations.map((generation) => `gen${generation}`).join('-')}-localized.json`;
}

function parseDotEnvValue(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function ensureDirectory(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function writeJsonFile(outputPath, payload) {
  const absoluteOutputPath = resolve(projectRoot, outputPath);
  await ensureDirectory(absoluteOutputPath);
  await writeFile(absoluteOutputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return absoluteOutputPath;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url, outputPath, options = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${url} (${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const shouldConvertToPng = Boolean(
    options.ffmpegExecutable
    && String(outputPath || '').toLowerCase().endsWith('.png')
    && (
      contentType.includes('image/jpeg')
      || /\.jpe?g(?:$|\?)/iu.test(String(url || ''))
    )
  );

  if (shouldConvertToPng) {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'poke-quizz-shiny-'));
    const temporaryInputPath = join(temporaryDirectory, 'downloaded-image.jpg');
    await writeFile(temporaryInputPath, buffer);
    await ensureDirectory(outputPath);
    try {
      await runLocalProcess({
        executable: options.ffmpegExecutable,
        args: [
          '-y',
          '-i',
          temporaryInputPath,
          '-frames:v',
          '1',
          outputPath,
        ],
        timeoutMs: 120000,
      });
      return;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  await ensureDirectory(outputPath);
  await writeFile(outputPath, buffer);
}

async function fetchPokeApiSpriteMetadata(row) {
  const pokemonLookupKey = row?.metadata?.pokemon_api?.pokemon_id
    || row?.slug
    || row?.national_dex_number;
  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(String(pokemonLookupKey))}`);
  if (!response.ok) {
    throw new Error(`Could not fetch PokeAPI sprite metadata for ${pokemonLookupKey} (${response.status}).`);
  }
  const payload = await response.json();
  return {
    preferredShinySpriteSourceUrl: resolvePreferredShinySpriteSourceUrl(payload, row),
    crySourceUrl: payload?.cries?.latest || payload?.cries?.legacy || null,
  };
}

async function localizeOptionalAsset(sourceUrls, outputPath, options = {}) {
  const overwrite = options.overwrite === true;
  const existing = await fileExists(outputPath);
  if (existing && !overwrite) {
    return {
      localized: true,
      reusedExistingFile: true,
      sourceUrl: null,
    };
  }

  let lastError = null;
  for (const sourceUrl of sourceUrls.filter(Boolean)) {
    try {
      await downloadToFile(sourceUrl, outputPath, {
        ffmpegExecutable: options.ffmpegExecutable,
      });
      return {
        localized: true,
        reusedExistingFile: false,
        sourceUrl,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    localized: existing,
    reusedExistingFile: existing,
    sourceUrl: null,
    error: lastError ? String(lastError.message || lastError) : null,
  };
}

async function ensureTypeIcons(rows) {
  const seen = new Map();
  for (const row of rows) {
    const types = row.types || [];
    const iconUrls = row.metadata?.type_icon_source_urls || [];
    for (let index = 0; index < types.length; index += 1) {
      const typeName = types[index];
      const sourceUrl = iconUrls[index];
      if (!typeName || !sourceUrl) continue;
      if (!seen.has(typeName)) {
        seen.set(typeName, sourceUrl);
      }
    }
  }

  for (const [typeName, sourceUrl] of seen.entries()) {
    const targetPath = buildPokeQuizzTypeIconPath(typeName);
    if (await fileExists(targetPath)) continue;
    await downloadToFile(sourceUrl, targetPath);
  }

  return seen.size;
}

async function createSilhouetteFromSprite(spritePath, silhouettePath, ffmpegExecutable) {
  await ensureDirectory(silhouettePath);
  await runLocalProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      '-i',
      spritePath,
      '-vf',
      'format=rgba,lutrgb=r=0:g=0:b=0',
      '-frames:v',
      '1',
      silhouettePath,
    ],
    timeoutMs: 120000,
  });
}

async function upsertPokedexRows(rows, runtimeEnv, table = 'pokedex') {
  const supabaseUrl = runtimeEnv.SUPABASE_URL || '';
  const apiKey = getRuntimeApiKey(runtimeEnv);
  if (!supabaseUrl || !apiKey) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set('on_conflict', 'id');
  return fetchJson(url.toString(), {
    method: 'POST',
    headers: createHeaders(apiKey, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(rows),
  });
}

function parseLimit(value) {
  if (!value) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function localizeRows(rows, options = {}) {
  const ffmpegExecutable = options.ffmpegExecutable || resolveFfmpegExecutable({});
  const limit = parseLimit(options.limit);
  const overwriteShinySprites = options.overwriteShinySprites === true;
  const targetRows = limit ? rows.slice(0, limit) : rows;
  const report = [];

  await mkdir(POKE_QUIZZ_ASSET_LAYOUT.backgrounds, { recursive: true });
  await mkdir(POKE_QUIZZ_ASSET_LAYOUT.sprites, { recursive: true });
  await mkdir(POKE_QUIZZ_ASSET_LAYOUT.shinySprites, { recursive: true });
  await mkdir(POKE_QUIZZ_ASSET_LAYOUT.silhouettes, { recursive: true });
  await mkdir(POKE_QUIZZ_ASSET_LAYOUT.pixelTypes, { recursive: true });
  await mkdir(POKE_QUIZZ_ASSET_LAYOUT.threeDTypes, { recursive: true });
  await mkdir(POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic, { recursive: true });
  await mkdir(POKE_QUIZZ_ASSET_LAYOUT.soundEffects, { recursive: true });

  const enrichment = await enrichPokedexRows(targetRows, {
    concurrency: options.enrichmentConcurrency ?? 6,
  });
  const typeIconCount = await ensureTypeIcons(targetRows);

  for (const row of targetRows) {
    const spritePath = buildPokeQuizzSpritePath(row);
    const shinySpritePath = buildPokeQuizzShinySpritePath(row);
    const silhouettePath = buildPokeQuizzSilhouettePath(row);
    const spriteMetadata = await fetchPokeApiSpriteMetadata(row);
    const shinySpriteSourceCandidates = [spriteMetadata.preferredShinySpriteSourceUrl].filter(Boolean);

    if (!row.sprite_source_url) {
      report.push({ id: row.id, status: 'skipped', reason: 'sprite_source_url_missing' });
      continue;
    }

    if (!(await fileExists(spritePath))) {
      await downloadToFile(row.sprite_source_url, spritePath, { ffmpegExecutable });
    }

    const localizedShinySprite = await localizeOptionalAsset(
      shinySpriteSourceCandidates,
      shinySpritePath,
      {
        overwrite: overwriteShinySprites,
        ffmpegExecutable,
      },
    );

    if (!(await fileExists(silhouettePath))) {
      await createSilhouetteFromSprite(spritePath, silhouettePath, ffmpegExecutable);
    }

    row.sprite_path = spritePath;
    row.shiny_sprite_path = localizedShinySprite.localized ? shinySpritePath : null;
    row.silhouette_path = silhouettePath;
    row.shiny_sprite_source_url = localizedShinySprite.sourceUrl || row.shiny_sprite_source_url || null;
    row.cry_source_url = row.cry_source_url || spriteMetadata.crySourceUrl;
    row.asset_status = row.shiny_sprite_path
      ? 'localized_with_shiny_and_silhouette'
      : 'localized_with_silhouette';
    row.metadata = {
      ...(row.metadata || {}),
      localized_asset_roots: {
        sprites: POKE_QUIZZ_ASSET_LAYOUT.sprites,
        shiny_sprites: POKE_QUIZZ_ASSET_LAYOUT.shinySprites,
        silhouettes: POKE_QUIZZ_ASSET_LAYOUT.silhouettes,
        pixel_types: POKE_QUIZZ_ASSET_LAYOUT.pixelTypes,
        three_d_types: POKE_QUIZZ_ASSET_LAYOUT.threeDTypes,
      },
      asset_localization: {
        localized_at: new Date().toISOString(),
        silhouette_generation: 'ffmpeg_black_fill_from_sprite_alpha',
        type_icons_localized: true,
        shiny_sprite_overwrite_enabled: overwriteShinySprites,
      },
    };
    report.push({
      id: row.id,
      generation: row.generation,
      sprite_path: row.sprite_path,
      shiny_sprite_path: row.shiny_sprite_path,
      shiny_sprite_source_url: row.shiny_sprite_source_url,
      silhouette_path: row.silhouette_path,
      cry_source_url: row.cry_source_url,
      status: 'localized',
    });
  }

  return {
    rows: targetRows,
    report,
    typeIconCount,
    enrichment: enrichment.stats,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/localize-poke-quizz-assets.mjs [options]',
      '',
      'Options:',
      '  --generations <csv>       Generations to fetch and localize. Default: 1,2,3,4,5,6,7,8,9',
      '  --skip-form-expansion     Keep only the base Serebii species rows and skip PokeAPI variety expansion',
      '  --persist-supabase        Upsert localized rows back into Supabase `pokedex`',
      '  --limit <n>               Optional row limit for testing',
      '  --form-expansion-concurrency <n> Concurrent PokeAPI variety workers. Default: 6',
      '  --enrichment-concurrency <n> Concurrent PokeAPI species enrichment workers. Default: 6',
      '  --overwrite-shiny-sprites Replace existing shiny sprite files with the current source set',
      '  --write-json <path>       Write a localization report JSON under the repo root',
      '  --write-rows-json <path>  Write planner-ready localized pokedex rows under the repo root.',
      '                           Default: a generation-derived runtime catalog path such as',
      '                           data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
    ]);
    process.exit(0);
  }

  const runtimeConfig = loadRuntimeConfig();
  const runtimeEnv = Object.fromEntries(
    Object.entries(runtimeConfig.env || {}).map(([key, value]) => [key, parseDotEnvValue(value)]),
  );
  const generations = parseGenerationList(getStringOption(options, 'generations', '1,2,3,4,5,6,7,8,9'));
  const rows = [];
  for (const generation of generations) {
    const fetched = await fetchSerebiiPokedex({ generation });
    rows.push(...fetched);
    printInfo(`Fetched ${fetched.length} Pokedex row(s) for generation ${generation}.`);
  }

  let formExpandedRows = rows;
  if (!getBooleanOption(options, 'skip-form-expansion', false)) {
    const expanded = await expandPokedexRowsWithPokeApiVarieties(rows, {
      concurrency: Number.parseInt(
        getStringOption(options, 'form-expansion-concurrency', '6'),
        10,
      ) || 6,
    });
    formExpandedRows = expanded.rows;
    printInfo(
      `Expanded ${expanded.stats.baseRows} base Pokedex row(s) into ${expanded.stats.expandedRows} form-aware row(s) `
      + `using ${expanded.stats.speciesRequests} species request(s), `
      + `${expanded.stats.pokemonRequests} Pokemon request(s), and `
      + `${expanded.stats.formRequests} form request(s).`,
    );
  }

  const localized = await localizeRows(formExpandedRows, {
    limit: getStringOption(options, 'limit', ''),
    enrichmentConcurrency: Number.parseInt(
      getStringOption(options, 'enrichment-concurrency', '6'),
      10,
    ) || 6,
    overwriteShinySprites: getBooleanOption(options, 'overwrite-shiny-sprites', false),
  });
  printInfo(
    `Localized ${localized.report.length} Pokemon row(s), `
    + `${localized.typeIconCount} type icon(s), `
    + `${localized.enrichment.speciesRequests} species request(s), and `
    + `${localized.enrichment.evolutionChainRequests} evolution chain request(s).`,
  );

  if (getBooleanOption(options, 'persist-supabase', false)) {
    const upserted = await upsertPokedexRows(localized.rows, runtimeEnv);
    printInfo(`Upserted ${Array.isArray(upserted) ? upserted.length : localized.rows.length} localized row(s) into pokedex.`);
  }

  const rowsOutputPath = getStringOption(
    options,
    'write-rows-json',
    buildLocalizedRowsOutputPath(generations),
  );
  const absoluteRowsOutputPath = await writeJsonFile(rowsOutputPath, localized.rows);
  printInfo(`Wrote localized pokedex rows to ${absoluteRowsOutputPath}`);

  const outputPath = getStringOption(options, 'write-json', '');
  if (outputPath) {
    const absoluteOutputPath = await writeJsonFile(outputPath, {
      generated_at: new Date().toISOString(),
      generations,
      type_icons_localized: localized.typeIconCount,
      species_requests: localized.enrichment.speciesRequests,
      evolution_chain_requests: localized.enrichment.evolutionChainRequests,
      localized_rows: localized.report,
    });
    printInfo(`Wrote localization report to ${absoluteOutputPath}`);
  }
}
