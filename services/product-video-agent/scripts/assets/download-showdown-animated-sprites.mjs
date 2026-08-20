#!/usr/bin/env node

import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { ORION_T7_ROOT } from '../../src/poke-quizz-asset-layout.mjs';
import { fetchSerebiiPokedex } from '../../src/pokedex-source.mjs';
import { expandPokedexRowsWithPokeApiVarieties } from '../../src/pokedex-varieties.mjs';

const DEFAULT_OUTPUT_ROOT = `${ORION_T7_ROOT}/Pokemon/Poke Quizz/new pokemon sprite gifs`;
const SHOWDOWN_NORMAL_ROOT = 'https://play.pokemonshowdown.com/sprites/ani';
const SHOWDOWN_SHINY_ROOT = 'https://play.pokemonshowdown.com/sprites/ani-shiny';

function parseGenerationList(input) {
  return [...new Set(
    String(input || '1')
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
  )].sort((left, right) => left - right);
}

function parseLimit(input) {
  if (!input) return null;
  const parsed = Number.parseInt(String(input), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function generationDirectoryName(generation) {
  return `Generation ${Number.parseInt(String(generation), 10)}`;
}

function sanitizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function formatDexNumber(value) {
  return String(Number.parseInt(String(value || 0), 10)).padStart(4, '0');
}

function buildFileName(row) {
  return `${formatDexNumber(row?.national_dex_number)}-${sanitizeToken(row?.slug)}.gif`;
}

function buildShowdownSlugCandidates(row) {
  const seedValues = [
    row?.metadata?.pokemon_api?.pokemon_name,
    row?.slug,
    row?.name,
  ]
    .map((value) => sanitizeToken(value))
    .filter(Boolean);

  const candidates = new Set();
  const queue = [...seedValues];

  function addCandidate(value) {
    const normalized = sanitizeToken(value);
    if (!normalized || candidates.has(normalized)) {
      return;
    }
    candidates.add(normalized);
    queue.push(normalized);
  }

  for (const seedValue of seedValues) {
    addCandidate(seedValue);
  }

  while (queue.length > 0) {
    const value = queue.shift();
    addCandidate(value.replace(/-mega-x$/u, '-megax'));
    addCandidate(value.replace(/-mega-y$/u, '-megay'));
    addCandidate(value.replace(/-male$/u, '-m'));
    addCandidate(value.replace(/-female$/u, '-f'));
    addCandidate(value.replace(/-standard$/u, ''));
    addCandidate(value.replace(/-ordinary$/u, ''));
    addCandidate(value.replace(/-ph-d$/u, '-phd'));
    addCandidate(value.replace(/^mega-(.+)$/u, '$1-mega'));
    addCandidate(value.replace(/^gigantamax-(.+)$/u, '$1-gmax'));
    addCandidate(value.replace(/^gmax-(.+)$/u, '$1-gmax'));
    addCandidate(value.replace(/^alolan-(.+)$/u, '$1-alola'));
    addCandidate(value.replace(/^galarian-(.+)$/u, '$1-galar'));
    addCandidate(value.replace(/^hisuian-(.+)$/u, '$1-hisui'));
    addCandidate(value.replace(/^paldean-(.+)$/u, '$1-paldea'));
    addCandidate(value.replace(/^partner-(.+)$/u, '$1-partner'));
    addCandidate(value.replace(/^totem-(.+)-alola$/u, '$1-alola-totem'));
    addCandidate(value.replace(/^totem-(.+)-galar$/u, '$1-galar-totem'));
    addCandidate(value.replace(/^totem-(.+)-hisui$/u, '$1-hisui-totem'));
    addCandidate(value.replace(/^totem-(.+)-paldea$/u, '$1-paldea-totem'));
    addCandidate(value.replace(/^totem-(.+)$/u, '$1-totem'));
    addCandidate(value.replace(/^(.+)-totem-alola$/u, '$1-alola-totem'));
    addCandidate(value.replace(/^(.+)-totem-galar$/u, '$1-galar-totem'));
    addCandidate(value.replace(/^(.+)-totem-hisui$/u, '$1-hisui-totem'));
    addCandidate(value.replace(/^(.+)-totem-paldea$/u, '$1-paldea-totem'));
    addCandidate(value.replace(/^(.+)-cap-pikachu$/u, 'pikachu-$1-cap'));
    addCandidate(value.replace(/^(.+)-cap-pikachu$/u, 'pikachu-$1cap'));
    addCandidate(value.replace(/^pikachu-(.+)-cap$/u, 'pikachu-$1cap'));
    addCandidate(value.replaceAll('-', ''));
  }

  return [...candidates].filter(Boolean);
}

async function ensureDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getFileSize(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size;
  } catch {
    return null;
  }
}

async function downloadBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`Could not download ${url} (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

async function buildGenerationRows(generation, concurrency) {
  const baseRows = await fetchSerebiiPokedex({ generation });
  const expanded = await expandPokedexRowsWithPokeApiVarieties(baseRows, {
    concurrency,
  });
  return {
    baseRowCount: baseRows.length,
    expandedRowCount: expanded.rows.length,
    rows: expanded.rows,
  };
}

async function downloadSpriteVariant({
  row,
  variant,
  outputDirectory,
  overwrite,
  sourceRoot,
}) {
  const fileName = buildFileName(row);
  const outputPath = join(outputDirectory, fileName);
  if (!overwrite) {
    const existingSize = await getFileSize(outputPath);
    if (existingSize != null) {
      return {
        file_name: fileName,
        output_path: outputPath,
        variant,
        row_slug: row?.slug || null,
        showdown_slug: null,
        source_url: null,
        file_size_bytes: existingSize,
        status: 'reused_existing_file',
      };
    }
  }

  const candidates = buildShowdownSlugCandidates(row);
  let lastError = null;
  for (const candidate of candidates) {
    const sourceUrl = `${sourceRoot}/${candidate}.gif`;
    try {
      const buffer = await downloadBuffer(sourceUrl);
      await writeFile(outputPath, buffer);
      return {
        dex_number: row?.national_dex_number || null,
        file_name: fileName,
        output_path: outputPath,
        variant,
        row_slug: row?.slug || null,
        showdown_slug: candidate,
        source_url: sourceUrl,
        file_size_bytes: buffer.byteLength,
        status: 'downloaded',
      };
    } catch (error) {
      lastError = error;
      if (Number(error?.status || 0) !== 404) {
        break;
      }
    }
  }

  return {
    dex_number: row?.national_dex_number || null,
    file_name: fileName,
    output_path: outputPath,
    variant,
    row_slug: row?.slug || null,
    showdown_slug: null,
    source_url: null,
    status: 'skipped',
    reason: lastError ? String(lastError.message || lastError) : 'no_matching_showdown_sprite',
  };
}

async function downloadGeneration({
  generation,
  outputRoot,
  overwrite,
  includeShiny,
  limit,
  concurrency,
}) {
  const generationDirectory = join(outputRoot, generationDirectoryName(generation));
  const normalDirectory = join(generationDirectory, 'normal');
  await ensureDirectory(normalDirectory);
  if (includeShiny) {
    await ensureDirectory(join(generationDirectory, 'shiny'));
  }

  const { rows, baseRowCount, expandedRowCount } = await buildGenerationRows(generation, concurrency);
  const selectedRows = limit ? rows.slice(0, limit) : rows;
  const report = [];

  for (const row of selectedRows) {
    report.push(await downloadSpriteVariant({
      row,
      variant: 'normal',
      outputDirectory: normalDirectory,
      overwrite,
      sourceRoot: SHOWDOWN_NORMAL_ROOT,
    }));

    if (includeShiny) {
      report.push(await downloadSpriteVariant({
        row,
        variant: 'shiny',
        outputDirectory: join(generationDirectory, 'shiny'),
        overwrite,
        sourceRoot: SHOWDOWN_SHINY_ROOT,
      }));
    }
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    generation,
    output_directory: generationDirectory,
    output_root: outputRoot,
    include_shiny: includeShiny,
    source_catalog: {
      base_rows: baseRowCount,
      expanded_rows: expandedRowCount,
    },
    source_roots: {
      normal: SHOWDOWN_NORMAL_ROOT,
      shiny: includeShiny ? SHOWDOWN_SHINY_ROOT : null,
    },
    counts: {
      rows_processed: selectedRows.length,
      downloaded_files: report.filter((entry) => entry.status === 'downloaded').length,
      reused_existing_files: report.filter((entry) => entry.status === 'reused_existing_file').length,
      skipped_files: report.filter((entry) => entry.status === 'skipped').length,
    },
    entries: report,
  };
  const manifestPath = join(generationDirectory, '_source-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    generation,
    generationDirectory,
    manifestPath,
    counts: manifest.counts,
  };
}

export {
  DEFAULT_OUTPUT_ROOT,
  SHOWDOWN_NORMAL_ROOT,
  SHOWDOWN_SHINY_ROOT,
  buildFileName,
  buildShowdownSlugCandidates,
  downloadGeneration,
  generationDirectoryName,
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/assets/download-showdown-animated-sprites.mjs [options]',
      '',
      'Options:',
      '  --generation <list>      Comma-separated generations to download. Default: 1',
      '  --output-root <path>     T7 output root. Default: /Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/new pokemon sprite gifs',
      '  --include-shiny          Also download animated shiny GIFs into a sibling shiny folder',
      '  --overwrite              Replace existing files instead of reusing them',
      '  --limit <n>              Limit processed rows per generation',
      '  --concurrency <n>        PokeAPI variety expansion concurrency. Default: 6',
    ]);
    process.exit(0);
  }

  const generations = parseGenerationList(getStringOption(options, 'generation', '1'));
  const outputRoot = getStringOption(options, 'output-root', DEFAULT_OUTPUT_ROOT);
  const includeShiny = getBooleanOption(options, 'include-shiny', false);
  const overwrite = getBooleanOption(options, 'overwrite', false);
  const limit = parseLimit(getStringOption(options, 'limit', ''));
  const concurrency = Number.parseInt(getStringOption(options, 'concurrency', '6'), 10) || 6;
  const results = [];

  for (const generation of generations) {
    const result = await downloadGeneration({
      generation,
      outputRoot,
      overwrite,
      includeShiny,
      limit,
      concurrency,
    });
    printInfo(
      `Downloaded animated Showdown sprites for Gen ${generation}: `
      + `${result.counts.downloaded_files} downloaded, `
      + `${result.counts.reused_existing_files} reused, `
      + `${result.counts.skipped_files} skipped.`,
    );
    results.push(result);
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}
