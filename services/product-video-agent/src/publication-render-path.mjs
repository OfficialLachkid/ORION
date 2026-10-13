import { stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

function normalizeText(value) {
  return String(value || '').trim();
}

export function buildPublicationRenderPathCandidates(
  configuredPath,
  projectRoot = process.cwd(),
) {
  const normalizedPath = normalizeText(configuredPath);
  if (!normalizedPath) return [];
  const primaryPath = resolve(projectRoot, normalizedPath);
  const relocatedPath = join(
    dirname(primaryPath),
    'Older Generated Videos',
    basename(primaryPath),
  );
  return [...new Set([primaryPath, relocatedPath])];
}

export async function resolveAvailablePublicationRender({
  configuredPath,
  projectRoot = process.cwd(),
  statImpl = stat,
}) {
  const candidates = buildPublicationRenderPathCandidates(configuredPath, projectRoot);
  if (candidates.length === 0) {
    const error = new Error('Publication render path is missing.');
    error.code = 'ENOENT';
    throw error;
  }

  let missingError = null;
  for (const renderPath of candidates) {
    try {
      const fileStats = await statImpl(renderPath);
      return {
        renderPath,
        fileStats,
        relocated: renderPath !== candidates[0],
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      missingError = error;
    }
  }
  throw missingError;
}
