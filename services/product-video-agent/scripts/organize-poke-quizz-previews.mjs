#!/usr/bin/env node

import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../src/poke-quizz-asset-layout.mjs';

function parseKeepCount(value) {
  const parsed = Number.parseInt(String(value || '2'), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
}

async function listPreviewMp4FilesSortedByModifiedTime(directoryPath) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .filter((entry) => entry.name.toLowerCase().endsWith('.mp4'))
        .map(async (entry) => {
          const filePath = resolve(directoryPath, entry.name);
          const details = await stat(filePath);
          return {
            file_path: filePath,
            modified_time_ms: details.mtimeMs,
          };
        }),
    );
    return files
      .sort((left, right) => right.modified_time_ms - left.modified_time_ms)
      .map((item) => item.file_path);
  } catch {
    return [];
  }
}

async function moveOlderPreviewFiles({ previewsDirectory, archiveDirectory, keepCount }) {
  await mkdir(archiveDirectory, { recursive: true });
  const previewFiles = await listPreviewMp4FilesSortedByModifiedTime(previewsDirectory);
  const kept = previewFiles.slice(0, keepCount);
  const archived = [];

  for (const filePath of previewFiles.slice(keepCount)) {
    const targetPath = resolve(archiveDirectory, basename(filePath));
    await rename(filePath, targetPath);
    archived.push(targetPath);
  }

  return {
    kept,
    archived,
    archive_directory: archiveDirectory,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/organize-poke-quizz-previews.mjs [options]',
      '',
      'Options:',
      '  --previews-dir <path>     Override the previews directory',
      '  --archive-dir <path>      Override the archive directory',
      '  --keep <n>                Keep the N most recent MP4 previews in root. Default: 2',
    ]);
    process.exit(0);
  }

  const previewsDirectory = resolve(
    projectRoot,
    getStringOption(options, 'previews-dir', POKE_QUIZZ_ASSET_LAYOUT.previews),
  );
  const archiveDirectory = resolve(
    projectRoot,
    getStringOption(options, 'archive-dir', `${POKE_QUIZZ_ASSET_LAYOUT.previews}/Older Generated Videos`),
  );
  const result = await moveOlderPreviewFiles({
    previewsDirectory,
    archiveDirectory,
    keepCount: parseKeepCount(getStringOption(options, 'keep', '2')),
  });

  printInfo(`Kept ${result.kept.length} recent preview(s) in ${previewsDirectory}.`);
  printInfo(`Archived ${result.archived.length} preview(s) into ${archiveDirectory}.`);
  for (const filePath of result.kept) {
    printInfo(`Keep: ${filePath}`);
  }
  for (const filePath of result.archived) {
    printInfo(`Archive: ${filePath}`);
  }
}
