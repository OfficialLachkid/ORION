import { readdir } from 'node:fs/promises';
import { basename, dirname, extname, relative } from 'node:path';
import {
  buildPokeQuizzThreeDTypeIconPath,
  buildPokeQuizzTypeIconPath,
  POKE_QUIZZ_ASSET_LAYOUT,
} from './poke-quizz-asset-layout.mjs';

const BACKGROUND_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);
const IMAGE_EXTENSIONS = new Set(['.png', '.gif', '.webp']);

export function isAssetCandidateFileName(fileName) {
  const normalizedName = String(fileName || '').trim();
  return normalizedName.length > 0 && !normalizedName.startsWith('.');
}

async function listFiles(directoryPath, allowedExtensions) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .filter((entry) => isAssetCandidateFileName(entry.name))
      .map((entry) => `${directoryPath}/${entry.name}`)
      .filter((filePath) => allowedExtensions.has(extname(filePath).toLowerCase()))
      .sort((left, right) => basename(left).localeCompare(basename(right)));
  } catch {
    return [];
  }
}

async function listFilesRecursive(directoryPath, allowedExtensions) {
  const directories = [directoryPath];
  const files = [];
  while (directories.length > 0) {
    const currentDirectory = directories.pop();
    try {
      const entries = await readdir(currentDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!isAssetCandidateFileName(entry.name)) continue;
        const entryPath = `${currentDirectory}/${entry.name}`;
        if (entry.isDirectory()) {
          directories.push(entryPath);
          continue;
        }
        if (entry.isFile() && allowedExtensions.has(extname(entryPath).toLowerCase())) {
          files.push(entryPath);
        }
      }
    } catch {
      // Skip unreadable directories and continue.
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function normalizeTypeName(typeName) {
  return String(typeName || '').trim().toLowerCase();
}

function fileExistsInList(list, expectedPath) {
  return list.includes(expectedPath);
}

export function buildThreeDTypeStyleCatalog(files, rootDirectory = POKE_QUIZZ_ASSET_LAYOUT.threeDTypes) {
  const catalog = new Map();
  for (const filePath of files || []) {
    const normalizedPath = String(filePath || '');
    const relativePath = relative(rootDirectory, normalizedPath).replaceAll('\\', '/');
    const pathParts = relativePath.split('/').filter(Boolean);
    const styleVariant = pathParts.length > 1 ? pathParts[0] : 'legacy';
    const typeName = basename(normalizedPath, extname(normalizedPath)).toLowerCase();
    const existing = catalog.get(styleVariant) || {
      style_variant: styleVariant,
      directory: pathParts.length > 1 ? dirname(normalizedPath).replaceAll('\\', '/') : rootDirectory,
      file_paths: [],
      paths_by_type: {},
    };
    existing.file_paths.push(normalizedPath);
    existing.paths_by_type[typeName] = normalizedPath;
    catalog.set(styleVariant, existing);
  }
  return Object.fromEntries(
    [...catalog.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([styleVariant, details]) => [styleVariant, {
        ...details,
        file_paths: [...details.file_paths].sort((left, right) => left.localeCompare(right)),
      }]),
  );
}

function preferredThreeDStyleOrder(styleCatalog) {
  const preferredNames = [
    'badge-style',
    'style-1',
    'style1',
    'sheet-1',
    'glow-style',
    'style-2',
    'style2',
    'sheet-2',
    'modern-glow',
    'glow',
    'legacy',
  ];
  const styleNames = Object.keys(styleCatalog || {});
  const ordered = preferredNames.filter((styleName) => styleNames.includes(styleName));
  const remaining = styleNames
    .filter((styleName) => !ordered.includes(styleName))
    .sort((left, right) => left.localeCompare(right));
  return [...ordered, ...remaining];
}

function matchSoundEffect(files, keywords) {
  return files.find((filePath) => keywords.some((keyword) => filePath.toLowerCase().includes(keyword))) || null;
}

function matchOverlay(files, keywords) {
  return files.find((filePath) => keywords.every((keyword) => filePath.toLowerCase().includes(keyword))) || null;
}

export function selectOverlayPresets(overlays) {
  return {
    timer: matchOverlay(overlays, ['timer']),
    pokeball_primary: matchOverlay(overlays, ['3d', 'pokeball'])
      || matchOverlay(overlays, ['pokeball', 'wiggle'])
      || matchOverlay(overlays, ['open', 'close', 'pokeball']),
  };
}

export async function scanPokeQuizzAssetInventory() {
  const [
    backgrounds,
    music,
    soundEffects,
    pixelTypes,
    threeDTypes,
    overlays,
    transitions,
  ] = await Promise.all([
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.backgrounds, BACKGROUND_EXTENSIONS),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic, AUDIO_EXTENSIONS),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.soundEffects, AUDIO_EXTENSIONS),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.pixelTypes, IMAGE_EXTENSIONS),
    listFilesRecursive(POKE_QUIZZ_ASSET_LAYOUT.threeDTypes, new Set(['.png', '.webp'])),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.overlays, new Set(['.png', '.webp', '.gif', '.mov', '.mp4', '.webm'])),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.transitions, new Set(['.png', '.webp', '.gif', '.mov', '.mp4', '.webm'])),
  ]);
  const threeDTypeStyles = buildThreeDTypeStyleCatalog(threeDTypes);

  const countdownTick = matchSoundEffect(soundEffects, ['countdown', 'tick', 'beep']);
  const timerEnd = matchSoundEffect(soundEffects, ['timer-end', 'time-up', 'timer_finished', 'timer-finished', 'finished', 'ding', 'reveal-hit']);
  const reveal = matchSoundEffect(soundEffects, ['reveal', 'sparkle', 'who', 'answer']) || timerEnd;

  return {
    scanned_at: new Date().toISOString(),
    directories: { ...POKE_QUIZZ_ASSET_LAYOUT },
    backgrounds,
    music,
    sound_effects: {
      all: soundEffects,
      countdown_tick: countdownTick,
      timer_end: timerEnd,
      reveal,
    },
    type_icons: {
      pixel: pixelTypes,
      three_d: threeDTypes,
      three_d_styles: threeDTypeStyles,
    },
    overlay_presets: selectOverlayPresets(overlays),
    overlays,
    transitions,
  };
}

export function selectTypeIconSet(typePair, inventory) {
  const normalizedTypes = typePair.map((typeName) => normalizeTypeName(typeName));
  const styleCatalog = inventory.type_icons?.three_d_styles || buildThreeDTypeStyleCatalog(inventory.type_icons?.three_d || []);
  for (const styleVariant of preferredThreeDStyleOrder(styleCatalog)) {
    const styleDetails = styleCatalog[styleVariant];
    if (!styleDetails) continue;
    const threeDPaths = normalizedTypes.map((typeName) => styleDetails.paths_by_type[typeName]).filter(Boolean);
    if (threeDPaths.length === normalizedTypes.length) {
      return {
        style: 'three_d',
        style_variant: styleVariant,
        file_paths: normalizedTypes.map((typeName) => styleDetails.paths_by_type[typeName]),
      };
    }
  }

  const pixelPaths = normalizedTypes.map((typeName) => buildPokeQuizzTypeIconPath(typeName));
  return {
    style: 'pixel',
    style_variant: 'pixel',
    file_paths: pixelPaths,
  };
}

export function selectSeededFile(files, random) {
  if (!Array.isArray(files) || files.length === 0) {
    return null;
  }
  return files[Math.floor(random() * files.length)] || null;
}
