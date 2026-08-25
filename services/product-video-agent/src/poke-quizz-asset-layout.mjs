export const ORION_T7_ROOT = '/Volumes/T7/O.R.I.O.N. Video Generation';

export const POKE_QUIZZ_ASSET_LAYOUT = Object.freeze({
  root: `${ORION_T7_ROOT}/Pokemon/Poke Quizz`,
  backgrounds: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Backgrounds`,
  gifBackgrounds: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/type-quiz-backgrounds`,
  sprites: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Sprites`,
  newSprites: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/new pokemon sprites`,
  animatedSpriteGifs: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/new pokemon sprite gifs`,
  shinySprites: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Shiny Sprites`,
  silhouettes: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Silhouettes`,
  pixelTypes: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Pixel Types`,
  threeDTypes: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/3D Types`,
  threeDTypeSources: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/3D Type Sources`,
  overlays: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Overlays`,
  transitions: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Transitions`,
  battleIntroMusic: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Audio/Music`,
  soundEffects: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Audio/Sound Effects`,
  previews: `${ORION_T7_ROOT}/Pokemon/Poke Quizz/Previews`,
  masters: `${ORION_T7_ROOT}/Masters/Poke Quizz`,
  templates: `${ORION_T7_ROOT}/Templates/Poke Quizz`,
});

const POKE_QUIZZ_PREVIEW_TEMPLATE_DIRECTORIES = Object.freeze({
  'dual-type-reveal': 'Dual Type Reveal',
  'find-the-shiny': 'Find the Shiny',
  'know-your-shiny': 'Know Your Shiny',
  showdown: 'Showdown',
  memory: 'Memory',
  'type-quiz': 'Type Quiz',
});

export function formatDexNumber(value) {
  return String(Number.parseInt(String(value || 0), 10)).padStart(4, '0');
}

export function sanitizePokemonSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function normalizeTemplateToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function generationDirectory(generation) {
  return `Generation ${Number.parseInt(String(generation || 0), 10)}`;
}

export function resolvePokeQuizzPreviewTemplateKey(templateRef) {
  const candidates = [
    typeof templateRef === 'string' ? templateRef : '',
    templateRef?.template_key,
    templateRef?.templateKey,
    templateRef?.template_id,
    templateRef?.templateId,
  ]
    .map((value) => normalizeTemplateToken(value))
    .filter(Boolean);

  if (candidates.some((value) => value.includes('find-the-shiny'))) {
    return 'find-the-shiny';
  }
  if (candidates.some((value) => value.includes('know-your-shiny'))) {
    return 'know-your-shiny';
  }
  if (candidates.some((value) => value.includes('showdown'))) {
    return 'showdown';
  }
  if (candidates.some((value) => value.includes('memory'))) {
    return 'memory';
  }
  if (candidates.some((value) => value.includes('dual-type-reveal'))) {
    return 'dual-type-reveal';
  }
  if (candidates.some((value) => value.includes('type-quiz') || value.includes('type-speed-quiz'))) {
    return 'type-quiz';
  }
  return null;
}

export function buildPokeQuizzPreviewDirectory(templateRef) {
  const templateKey = resolvePokeQuizzPreviewTemplateKey(templateRef);
  const directoryName = templateKey ? POKE_QUIZZ_PREVIEW_TEMPLATE_DIRECTORIES[templateKey] : '';
  return directoryName
    ? `${POKE_QUIZZ_ASSET_LAYOUT.previews}/${directoryName}`
    : POKE_QUIZZ_ASSET_LAYOUT.previews;
}

export function buildPokeQuizzPreviewArchiveDirectory(templateRef) {
  return `${buildPokeQuizzPreviewDirectory(templateRef)}/Older Generated Videos`;
}

export function buildPokeQuizzSpritePath(row) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.sprites}/${generationDirectory(row.generation)}/${formatDexNumber(row.national_dex_number)}-${sanitizePokemonSlug(row.slug)}.png`;
}

export function buildPokeQuizzMirroredSpritePath(spritePath) {
  const normalizedPath = String(spritePath || '').trim().replaceAll('\\', '/');
  const sourcePrefix = `${POKE_QUIZZ_ASSET_LAYOUT.sprites}/`;
  if (!normalizedPath.startsWith(sourcePrefix)) {
    return null;
  }
  return `${POKE_QUIZZ_ASSET_LAYOUT.newSprites}/${normalizedPath.slice(sourcePrefix.length)}`;
}

export function buildPokeQuizzShinySpritePath(row) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.shinySprites}/${generationDirectory(row.generation)}/${formatDexNumber(row.national_dex_number)}-${sanitizePokemonSlug(row.slug)}.png`;
}

export function buildPokeQuizzAnimatedShinySpritePath(row) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.animatedSpriteGifs}/${generationDirectory(row.generation)}/shiny/${formatDexNumber(row.national_dex_number)}-${sanitizePokemonSlug(row.slug || row.name)}.gif`;
}

export function buildPokeQuizzSilhouettePath(row) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.silhouettes}/${generationDirectory(row.generation)}/${formatDexNumber(row.national_dex_number)}-${sanitizePokemonSlug(row.slug)}.png`;
}

export function buildPokeQuizzTypeIconPath(typeName) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.pixelTypes}/${String(typeName || '').trim().toLowerCase()}.gif`;
}

export function buildPokeQuizzThreeDTypeIconPath(typeName) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.threeDTypes}/${String(typeName || '').trim().toLowerCase()}.png`;
}
