import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildPokeQuizzCryPath } from '../../../../poke-quizz-asset-layout.mjs';

const pathAvailabilityCache = new Map();
const sourceUrlCache = new Map();
const downloadCache = new Map();

async function canAccessPath(filePath) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) return false;
  if (!pathAvailabilityCache.has(normalizedPath)) {
    pathAvailabilityCache.set(
      normalizedPath,
      access(normalizedPath).then(() => true).catch(() => false),
    );
  }
  return pathAvailabilityCache.get(normalizedPath);
}

function resolvePokemonApiLookupKey(subject = {}) {
  return subject?.metadata?.pokemon_api?.pokemon_id
    || subject?.metadata?.pokemon_id
    || subject?.slug
    || subject?.national_dex_number
    || '';
}

async function resolveCrySourceUrl(subject = {}) {
  const explicitUrl = String(subject?.cry_source_url || '').trim();
  if (explicitUrl) return explicitUrl;

  const lookupKey = String(resolvePokemonApiLookupKey(subject)).trim().toLowerCase();
  if (!lookupKey) return '';
  if (!sourceUrlCache.has(lookupKey)) {
    sourceUrlCache.set(lookupKey, (async () => {
      try {
        const response = await fetch(
          `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(lookupKey)}`,
        );
        if (!response.ok) return '';
        const payload = await response.json();
        return String(payload?.cries?.latest || payload?.cries?.legacy || '').trim();
      } catch {
        return '';
      }
    })());
  }
  return sourceUrlCache.get(lookupKey);
}

async function downloadCry(sourceUrl, outputPath) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not download Pokemon cry from ${sourceUrl} (${response.status}).`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

export async function resolvePokemonCryPath(subject = {}) {
  const explicitPath = String(subject?.cry_path || '').trim();
  if (explicitPath && await canAccessPath(explicitPath)) return explicitPath;

  const derivedPath = buildPokeQuizzCryPath(subject);
  if (derivedPath && await canAccessPath(derivedPath)) return derivedPath;

  const sourceUrl = await resolveCrySourceUrl(subject);
  if (!sourceUrl || !derivedPath) return explicitPath;
  if (!downloadCache.has(derivedPath)) {
    downloadCache.set(derivedPath, (async () => {
      try {
        await downloadCry(sourceUrl, derivedPath);
        pathAvailabilityCache.set(derivedPath, Promise.resolve(true));
        return derivedPath;
      } catch {
        return explicitPath;
      }
    })());
  }
  return downloadCache.get(derivedPath);
}
