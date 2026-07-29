#!/usr/bin/env node

import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { createHeaders, fetchJson, getRuntimeApiKey } from '../../../scripts/lib/supabase-bridge-api.mjs';
import { fetchSerebiiPokedex } from '../src/pokedex-source.mjs';
import {
  buildPokeQuizzShinySpritePath,
  buildPokeQuizzSilhouettePath,
  buildPokeQuizzSpritePath,
  buildPokeQuizzTypeIconPath,
  POKE_QUIZZ_ASSET_LAYOUT,
} from '../src/poke-quizz-asset-layout.mjs';
import { runLocalProcess } from '../src/process-runner.mjs';
import { resolveFfmpegExecutable } from '../src/runtime-executables.mjs';

function parseGenerationList(input) {
  return String(input || '1')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${url} (${response.status}).`);
  }
  await ensureDirectory(outputPath);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

async function fetchPokeApiSpriteMetadata(nationalDexNumber) {
  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${nationalDexNumber}`);
  if (!response.ok) {
    throw new Error(`Could not fetch PokeAPI sprite metadata for #${nationalDexNumber} (${response.status}).`);
  }
  const payload = await response.json();
  return {
    shinySpriteSourceUrl: payload?.sprites?.front_shiny || null,
    crySourceUrl: payload?.cries?.latest || payload?.cries?.legacy || null,
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

  const typeIconCount = await ensureTypeIcons(targetRows);

  for (const row of targetRows) {
    const spritePath = buildPokeQuizzSpritePath(row);
    const shinySpritePath = buildPokeQuizzShinySpritePath(row);
    const silhouettePath = buildPokeQuizzSilhouettePath(row);
    const spriteMetadata = await fetchPokeApiSpriteMetadata(row.national_dex_number);

    if (!row.sprite_source_url) {
      report.push({ id: row.id, status: 'skipped', reason: 'sprite_source_url_missing' });
      continue;
    }

    if (!(await fileExists(spritePath))) {
      await downloadToFile(row.sprite_source_url, spritePath);
    }

    if (spriteMetadata.shinySpriteSourceUrl && !(await fileExists(shinySpritePath))) {
      await downloadToFile(spriteMetadata.shinySpriteSourceUrl, shinySpritePath);
    }

    if (!(await fileExists(silhouettePath))) {
      await createSilhouetteFromSprite(spritePath, silhouettePath, ffmpegExecutable);
    }

    row.sprite_path = spritePath;
    row.shiny_sprite_path = spriteMetadata.shinySpriteSourceUrl ? shinySpritePath : null;
    row.silhouette_path = silhouettePath;
    row.shiny_sprite_source_url = spriteMetadata.shinySpriteSourceUrl;
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
      },
    };
    report.push({
      id: row.id,
      generation: row.generation,
      sprite_path: row.sprite_path,
      shiny_sprite_path: row.shiny_sprite_path,
      silhouette_path: row.silhouette_path,
      cry_source_url: row.cry_source_url,
      status: 'localized',
    });
  }

  return { rows: targetRows, report, typeIconCount };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/localize-poke-quizz-assets.mjs [options]',
      '',
      'Options:',
      '  --generations <csv>       Generations to fetch and localize. Default: 1,2',
      '  --persist-supabase        Upsert localized rows back into Supabase `pokedex`',
      '  --limit <n>               Optional row limit for testing',
      '  --write-json <path>       Write a localization report JSON under the repo root',
    ]);
    process.exit(0);
  }

  const runtimeConfig = loadRuntimeConfig();
  const runtimeEnv = Object.fromEntries(
    Object.entries(runtimeConfig.env || {}).map(([key, value]) => [key, parseDotEnvValue(value)]),
  );
  const generations = parseGenerationList(getStringOption(options, 'generations', '1,2'));
  const rows = [];
  for (const generation of generations) {
    const fetched = await fetchSerebiiPokedex({ generation });
    rows.push(...fetched);
    printInfo(`Fetched ${fetched.length} Pokedex row(s) for generation ${generation}.`);
  }

  const localized = await localizeRows(rows, {
    limit: getStringOption(options, 'limit', ''),
  });
  printInfo(`Localized ${localized.report.length} Pokemon row(s) and ${localized.typeIconCount} type icon(s).`);

  if (getBooleanOption(options, 'persist-supabase', false)) {
    const upserted = await upsertPokedexRows(localized.rows, runtimeEnv);
    printInfo(`Upserted ${Array.isArray(upserted) ? upserted.length : localized.rows.length} localized row(s) into pokedex.`);
  }

  const outputPath = getStringOption(options, 'write-json', '');
  if (outputPath) {
    const absoluteOutputPath = resolve(projectRoot, outputPath);
    await ensureDirectory(absoluteOutputPath);
    await writeFile(absoluteOutputPath, `${JSON.stringify({
      generated_at: new Date().toISOString(),
      generations,
      type_icons_localized: localized.typeIconCount,
      localized_rows: localized.report,
    }, null, 2)}\n`, 'utf8');
    printInfo(`Wrote localization report to ${absoluteOutputPath}`);
  }
}
