#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

const TYPE_GRID = [
  ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock'],
  ['bug', 'ghost', 'steel', 'fire', 'water', 'grass'],
  ['electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'],
];

const DEFAULT_PADDING_PX = 18;

function groupActiveIndices(flags, maxGap = 8) {
  const groups = [];
  let start = -1;
  let end = -1;

  for (let index = 0; index < flags.length; index += 1) {
    if (!flags[index]) {
      continue;
    }

    if (start === -1) {
      start = index;
      end = index;
      continue;
    }

    if (index - end <= maxGap) {
      end = index;
      continue;
    }

    groups.push({ start, end });
    start = index;
    end = index;
  }

  if (start !== -1) {
    groups.push({ start, end });
  }

  return groups;
}

function buildAxisActivity(data, width, height, axis) {
  const axisLength = axis === 'x' ? width : height;
  const otherLength = axis === 'x' ? height : width;
  const flags = Array.from({ length: axisLength }, () => false);

  for (let primary = 0; primary < axisLength; primary += 1) {
    for (let secondary = 0; secondary < otherLength; secondary += 1) {
      const x = axis === 'x' ? primary : secondary;
      const y = axis === 'x' ? secondary : primary;
      const alpha = data[((y * width) + x) * 4 + 3];
      if (alpha > 0) {
        flags[primary] = true;
        break;
      }
    }
  }

  return flags;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function findOpaqueBounds(data, width, height, rangeX, rangeY) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = rangeY.start; y <= rangeY.end; y += 1) {
    for (let x = rangeX.start; x <= rangeX.end; x += 1) {
      const alpha = data[((y * width) + x) * 4 + 3];
      if (alpha <= 0) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error(`Could not find any opaque pixels inside cell x=${rangeX.start}-${rangeX.end}, y=${rangeY.start}-${rangeY.end}.`);
  }

  return { minX, minY, maxX, maxY };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/split-poke-quizz-type-sheet.mjs [options]',
      '',
      'Options:',
      '  --input <path>            Required transparent PNG sheet path.',
      '  --output-dir <path>       Required output directory for the split type PNGs.',
      '  --padding <px>            Extra transparent padding around each crop. Default: 18.',
      '  --clean-output            Remove the output directory before regenerating.',
    ]);
    return;
  }

  const inputPath = getStringOption(options, 'input', '');
  const outputDir = getStringOption(options, 'output-dir', '');
  if (!inputPath) {
    throw new Error('The --input option is required.');
  }
  if (!outputDir) {
    throw new Error('The --output-dir option is required.');
  }

  const absoluteInputPath = resolve(projectRoot, inputPath);
  const absoluteOutputDir = resolve(projectRoot, outputDir);
  const padding = Math.max(0, Number.parseInt(getStringOption(options, 'padding', String(DEFAULT_PADDING_PX)), 10) || DEFAULT_PADDING_PX);

  if (getBooleanOption(options, 'clean-output', false)) {
    await rm(absoluteOutputDir, { recursive: true, force: true });
  }
  await mkdir(absoluteOutputDir, { recursive: true });

  const { data, info } = await sharp(absoluteInputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const xGroups = groupActiveIndices(buildAxisActivity(data, info.width, info.height, 'x'));
  const yGroups = groupActiveIndices(buildAxisActivity(data, info.width, info.height, 'y'));

  if (xGroups.length !== TYPE_GRID[0].length) {
    throw new Error(`Expected ${TYPE_GRID[0].length} icon columns, found ${xGroups.length}.`);
  }
  if (yGroups.length !== TYPE_GRID.length) {
    throw new Error(`Expected ${TYPE_GRID.length} icon rows, found ${yGroups.length}.`);
  }

  const manifest = [];
  for (let rowIndex = 0; rowIndex < TYPE_GRID.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < TYPE_GRID[rowIndex].length; columnIndex += 1) {
      const typeName = TYPE_GRID[rowIndex][columnIndex];
      const cellBounds = findOpaqueBounds(
        data,
        info.width,
        info.height,
        xGroups[columnIndex],
        yGroups[rowIndex],
      );
      const left = clamp(cellBounds.minX - padding, 0, info.width - 1);
      const top = clamp(cellBounds.minY - padding, 0, info.height - 1);
      const right = clamp(cellBounds.maxX + padding, 0, info.width - 1);
      const bottom = clamp(cellBounds.maxY + padding, 0, info.height - 1);
      const width = right - left + 1;
      const height = bottom - top + 1;
      const outputPath = resolve(absoluteOutputDir, `${typeName}.png`);

      await sharp(absoluteInputPath)
        .extract({ left, top, width, height })
        .png()
        .toFile(outputPath);

      manifest.push({
        type: typeName,
        output_path: outputPath,
        row: rowIndex,
        column: columnIndex,
        crop: { left, top, width, height },
      });
      printInfo(`Wrote ${typeName}.png`);
    }
  }

  await writeFile(
    resolve(absoluteOutputDir, 'manifest.json'),
    `${JSON.stringify({
      source_path: absoluteInputPath,
      output_dir: absoluteOutputDir,
      padding,
      types: manifest,
    }, null, 2)}\n`,
    'utf8',
  );
  printInfo(`Wrote manifest for ${manifest.length} type PNGs.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
