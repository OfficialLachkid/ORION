import { createHash } from 'node:crypto';

export const INSTAGRAM_STORY_VARIANT_SET_VERSION = 'instagram-story-variants.v1';
export const INSTAGRAM_STORY_LEGACY_RECIPE_VERSION = 'instagram-story-promotion.v1';
export const INSTAGRAM_STORY_VARIANT_LEGACY = 'legacy_v1';
export const INSTAGRAM_STORY_VARIANT_CURRENT = 'current';
export const INSTAGRAM_STORY_VARIANT_BRANDED_FULLSCREEN = 'branded_fullscreen';
export const INSTAGRAM_STORY_VARIANT_FRAMED_CARD = 'framed_card';
export const INSTAGRAM_STORY_VARIANT_MINIMAL = 'minimal';
export const INSTAGRAM_STORY_VARIANT_HYBRID = 'hybrid';
export const INSTAGRAM_STORY_DEFAULT_VARIANTS = Object.freeze([
  INSTAGRAM_STORY_VARIANT_CURRENT,
  INSTAGRAM_STORY_VARIANT_BRANDED_FULLSCREEN,
  INSTAGRAM_STORY_VARIANT_FRAMED_CARD,
  INSTAGRAM_STORY_VARIANT_MINIMAL,
  INSTAGRAM_STORY_VARIANT_HYBRID,
]);

const SUPPORTED_VARIANTS = new Set(INSTAGRAM_STORY_DEFAULT_VARIANTS);
const DEFAULT_THEME = Object.freeze({
  primary: '#3FE4FF',
  secondary: '#1756B8',
  accent: '#E3350D',
  surface: '#071B3A',
  text: '#FFFFFF',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function xmlEscape(value) {
  return normalizeText(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function normalizeHex(value, fallback) {
  const normalized = normalizeText(value).toUpperCase();
  return /^#[0-9A-F]{6}$/u.test(normalized) ? normalized : fallback;
}

function normalizeVariant(value) {
  return normalizeText(value).toLowerCase().replace(/[-\s]+/gu, '_');
}

function storyConfiguration(target = {}) {
  const instagram = target.instagram && typeof target.instagram === 'object'
    ? target.instagram
    : {};
  return instagram.story && typeof instagram.story === 'object'
    ? instagram.story
    : {};
}

export function resolveInstagramStoryVariantKeys(target = {}) {
  const configured = storyConfiguration(target);
  const requested = Array.isArray(configured.variant_keys)
    ? configured.variant_keys
    : Array.isArray(configured.variantKeys)
      ? configured.variantKeys
      : INSTAGRAM_STORY_DEFAULT_VARIANTS;
  const variants = [...new Set(requested.map(normalizeVariant).filter(Boolean))];
  const unsupported = variants.filter((variant) => !SUPPORTED_VARIANTS.has(variant));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported Instagram Story variants: ${unsupported.join(', ')}.`);
  }
  if (variants.length === 0) {
    throw new Error('Instagram Story variant rotation requires at least one enabled variant.');
  }
  return variants;
}

function stableOffset(value, modulo) {
  const digest = createHash('sha256').update(normalizeText(value)).digest();
  return digest.readUInt32BE(0) % modulo;
}

export function resolveInstagramStoryVariant({
  publication = {},
  sourcePublication = {},
  target = {},
} = {}) {
  const variants = resolveInstagramStoryVariantKeys(target);
  const persisted = normalizeVariant(publication.metadata?.instagram_story?.variant_key);
  if (persisted) {
    if (!variants.includes(persisted)) {
      throw new Error(`Persisted Instagram Story variant ${persisted} is not enabled.`);
    }
    return persisted;
  }
  const accountKey = normalizeText(
    target.account_key || target.accountKey || publication.account_key || sourcePublication.account_key,
  );
  const publicationIdentity = normalizeText(
    sourcePublication.id || publication.metadata?.source_instagram_publication_id || publication.id,
  );
  const videoIdentity = normalizeText(sourcePublication.video_id || publication.video_id);
  const scheduleIdentity = normalizeText(
    sourcePublication.scheduled_for
      || publication.scheduled_for
      || sourcePublication.published_at
      || sourcePublication.metadata?.created_at,
  );
  const seed = [
    accountKey || 'instagram-story',
    publicationIdentity || 'unknown-publication',
    videoIdentity || 'unknown-video',
    scheduleIdentity || 'unknown-schedule',
    INSTAGRAM_STORY_VARIANT_SET_VERSION,
  ].join('|');
  return variants[stableOffset(seed, variants.length)];
}

export function resolveInstagramStoryTheme(target = {}) {
  const configured = storyConfiguration(target);
  const theme = configured.theme && typeof configured.theme === 'object'
    ? configured.theme
    : {};
  return {
    primary: normalizeHex(theme.primary, DEFAULT_THEME.primary),
    secondary: normalizeHex(theme.secondary, DEFAULT_THEME.secondary),
    accent: normalizeHex(theme.accent, DEFAULT_THEME.accent),
    surface: normalizeHex(theme.surface, DEFAULT_THEME.surface),
    text: normalizeHex(theme.text, DEFAULT_THEME.text),
  };
}

function displayNameFor(target, username) {
  const configured = storyConfiguration(target);
  return normalizeText(configured.display_name || configured.displayName)
    || normalizeText(username).replace(/^@/u, '')
    || 'Instagram';
}

function splitHeadline(value) {
  const words = normalizeText(value).toUpperCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return ['NEW VIDEO'];
  const lines = [''];
  for (const word of words) {
    const current = lines.at(-1);
    if (current && `${current} ${word}`.length > 20 && lines.length < 2) lines.push(word);
    else lines[lines.length - 1] = current ? `${current} ${word}` : word;
  }
  if (lines[1]?.length > 24) lines[1] = `${lines[1].slice(0, 23).trim()}…`;
  return lines.slice(0, 2);
}

function text(value, x, y, size, options = {}) {
  const fill = options.fill || '#FFFFFF';
  const weight = options.weight || 700;
  const anchor = options.anchor || 'start';
  const spacing = options.spacing || 0;
  const opacity = options.opacity ?? 1;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" fill-opacity="${opacity}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}">${xmlEscape(value)}</text>`;
}

function avatarBadge({ x, y, size, avatarDataUri, theme }) {
  const centerX = x + (size / 2);
  const centerY = y + (size / 2);
  return `
    <circle cx="${centerX}" cy="${centerY}" r="${size / 2}" fill="${theme.primary}" stroke="${theme.text}" stroke-width="3"/>
    <image href="${avatarDataUri}" x="${x + 7}" y="${y + 7}" width="${size - 14}" height="${size - 14}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip-${size})"/>
    <clipPath id="avatarClip-${size}" clipPathUnits="userSpaceOnUse"><circle cx="${centerX}" cy="${centerY}" r="${(size - 14) / 2}"/></clipPath>`;
}

function sharedDefinitions() {
  return `
    <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.76"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.91"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000000" flood-opacity="0.55"/>
    </filter>`;
}

function wrapSvg(body) {
  return Buffer.from(`<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg"><defs>${sharedDefinitions()}</defs>${body}</svg>`);
}

export function buildLegacyInstagramStoryRecipe({ username } = {}) {
  const account = normalizeText(username).replace(/^@/u, '') || 'our profile';
  return {
    variantKey: INSTAGRAM_STORY_VARIANT_LEGACY,
    variantSetVersion: INSTAGRAM_STORY_LEGACY_RECIPE_VERSION,
    presentation: 'fullscreen',
    progressBar: false,
    overlaySvg: Buffer.from(`
      <svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050914" stop-opacity="0.78"/><stop offset="1" stop-color="#050914" stop-opacity="0"/></linearGradient>
          <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050914" stop-opacity="0"/><stop offset="1" stop-color="#050914" stop-opacity="0.9"/></linearGradient>
        </defs>
        <rect width="1080" height="360" fill="url(#top)"/>
        <rect y="1420" width="1080" height="500" fill="url(#bottom)"/>
        <rect x="358" y="108" width="364" height="94" rx="47" fill="#121C33" fill-opacity="0.92" stroke="#3FE4FF" stroke-width="4"/>
        ${text('NEW VIDEO', 540, 170, 44, { anchor: 'middle', weight: 800, spacing: 4 })}
        ${text('WATCH THE FULL VIDEO', 540, 1660, 62, { anchor: 'middle', weight: 800 })}
        ${text(`@${account}`, 540, 1748, 48, { anchor: 'middle', fill: '#3FE4FF', weight: 700 })}
      </svg>
    `),
  };
}

function currentRecipe(context) {
  const { avatarDataUri, displayName, username, theme } = context;
  return wrapSvg(`
    <rect width="1080" height="360" fill="url(#topShade)"/>
    <rect y="1420" width="1080" height="500" fill="url(#bottomShade)"/>
    <g filter="url(#shadow)">
      <rect x="276" y="92" width="528" height="120" rx="60" fill="${theme.surface}" fill-opacity="0.94" stroke="${theme.primary}" stroke-width="4"/>
      ${avatarBadge({ x: 292, y: 100, size: 104, avatarDataUri, theme })}
      ${text('NEW VIDEO', 430, 148, 38, { fill: theme.text, weight: 900, spacing: 3 })}
      ${text(displayName.toUpperCase(), 430, 184, 23, { fill: theme.primary, weight: 800, spacing: 1 })}
    </g>
    ${text('WATCH THE FULL VIDEO', 540, 1658, 60, { anchor: 'middle', fill: theme.text, weight: 900 })}
    ${text(`@${username}`, 540, 1745, 44, { anchor: 'middle', fill: theme.primary, weight: 800 })}
  `);
}

function brandedFullscreenRecipe(context) {
  const { avatarDataUri, displayName, username, theme, title } = context;
  const headline = splitHeadline(title);
  return wrapSvg(`
    <rect width="1080" height="410" fill="url(#topShade)"/>
    <rect y="1160" width="1080" height="760" fill="url(#bottomShade)"/>
    <g filter="url(#shadow)">
      <rect x="54" y="62" width="570" height="116" rx="58" fill="${theme.surface}" fill-opacity="0.94" stroke="${theme.primary}" stroke-width="5"/>
      ${avatarBadge({ x: 64, y: 70, size: 100, avatarDataUri, theme })}
      ${text(displayName.toUpperCase(), 184, 134, 38, { fill: theme.primary, weight: 900, spacing: 1 })}
      <rect x="798" y="78" width="226" height="82" rx="41" fill="${theme.accent}"/>
      ${text('NEW VIDEO', 911, 131, 29, { anchor: 'middle', fill: theme.text, weight: 900, spacing: 2 })}
    </g>
    <rect x="56" y="1450" width="120" height="12" rx="6" fill="${theme.primary}"/>
    <rect x="188" y="1450" width="60" height="12" rx="6" fill="${theme.accent}"/>
    ${text(headline[0], 56, 1552, 74, { fill: theme.text, weight: 900 })}
    ${headline[1] ? text(headline[1], 56, 1638, 74, { fill: theme.primary, weight: 900 }) : ''}
    <rect x="56" y="1710" width="968" height="112" rx="56" fill="${theme.text}" fill-opacity="0.96"/>
    ${text('WATCH THE FULL VIDEO', 108, 1781, 34, { fill: theme.surface, weight: 900 })}
    ${text(`@${username}  ›`, 972, 1781, 29, { anchor: 'end', fill: theme.secondary, weight: 800 })}
  `);
}

function framedCardRecipe(context) {
  const { avatarDataUri, displayName, username, theme } = context;
  return wrapSvg(`
    <rect width="1080" height="1920" fill="${theme.surface}" fill-opacity="0.22"/>
    <g filter="url(#shadow)">
      <rect x="50" y="48" width="980" height="1822" rx="76" fill="none" stroke="${theme.secondary}" stroke-width="5"/>
      <rect x="72" y="70" width="936" height="176" rx="54" fill="${theme.surface}" fill-opacity="0.95"/>
      ${avatarBadge({ x: 92, y: 89, size: 138, avatarDataUri, theme })}
      ${text(displayName.toUpperCase(), 254, 150, 44, { fill: theme.primary, weight: 900, spacing: 1 })}
      ${text('NEW VIDEO CHALLENGE', 256, 194, 24, { fill: theme.text, weight: 700, spacing: 3, opacity: 0.84 })}
    </g>
    <rect x="105" y="280" width="870" height="1350" rx="68" fill="none" stroke="${theme.primary}" stroke-width="10" filter="url(#shadow)"/>
    <rect x="145" y="1668" width="790" height="120" rx="60" fill="${theme.accent}" filter="url(#shadow)"/>
    ${text('WATCH THE FULL VIDEO', 540, 1743, 34, { anchor: 'middle', fill: theme.text, weight: 900, spacing: 1 })}
    ${text(`@${username}`, 540, 1842, 29, { anchor: 'middle', fill: theme.primary, weight: 800, spacing: 2 })}
  `);
}

function minimalRecipe(context) {
  const { avatarDataUri, displayName, username, theme } = context;
  return wrapSvg(`
    <rect width="1080" height="255" fill="url(#topShade)"/>
    <rect y="1550" width="1080" height="370" fill="url(#bottomShade)"/>
    <g filter="url(#shadow)">
      <rect x="46" y="52" width="430" height="90" rx="45" fill="${theme.surface}" fill-opacity="0.88" stroke="${theme.text}" stroke-opacity="0.28" stroke-width="2"/>
      ${avatarBadge({ x: 52, y: 56, size: 82, avatarDataUri, theme })}
      ${text(displayName.toUpperCase(), 154, 109, 28, { fill: theme.primary, weight: 900, spacing: 1 })}
    </g>
    <g filter="url(#shadow)">
      <rect x="46" y="1690" width="988" height="116" rx="58" fill="#050A14" fill-opacity="0.84" stroke="${theme.text}" stroke-opacity="0.20" stroke-width="2"/>
      ${text('Watch the full video', 102, 1762, 36, { fill: theme.text, weight: 800 })}
      ${text(`@${username}  ›`, 976, 1762, 30, { anchor: 'end', fill: theme.primary, weight: 800 })}
    </g>
    <rect x="0" y="1898" width="1080" height="22" fill="${theme.text}" fill-opacity="0.18"/>
  `);
}

function hybridRecipe(context) {
  const { avatarDataUri, displayName, username, theme } = context;
  return wrapSvg(`
    <rect width="1080" height="390" fill="url(#topShade)"/>
    <rect y="1450" width="1080" height="470" fill="url(#bottomShade)"/>
    <rect x="26" y="26" width="1028" height="1868" rx="76" fill="none" stroke="${theme.secondary}" stroke-width="5" stroke-opacity="0.80"/>
    <rect x="38" y="38" width="1004" height="1844" rx="68" fill="none" stroke="${theme.primary}" stroke-width="2" stroke-opacity="0.72"/>
    <g filter="url(#shadow)">
      <rect x="54" y="58" width="972" height="150" rx="60" fill="${theme.surface}" fill-opacity="0.94" stroke="${theme.primary}" stroke-width="4"/>
      ${avatarBadge({ x: 72, y: 75, size: 116, avatarDataUri, theme })}
      ${text(displayName.toUpperCase(), 210, 125, 39, { fill: theme.primary, weight: 900, spacing: 1 })}
      ${text(`@${username}  •  NEW VIDEO`, 212, 169, 23, { fill: theme.text, weight: 700, spacing: 1, opacity: 0.84 })}
      <rect x="820" y="94" width="166" height="78" rx="39" fill="${theme.accent}"/>
      ${text('WATCH', 903, 144, 25, { anchor: 'middle', fill: theme.text, weight: 900, spacing: 1 })}
    </g>
    <g filter="url(#shadow)">
      <rect x="70" y="1660" width="940" height="130" rx="65" fill="#050A14" fill-opacity="0.88" stroke="${theme.text}" stroke-opacity="0.22" stroke-width="2"/>
      ${text('WATCH THE FULL VIDEO', 126, 1742, 38, { fill: theme.text, weight: 900, spacing: 1 })}
      <circle cx="916" cy="1725" r="42" fill="${theme.accent}"/>
      ${text('›', 919, 1744, 58, { anchor: 'middle', fill: theme.text, weight: 700 })}
    </g>
    <rect x="70" y="1828" width="940" height="18" rx="9" fill="${theme.text}" fill-opacity="0.20"/>
  `);
}

export function buildInstagramStoryRecipe({
  variantKey,
  username,
  title,
  avatarDataUri,
  target = {},
} = {}) {
  const normalizedVariant = normalizeVariant(variantKey);
  if (!SUPPORTED_VARIANTS.has(normalizedVariant)) {
    throw new Error(`Unsupported Instagram Story variant: ${normalizedVariant || 'missing'}.`);
  }
  const theme = resolveInstagramStoryTheme(target);
  const context = {
    avatarDataUri,
    displayName: displayNameFor(target, username),
    username: normalizeText(username).replace(/^@/u, '') || 'profile',
    title: normalizeText(title) || 'New video',
    theme,
  };
  const builders = {
    [INSTAGRAM_STORY_VARIANT_CURRENT]: currentRecipe,
    [INSTAGRAM_STORY_VARIANT_BRANDED_FULLSCREEN]: brandedFullscreenRecipe,
    [INSTAGRAM_STORY_VARIANT_FRAMED_CARD]: framedCardRecipe,
    [INSTAGRAM_STORY_VARIANT_MINIMAL]: minimalRecipe,
    [INSTAGRAM_STORY_VARIANT_HYBRID]: hybridRecipe,
  };
  return {
    variantKey: normalizedVariant,
    variantSetVersion: INSTAGRAM_STORY_VARIANT_SET_VERSION,
    presentation: normalizedVariant === INSTAGRAM_STORY_VARIANT_FRAMED_CARD ? 'framed' : 'fullscreen',
    progressBar: [INSTAGRAM_STORY_VARIANT_MINIMAL, INSTAGRAM_STORY_VARIANT_HYBRID]
      .includes(normalizedVariant),
    progressBarX: normalizedVariant === INSTAGRAM_STORY_VARIANT_HYBRID ? 70 : 0,
    progressBarY: normalizedVariant === INSTAGRAM_STORY_VARIANT_HYBRID ? 1828 : 1898,
    progressBarWidth: normalizedVariant === INSTAGRAM_STORY_VARIANT_HYBRID ? 940 : 1080,
    progressBarHeight: normalizedVariant === INSTAGRAM_STORY_VARIANT_HYBRID ? 18 : 22,
    progressBarColor: theme.primary,
    overlaySvg: builders[normalizedVariant](context),
  };
}
