#!/usr/bin/env node

import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../../src/poke-quizz-asset-layout.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

const DEFAULT_CIRCLE_INSET_PX = 8;

function isPngFile(fileName) {
  return String(fileName || '').toLowerCase().endsWith('.png') && !basename(fileName).startsWith('.');
}

function buildCircleSvg(width, height, insetPx) {
  const radius = Math.max(1, (Math.min(width, height) / 2) - insetPx);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      + `<circle cx="${width / 2}" cy="${height / 2}" r="${radius}" fill="#FFFFFF"/>`
      + '</svg>',
    'utf8',
  );
}

async function listBadgeFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isPngFile(entry.name))
    .map((entry) => resolve(directoryPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function bakeOpaqueCircleIntoBadge(filePath, backupRoot, insetPx, dryRun) {
  const image = sharp(filePath).ensureAlpha();
  const metadata = await image.metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) {
    throw new Error(`Could not resolve image dimensions for ${filePath}.`);
  }

  const backupPath = resolve(backupRoot, basename(filePath));
  if (!dryRun) {
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(filePath, backupPath);
  }

  const output = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    {
      input: buildCircleSvg(width, height, insetPx),
      left: 0,
      top: 0,
      blend: 'over',
    },
    {
      input: await image.png().toBuffer(),
      left: 0,
      top: 0,
      blend: 'over',
    },
  ]);

  if (!dryRun) {
    await output.png().toFile(filePath);
  }

  return {
    filePath,
    backupPath,
    width,
    height,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/bake-poke-quizz-badge-circles.mjs [options]',
      '',
      'Options:',
      '  --style-dir <path>        Badge-style directory. Default: Poke Quizz 3D Types/badge-style',
      '  --circle-inset <px>       Transparent edge around the white circle. Default: 8.',
      '  --backup-dir <path>       Backup directory. Default: <style-dir>/.backup-opaque-circle/<timestamp>',
      '  --dry-run                 Report the files that would be rewritten without changing them.',
    ]);
    return;
  }

  const styleDir = getStringOption(
    options,
    'style-dir',
    `${POKE_QUIZZ_ASSET_LAYOUT.threeDTypes}/badge-style`,
  );
  const insetPx = Math.max(0, Number.parseInt(getStringOption(options, 'circle-inset', String(DEFAULT_CIRCLE_INSET_PX)), 10) || DEFAULT_CIRCLE_INSET_PX);
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const backupDir = getStringOption(
    options,
    'backup-dir',
    `${styleDir}/.backup-opaque-circle/${new Date().toISOString().replace(/[:.]/gu, '-')}`,
  );

  const files = await listBadgeFiles(styleDir);
  if (!files.length) {
    throw new Error(`No badge PNGs were found in ${styleDir}.`);
  }

  for (const filePath of files) {
    const result = await bakeOpaqueCircleIntoBadge(filePath, backupDir, insetPx, dryRun);
    printInfo(`${dryRun ? 'Would rewrite' : 'Rewrote'} ${basename(result.filePath)} (${result.width}x${result.height}).`);
  }

  printInfo(`${dryRun ? 'Prepared' : 'Completed'} opaque white-circle baking for ${files.length} badge PNG(s).`);
  if (!dryRun) {
    printInfo(`Backup copy: ${backupDir}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
