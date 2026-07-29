import { readdir } from 'node:fs/promises';
import { basename, extname } from 'node:path';
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

function normalizeTypeName(typeName) {
  return String(typeName || '').trim().toLowerCase();
}

function fileExistsInList(list, expectedPath) {
  return list.includes(expectedPath);
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
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.threeDTypes, new Set(['.png', '.webp'])),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.overlays, new Set(['.png', '.webp', '.gif', '.mov', '.mp4', '.webm'])),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.transitions, new Set(['.png', '.webp', '.gif', '.mov', '.mp4', '.webm'])),
  ]);

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
    },
    overlay_presets: selectOverlayPresets(overlays),
    overlays,
    transitions,
  };
}

export function selectTypeIconSet(typePair, inventory) {
  const normalizedTypes = typePair.map((typeName) => normalizeTypeName(typeName));
  const threeDPaths = normalizedTypes.map((typeName) => buildPokeQuizzThreeDTypeIconPath(typeName));
  if (threeDPaths.every((filePath) => fileExistsInList(inventory.type_icons.three_d, filePath))) {
    return {
      style: 'three_d',
      file_paths: threeDPaths,
    };
  }

  const pixelPaths = normalizedTypes.map((typeName) => buildPokeQuizzTypeIconPath(typeName));
  return {
    style: 'pixel',
    file_paths: pixelPaths,
  };
}

export function selectSeededFile(files, random) {
  if (!Array.isArray(files) || files.length === 0) {
    return null;
  }
  return files[Math.floor(random() * files.length)] || null;
}
