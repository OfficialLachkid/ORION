#!/usr/bin/env node

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { ORION_T7_ROOT } from '../../src/poke-quizz-asset-layout.mjs';
import { resolvePreferredSpriteSourceUrl } from '../../src/pokemon-db-shiny-sprites.mjs';

const DEFAULT_SOURCE_ROOT = `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Sprites`;
const DEFAULT_OUTPUT_ROOT = `${ORION_T7_ROOT}/Pokemon/Poke Quizz/new pokemon sprites`;
const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2';

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

function parseSpriteFileName(fileName) {
  const extension = extname(fileName).toLowerCase();
  const stem = basename(fileName, extension);
  const match = /^(\d{4})-(.+)$/u.exec(stem);
  if (!match) {
    return null;
  }
  return {
    dexNumber: Number.parseInt(match[1], 10),
    slug: match[2],
    fileName,
  };
}

async function ensureDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
}

async function listSpriteFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.png')
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url} (${response.status}).`);
  }
  return response.json();
}

async function downloadBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${url} (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function getFileSize(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size;
  } catch {
    return null;
  }
}

async function downloadGeneration({
  generation,
  sourceRoot,
  outputRoot,
  overwrite,
  limit,
}) {
  const generationDirectory = generationDirectoryName(generation);
  const sourceDirectory = join(sourceRoot, generationDirectory);
  const outputDirectory = join(outputRoot, generationDirectory);
  await ensureDirectory(outputDirectory);

  const sourceFiles = await listSpriteFiles(sourceDirectory);
  const selectedFiles = limit ? sourceFiles.slice(0, limit) : sourceFiles;
  const report = [];

  for (const sourceFile of selectedFiles) {
    const parsed = parseSpriteFileName(sourceFile);
    if (!parsed?.dexNumber) {
      report.push({
        file_name: sourceFile,
        status: 'skipped',
        reason: 'unrecognized_filename',
      });
      continue;
    }

    const outputPath = join(outputDirectory, sourceFile);
    if (!overwrite) {
      const existingSize = await getFileSize(outputPath);
      if (existingSize != null) {
        report.push({
          dex_number: parsed.dexNumber,
          slug: parsed.slug,
          file_name: sourceFile,
          output_path: outputPath,
          source_url: null,
          file_size_bytes: existingSize,
          status: 'reused_existing_file',
        });
        continue;
      }
    }

    const payload = await fetchJson(`${POKEAPI_BASE_URL}/pokemon/${parsed.dexNumber}`);
    const sourceUrl = resolvePreferredSpriteSourceUrl(payload, { slug: parsed.slug });
    if (!sourceUrl) {
      report.push({
        dex_number: parsed.dexNumber,
        slug: parsed.slug,
        file_name: sourceFile,
        output_path: outputPath,
        source_url: null,
        status: 'skipped',
        reason: 'no_pokeapi_sprite_source',
      });
      continue;
    }

    const buffer = await downloadBuffer(sourceUrl);
    await writeFile(outputPath, buffer);
    report.push({
      dex_number: parsed.dexNumber,
      slug: parsed.slug,
      file_name: sourceFile,
      output_path: outputPath,
      source_url: sourceUrl,
      file_size_bytes: buffer.byteLength,
      status: 'downloaded',
    });
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    generation,
    source_directory: sourceDirectory,
    output_directory: outputDirectory,
    output_root: outputRoot,
    source_priority: [
      'pokeapi.sprites.other.home.front_default',
      'pokeapi.sprites.other.official-artwork.front_default',
      'pokeapi.sprites.front_default',
    ],
    counts: {
      source_files: sourceFiles.length,
      processed_files: selectedFiles.length,
      downloaded_files: report.filter((entry) => entry.status === 'downloaded').length,
      reused_existing_files: report.filter((entry) => entry.status === 'reused_existing_file').length,
      skipped_files: report.filter((entry) => entry.status === 'skipped').length,
    },
    entries: report,
  };
  const manifestPath = join(outputDirectory, '_source-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    generation,
    sourceDirectory,
    outputDirectory,
    manifestPath,
    counts: manifest.counts,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/assets/download-pokeapi-normal-sprites.mjs [options]',
      '',
      'Options:',
      '  --generations <csv>     Generation list to mirror from the current sprite folder. Default: 1',
      '  --source-root <path>    Existing sprite root to mirror names from.',
      `                         Default: ${DEFAULT_SOURCE_ROOT}`,
      '  --output-root <path>    Parallel destination root for the new sharper sprites.',
      `                         Default: ${DEFAULT_OUTPUT_ROOT}`,
      '  --limit <n>             Optional file limit for testing.',
      '  --overwrite             Replace existing files in the destination folder.',
    ]);
    process.exit(0);
  }

  const generations = parseGenerationList(getStringOption(options, 'generations', '1'));
  const sourceRoot = getStringOption(options, 'source-root', DEFAULT_SOURCE_ROOT);
  const outputRoot = getStringOption(options, 'output-root', DEFAULT_OUTPUT_ROOT);
  const overwrite = getBooleanOption(options, 'overwrite', false);
  const limit = parseLimit(getStringOption(options, 'limit', ''));

  for (const generation of generations) {
    const result = await downloadGeneration({
      generation,
      sourceRoot,
      outputRoot,
      overwrite,
      limit,
    });
    printInfo(
      `Generation ${generation}: downloaded ${result.counts.downloaded_files}, `
      + `reused ${result.counts.reused_existing_files}, skipped ${result.counts.skipped_files}. `
      + `Manifest: ${result.manifestPath}`,
    );
  }
}
