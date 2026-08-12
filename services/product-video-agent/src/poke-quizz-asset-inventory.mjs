import { readdir } from 'node:fs/promises';
import { basename, dirname, extname, relative } from 'node:path';
import {
  buildPokeQuizzThreeDTypeIconPath,
  buildPokeQuizzTypeIconPath,
  POKE_QUIZZ_ASSET_LAYOUT,
} from './poke-quizz-asset-layout.mjs';

export const BACKGROUND_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm']);
const BACKGROUND_THEME_DIRECTORIES = Object.freeze([
  'beach-backgrounds',
  'cave-backgrounds',
  'fire-backgrounds',
]);
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

async function listPokeQuizzBackgroundFiles() {
  const rootFiles = await listFiles(POKE_QUIZZ_ASSET_LAYOUT.backgrounds, BACKGROUND_EXTENSIONS);
  const themedBackgroundFiles = (await Promise.all(
    BACKGROUND_THEME_DIRECTORIES.map((directoryName) => (
      listFiles(`${POKE_QUIZZ_ASSET_LAYOUT.backgrounds}/${directoryName}`, BACKGROUND_EXTENSIONS)
    )),
  )).flat();
  return [...new Set([...rootFiles, ...themedBackgroundFiles])]
    .sort((left, right) => left.localeCompare(right));
}

async function listPokeQuizzGifBackgroundFiles() {
  return listFiles(POKE_QUIZZ_ASSET_LAYOUT.gifBackgrounds, BACKGROUND_EXTENSIONS);
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

function matchSoundEffectKeywordGroups(files, keywordGroups) {
  return files.find((filePath) => {
    const normalizedPath = filePath.toLowerCase();
    return keywordGroups.some((keywords) => keywords.every((keyword) => normalizedPath.includes(keyword)));
  }) || null;
}

function matchOverlay(files, keywords) {
  return files.find((filePath) => keywords.every((keyword) => filePath.toLowerCase().includes(keyword))) || null;
}

export function selectOverlayPresets(overlays) {
  const timerCountdown = matchOverlay(overlays, ['timer', 'countdown'])
    || matchOverlay(overlays, ['timer-countdown'])
    || matchOverlay(overlays, ['timer_countdown']);
  const timerAlarm = matchOverlay(overlays, ['timer', 'alarm'])
    || matchOverlay(overlays, ['timer-alarm'])
    || matchOverlay(overlays, ['timer_alarm']);
  const shinySparkle = matchOverlay(overlays, ['shiny', 'sparkle'])
    || matchOverlay(overlays, ['shiny-sparkle'])
    || matchOverlay(overlays, ['shiny_sparkle']);
  const typePlaceholder = matchOverlay(overlays, ['question', 'mark'])
    || matchOverlay(overlays, ['question-mark'])
    || matchOverlay(overlays, ['question_mark']);
  const timer = timerCountdown || matchOverlay(overlays, ['timer']);
  return {
    timer,
    timer_countdown: timerCountdown || timer,
    timer_alarm: timerAlarm,
    shiny_sparkle: shinySparkle,
    type_placeholder: typePlaceholder,
    pokeball_primary: matchOverlay(overlays, ['3d', 'pokeball'])
      || matchOverlay(overlays, ['pokeball', 'wiggle'])
      || matchOverlay(overlays, ['open', 'close', 'pokeball']),
  };
}

export async function scanPokeQuizzAssetInventory() {
  const [
    backgrounds,
    gifBackgrounds,
    music,
    soundEffects,
    pixelTypes,
    threeDTypes,
    overlays,
    transitions,
  ] = await Promise.all([
    listPokeQuizzBackgroundFiles(),
    listPokeQuizzGifBackgroundFiles(),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic, AUDIO_EXTENSIONS),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.soundEffects, AUDIO_EXTENSIONS),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.pixelTypes, IMAGE_EXTENSIONS),
    listFilesRecursive(POKE_QUIZZ_ASSET_LAYOUT.threeDTypes, new Set(['.png', '.webp'])),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.overlays, new Set(['.png', '.webp', '.gif', '.mov', '.mp4', '.webm'])),
    listFiles(POKE_QUIZZ_ASSET_LAYOUT.transitions, new Set(['.png', '.webp', '.gif', '.mov', '.mp4', '.webm'])),
  ]);
  const threeDTypeStyles = buildThreeDTypeStyleCatalog(threeDTypes);

  const countdownTick = matchSoundEffect(soundEffects, ['countdown', 'tick', 'beep']);
  const timerEnd = (
    matchSoundEffect(soundEffects, ['timer-end', 'time-up', 'timer_finished', 'timer-finished', 'finished', 'reveal-hit'])
    || matchSoundEffect(soundEffects, ['ding'])
  );
  const reveal = matchSoundEffect(soundEffects, ['reveal', 'who', 'answer']) || timerEnd;
  const shiny = matchSoundEffect(soundEffects, ['shiny', 'sparkle', 'twinkle', 'glint']);
  const pokeballIntro = matchSoundEffectKeywordGroups(soundEffects, [
    ['enlarge', 'pokeball'],
    ['pokeball', 'intro'],
    ['pokeball', 'appear'],
    ['pokeball', 'spawn'],
    ['pokeball', 'scale'],
    ['pokeball', 'grow'],
  ]);
  const pokeballWiggle = matchSoundEffectKeywordGroups(soundEffects, [
    ['pokeball', 'wiggle'],
    ['pokeball', 'wobble'],
    ['pokeball', 'shake'],
  ]);

  return {
    scanned_at: new Date().toISOString(),
    directories: { ...POKE_QUIZZ_ASSET_LAYOUT },
    backgrounds,
    gif_backgrounds: gifBackgrounds,
    music,
    sound_effects: {
      all: soundEffects,
      countdown_tick: countdownTick,
      timer_end: timerEnd,
      reveal,
      shiny,
      pokeball_intro: pokeballIntro,
      pokeball_wiggle: pokeballWiggle,
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
