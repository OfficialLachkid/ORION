export const DEFAULT_HOOK_TEXT_Y = 150;
export const DEFAULT_PROMPT_TEXT_Y = 170;
export const DEFAULT_REVEAL_TEXT_Y = 170;
export const DEFAULT_TYPE_ICON_Y = 360;
export const DEFAULT_TIMER_SIZE = 300;
export const DEFAULT_TIMER_SCALE_MULTIPLIER = 1.5;
export const DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER = 1.3;
export const DEFAULT_TIMER_NUMBER_SIZE = 112;
export const DEFAULT_HOOK_FONT_SIZE = 138;
export const DEFAULT_PROMPT_FONT_SIZE = 81;
export const DEFAULT_REVEAL_FONT_SIZE = 132;
export const DEFAULT_TEXT_BORDER = 6;
export const DEFAULT_TEXT_LINE_SPACING = 12;
export const DEFAULT_MUSIC_LEAD_SECONDS = 0.6;
export const DEFAULT_MUSIC_VOLUME = 0.18;
export const DEFAULT_VOICE_VOLUME = 1;
export const DEFAULT_COUNTDOWN_VOLUME = 0.72;
export const DEFAULT_POKEBALL_WIGGLE_VOLUME = 0.38;
export const DEFAULT_POKEBALL_INTRO_SFX_VOLUME = 0.5;
export const DEFAULT_POKEBALL_INTRO_SFX_TRIM_SECONDS = 0.3;
export const DEFAULT_TIMER_END_VOLUME = 0.9;
export const DEFAULT_SHINY_SFX_VOLUME = 0.5;
export const DEFAULT_REVEAL_TRANSITION_SECONDS = 0.42;
export const DEFAULT_REVEAL_VISUAL_DELAY_SECONDS = 0.3;
export const DEFAULT_REVEAL_TEXT_DELAY_SECONDS = 0.16;
export const DEFAULT_REVEALED_SPRITE_SCALE_MULTIPLIER = 1.2;
export const DEFAULT_POKEBALL_SCALE_MULTIPLIER = 1.2;
export const DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER = 1.35;
export const DEFAULT_TYPE_ICON_HOOK_SCALE_MULTIPLIER = 1.3;
export const DEFAULT_TYPE_ICON_HOOK_Y = 684;
export const DEFAULT_TYPE_ICON_SETTLE_SECONDS = 0.18;
export const DEFAULT_TYPE_ICON_POP_IN_SECONDS = 0.2;
export const DEFAULT_TYPE_ICON_POP_IN_INITIAL_SCALE = 0.9;
export const DEFAULT_TYPE_ICON_POP_IN_PEAK_SCALE = 1.12;
export const DEFAULT_TYPE_ICON_POP_IN_SETTLE_SCALE = 1;
export const DEFAULT_TYPE_ICON_SCALE_SETTLE_RATIO = 1;
export const DEFAULT_TYPE_ICON_SETTLE_SCALE_MULTIPLIER = 1;
export const DEFAULT_TYPE_ICON_BACKDROP_SCALE_MULTIPLIER = 0.78;
export const DEFAULT_TYPE_ICON_BACKDROP_ALPHA = 255;
export const DEFAULT_TYPE_ICON_BADGE_ART_INTRO_SCALE_MULTIPLIER = 0.96;
export const DEFAULT_TYPE_ICON_BADGE_ART_FINAL_SCALE_MULTIPLIER = 0.82;
export const DEFAULT_TYPE_ICON_OUTLINE_SCALE_MULTIPLIER = 1.1;
export const DEFAULT_POKEBALL_INTRO_SECONDS = 0.36;
export const DEFAULT_POKEBALL_INTRO_LEAD_SECONDS = 0.5;
export const DEFAULT_TIMER_ALARM_EXTRA_HOLD_SECONDS = 1;
export const DEFAULT_TIMER_ALARM_EXIT_SECONDS = 0.42;
export const DEFAULT_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Avenir Next.ttc',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

export function roundTime(value) {
  return Number(Number(value || 0).toFixed(3));
}

export function escapeDrawtextText(value) {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll('%', '\\%')
    .replaceAll(',', '\\,');
}

export function escapeFilterPath(filePath) {
  return String(filePath || '')
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
}

export function ensureNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolvePokeballIntroStartSeconds(renderPlan) {
  const countdownStart = ensureNumber(renderPlan?.phases?.countdown?.start_seconds, 0);
  return roundTime(Math.max(
    ensureNumber(
      renderPlan?.phases?.type_prompt?.start_seconds,
      ensureNumber(renderPlan?.audio_cues?.prompt_start_seconds, 0),
    ),
    countdownStart - DEFAULT_POKEBALL_INTRO_LEAD_SECONDS,
  ));
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function safeFilterLabel(prefix, index) {
  return `${prefix}${index}`;
}

export function typeIconUsesOpaqueBadgeArt(typeIconAsset) {
  const styleVariant = String(typeIconAsset?.style_variant || typeIconAsset?.style || '')
    .trim()
    .toLowerCase();
  const localPath = String(typeIconAsset?.local_path || '')
    .trim()
    .replaceAll('\\', '/')
    .toLowerCase();
  return styleVariant === 'badge-style' || localPath.includes('/badge-style/');
}
