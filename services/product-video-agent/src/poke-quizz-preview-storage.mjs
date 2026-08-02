import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  constants,
  copyFile,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import { POKE_QUIZZ_ASSET_LAYOUT } from './poke-quizz-asset-layout.mjs';

const DEFAULT_FALLBACK_DIRECTORY = 'Video Generation Fallback/Pokemon/Poke Quizz/Previews';

async function calculateSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function isWritableDirectory(directoryPath) {
  try {
    const details = await stat(directoryPath);
    if (!details.isDirectory()) return false;
    await access(directoryPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isPathInsideRoot(rootPath, candidatePath) {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const relativePath = relative(root, candidate);
  return relativePath === ''
    || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function assertRelativePathWithinRoot(rootPath, filePath) {
  const relativePath = relative(resolve(rootPath), resolve(filePath));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Preview path must stay inside ${rootPath}.`);
  }
  return relativePath;
}

async function listPreviewMp4FilesRecursive(rootPath) {
  const directories = [rootPath];
  const files = [];
  while (directories.length > 0) {
    const current = directories.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        directories.push(entryPath);
        continue;
      }
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.mp4') {
        files.push(entryPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function resolvePokeQuizzPreviewRoots(options = {}) {
  const homeDirectory = options.homeDirectory || homedir();
  const preferredRoot = resolve(options.preferredRoot || POKE_QUIZZ_ASSET_LAYOUT.previews);
  const fallbackRoot = resolve(
    options.fallbackRoot || resolve(homeDirectory, 'Desktop', DEFAULT_FALLBACK_DIRECTORY),
  );
  return {
    preferredRoot,
    fallbackRoot,
  };
}

export async function resolveManagedPokeQuizzPreviewOutputPath(preferredOutputPath, options = {}) {
  const roots = resolvePokeQuizzPreviewRoots(options);
  const preferredPath = resolve(preferredOutputPath);
  if (!isPathInsideRoot(roots.preferredRoot, preferredPath)) {
    return {
      outputPath: preferredPath,
      usingFallback: false,
      locationType: 'custom_output',
      ...roots,
    };
  }

  if (await isWritableDirectory(roots.preferredRoot)) {
    return {
      outputPath: preferredPath,
      usingFallback: false,
      locationType: 'external_ssd_preview',
      ...roots,
    };
  }

  const relativePath = assertRelativePathWithinRoot(roots.preferredRoot, preferredPath);
  return {
    outputPath: resolve(roots.fallbackRoot, relativePath),
    usingFallback: true,
    locationType: 'mac_desktop_fallback_preview',
    ...roots,
  };
}

export function isManagedPokeQuizzPreviewPath(filePath, options = {}) {
  const normalizedPath = resolve(String(filePath || '').trim());
  const roots = resolvePokeQuizzPreviewRoots(options);
  if (extname(normalizedPath).toLowerCase() !== '.mp4') {
    return false;
  }
  return isPathInsideRoot(roots.preferredRoot, normalizedPath)
    || isPathInsideRoot(roots.fallbackRoot, normalizedPath);
}

export async function reconcilePokeQuizzPreviewFallbackStorage(options = {}) {
  const roots = resolvePokeQuizzPreviewRoots(options);
  const fallbackFiles = await listPreviewMp4FilesRecursive(roots.fallbackRoot);
  const preferredAvailable = await isWritableDirectory(roots.preferredRoot);
  if (!preferredAvailable) {
    return {
      preferredAvailable: false,
      preferredRoot: roots.preferredRoot,
      fallbackRoot: roots.fallbackRoot,
      strandedCount: fallbackFiles.length,
      moved: [],
      deduped: [],
      skipped: [],
    };
  }
  const moved = [];
  const deduped = [];
  const skipped = [];

  for (const sourcePath of fallbackFiles) {
    const relativePath = assertRelativePathWithinRoot(roots.fallbackRoot, sourcePath);
    const destinationPath = resolve(roots.preferredRoot, relativePath);
    await mkdir(dirname(destinationPath), { recursive: true });

    let destinationExists = false;
    try {
      destinationExists = (await stat(destinationPath)).isFile();
    } catch {
      destinationExists = false;
    }

    if (destinationExists) {
      const [sourceSha, destinationSha] = await Promise.all([
        calculateSha256(sourcePath),
        calculateSha256(destinationPath),
      ]);
      if (sourceSha === destinationSha) {
        await unlink(sourcePath).catch(() => {});
        deduped.push({ sourcePath, destinationPath });
      } else {
        skipped.push({
          sourcePath,
          destinationPath,
          reason: 'destination_conflict',
        });
      }
      continue;
    }

    const temporaryPath = `${destinationPath}.partial`;
    try {
      await copyFile(sourcePath, temporaryPath);
      const [sourceSha, copiedSha] = await Promise.all([
        calculateSha256(sourcePath),
        calculateSha256(temporaryPath),
      ]);
      if (sourceSha !== copiedSha) {
        throw new Error('Copied preview hash mismatch.');
      }
      await rename(temporaryPath, destinationPath);
      await unlink(sourcePath);
      moved.push({ sourcePath, destinationPath });
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      skipped.push({
        sourcePath,
        destinationPath,
        reason: error.message || String(error),
      });
    }
  }

  return {
    preferredAvailable: true,
    preferredRoot: roots.preferredRoot,
    fallbackRoot: roots.fallbackRoot,
    strandedCount: fallbackFiles.length,
    moved,
    deduped,
    skipped,
  };
}

export function buildPokeQuizzPreviewFallbackPath(fileName, options = {}) {
  const roots = resolvePokeQuizzPreviewRoots(options);
  return resolve(roots.fallbackRoot, basename(fileName));
}
