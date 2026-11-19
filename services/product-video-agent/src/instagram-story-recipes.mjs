import { createHash } from 'node:crypto';

export const INSTAGRAM_STORY_VARIANT_SET_VERSION = 'instagram-story-variants.v1';
export const INSTAGRAM_STORY_LEGACY_RECIPE_VERSION = 'instagram-story-promotion.v1';
export const INSTAGRAM_STORY_VARIANT_LEGACY = 'legacy_v1';
export const INSTAGRAM_STORY_VARIANT_CURRENT = 'current';
export const INSTAGRAM_STORY_VARIANT_BRANDED_FULLSCREEN = 'branded_fullscreen';
export const INSTAGRAM_STORY_VARIANT_FRAMED_CARD = 'framed_card';
export const INSTAGRAM_STORY_VARIANT_MINIMAL = 'minimal';
export const INSTAGRAM_STORY_VARIANT_HYBRID = 'hybrid';
export const INSTAGRAM_STORY_VARIANT_GLASS_SPOTLIGHT = 'glass_spotlight';
export const INSTAGRAM_STORY_VARIANT_EDITORIAL_GALLERY = 'editorial_gallery';
export const INSTAGRAM_STORY_VARIANT_BROADCAST_ELITE = 'broadcast_elite';
export const INSTAGRAM_STORY_VARIANT_REGISTRY = Object.freeze([
  Object.freeze({ key: INSTAGRAM_STORY_VARIANT_CURRENT, build: currentRecipe }),
  Object.freeze({
    key: INSTAGRAM_STORY_VARIANT_BRANDED_FULLSCREEN,
    build: brandedFullscreenRecipe,
  }),
  Object.freeze({
    key: INSTAGRAM_STORY_VARIANT_FRAMED_CARD,
    build: framedCardRecipe,
    presentation: 'framed',
  }),
  Object.freeze({
    key: INSTAGRAM_STORY_VARIANT_MINIMAL,
    build: minimalRecipe,
    progressBar: true,
  }),
  Object.freeze({
    key: INSTAGRAM_STORY_VARIANT_HYBRID,
    build: hybridRecipe,
    progressBar: true,
    progressBarX: 70,
    progressBarY: 1828,
    progressBarWidth: 940,
    progressBarHeight: 18,
  }),
  Object.freeze({
    key: INSTAGRAM_STORY_VARIANT_GLASS_SPOTLIGHT,
    build: glassSpotlightRecipe,
    progressBar: true,
    progressBarX: 70,
    progressBarY: 1850,
    progressBarWidth: 940,
    progressBarHeight: 12,
  }),
  Object.freeze({
    key: INSTAGRAM_STORY_VARIANT_EDITORIAL_GALLERY,
    build: editorialGalleryRecipe,
    presentation: 'framed',
    progressBar: true,
    progressBarX: 115,
    progressBarY: 1818,
    progressBarWidth: 850,
    progressBarHeight: 10,
  }),
  Object.freeze({
    key: INSTAGRAM_STORY_VARIANT_BROADCAST_ELITE,
    build: broadcastEliteRecipe,
    progressBar: true,
    progressBarX: 48,
    progressBarY: 1862,
    progressBarWidth: 984,
    progressBarHeight: 12,
  }),
]);
export const INSTAGRAM_STORY_DEFAULT_VARIANTS = Object.freeze(
  INSTAGRAM_STORY_VARIANT_REGISTRY.map(({ key }) => key),
);

const VARIANT_DEFINITIONS = new Map(
  INSTAGRAM_STORY_VARIANT_REGISTRY.map((definition) => [definition.key, definition]),
);
const SUPPORTED_VARIANTS = new Set(VARIANT_DEFINITIONS.keys());
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

export function resolveInstagramStoryVariantPoolSignature(target = {}) {
  const variants = resolveInstagramStoryVariantKeys(target);
  const digest = createHash('sha256').update(variants.join('|')).digest('hex').slice(0, 12);
  return `${INSTAGRAM_STORY_VARIANT_SET_VERSION}.${digest}`;
}

function normalizeRotationInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeRotationOrder(value, variants) {
  if (!Array.isArray(value)) return [];
  const normalized = [...new Set(value.map(normalizeVariant).filter(Boolean))];
  return normalized.length === variants.length
    && normalized.every((variant) => variants.includes(variant))
    ? normalized
    : [];
}

function shuffledVariantOrder({ accountKey, cycle, poolSignature, variants }) {
  return [...variants].sort((left, right) => {
    const leftHash = createHash('sha256')
      .update(`${accountKey}|${poolSignature}|${cycle}|${left}`)
      .digest('hex');
    const rightHash = createHash('sha256')
      .update(`${accountKey}|${poolSignature}|${cycle}|${right}`)
      .digest('hex');
    return leftHash.localeCompare(rightHash) || left.localeCompare(right);
  });
}

function avoidCycleBoundaryRepeat(order, previousVariantKey) {
  if (order.length < 2 || order[0] !== previousVariantKey) return order;
  return [order[1], order[0], ...order.slice(2)];
}

export function resolveInstagramStoryVariantAssignment({
  publication = {},
  sourcePublication = {},
  target = {},
  rotationState = {},
} = {}) {
  const variants = resolveInstagramStoryVariantKeys(target);
  const persistedStory = publication.metadata?.instagram_story || {};
  const persisted = normalizeVariant(persistedStory.variant_key);
  if (persisted) {
    if (!variants.includes(persisted)) {
      throw new Error(`Persisted Instagram Story variant ${persisted} is not enabled.`);
    }
    return {
      variantKey: persisted,
      cycle: normalizeRotationInteger(persistedStory.rotation_cycle),
      position: normalizeRotationInteger(persistedStory.rotation_position),
      order: normalizeRotationOrder(persistedStory.rotation_order, variants),
      poolSignature: normalizeText(persistedStory.variant_pool_signature)
        || resolveInstagramStoryVariantPoolSignature(target),
    };
  }

  const accountKey = normalizeText(
    target.account_key || target.accountKey || publication.account_key || sourcePublication.account_key,
  ) || 'instagram-story';
  const poolSignature = resolveInstagramStoryVariantPoolSignature(target);
  const statePoolSignature = normalizeText(
    rotationState.poolSignature || rotationState.variant_pool_signature,
  );
  const previousVariantKey = normalizeVariant(
    rotationState.previousVariantKey || rotationState.variant_key,
  );
  const samePool = statePoolSignature === poolSignature;
  const previousOrder = samePool
    ? normalizeRotationOrder(rotationState.order || rotationState.rotation_order, variants)
    : [];
  const previousCycle = samePool
    ? normalizeRotationInteger(rotationState.cycle ?? rotationState.rotation_cycle)
    : 0;
  const previousPosition = samePool
    ? normalizeRotationInteger(rotationState.position ?? rotationState.rotation_position, -1)
    : -1;
  const continuesCycle = previousOrder.length === variants.length
    && previousPosition >= 0
    && previousPosition < variants.length - 1;
  const cycle = continuesCycle ? previousCycle : samePool ? previousCycle + 1 : 0;
  const position = continuesCycle ? previousPosition + 1 : 0;
  const order = continuesCycle
    ? previousOrder
    : avoidCycleBoundaryRepeat(
      shuffledVariantOrder({ accountKey, cycle, poolSignature, variants }),
      previousVariantKey,
    );
  return {
    variantKey: order[position],
    cycle,
    position,
    order,
    poolSignature,
  };
}

export function resolveInstagramStoryVariant({
  publication = {},
  sourcePublication = {},
  target = {},
  rotationState = {},
} = {}) {
  return resolveInstagramStoryVariantAssignment({
    publication,
    sourcePublication,
    target,
    rotationState,
  }).variantKey;
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

function glassSpotlightRecipe(context) {
  const { avatarDataUri, displayName, username, theme, title } = context;
  const headline = splitHeadline(title);
  return wrapSvg(`
    <defs>
      <linearGradient id="glassSpotlightStroke" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${theme.primary}"/>
        <stop offset="0.52" stop-color="${theme.text}" stop-opacity="0.34"/>
        <stop offset="1" stop-color="${theme.secondary}"/>
      </linearGradient>
      <radialGradient id="glassSpotlightGlow" cx="0.1" cy="0" r="1">
        <stop offset="0" stop-color="${theme.primary}" stop-opacity="0.28"/>
        <stop offset="1" stop-color="${theme.primary}" stop-opacity="0"/>
      </radialGradient>
      <filter id="glassSpotlightAccentGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="14" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="1080" height="380" fill="url(#topShade)"/>
    <rect y="1260" width="1080" height="660" fill="url(#bottomShade)"/>
    <rect width="1080" height="1920" fill="url(#glassSpotlightGlow)"/>
    <rect x="28" y="28" width="1024" height="1864" rx="76" fill="none" stroke="url(#glassSpotlightStroke)" stroke-width="3" stroke-opacity="0.82"/>
    <g filter="url(#shadow)">
      <rect x="54" y="58" width="972" height="154" rx="58" fill="${theme.surface}" fill-opacity="0.72" stroke="url(#glassSpotlightStroke)" stroke-width="3"/>
      ${avatarBadge({ x: 72, y: 76, size: 118, avatarDataUri, theme })}
      ${text(displayName.toUpperCase(), 218, 128, 38, { fill: theme.text, weight: 900, spacing: 1 })}
      ${text(`@${username}  /  NEW VIDEO`, 220, 173, 21, { fill: theme.primary, weight: 800, spacing: 2 })}
      <rect x="838" y="98" width="150" height="72" rx="36" fill="${theme.text}" fill-opacity="0.11" stroke="${theme.text}" stroke-opacity="0.32" stroke-width="2"/>
      ${text('NEW', 913, 144, 24, { anchor: 'middle', fill: theme.text, weight: 900, spacing: 4 })}
    </g>
    <g filter="url(#shadow)">
      <rect x="54" y="1430" width="972" height="360" rx="66" fill="${theme.surface}" fill-opacity="0.78" stroke="url(#glassSpotlightStroke)" stroke-width="3"/>
      <rect x="92" y="1474" width="82" height="8" rx="4" fill="${theme.primary}" filter="url(#glassSpotlightAccentGlow)"/>
      ${text(headline[0], 92, 1572, 60, { fill: theme.text, weight: 900 })}
      ${headline[1] ? text(headline[1], 92, 1640, 60, { fill: theme.primary, weight: 900 }) : ''}
      <rect x="92" y="1690" width="896" height="72" rx="36" fill="${theme.text}" fill-opacity="0.10" stroke="${theme.text}" stroke-opacity="0.24" stroke-width="2"/>
      ${text('WATCH THE FULL VIDEO ON PROFILE', 132, 1736, 24, { fill: theme.text, weight: 800, spacing: 1 })}
      <circle cx="944" cy="1726" r="24" fill="${theme.primary}"/>
      ${text('>', 945, 1735, 30, { anchor: 'middle', fill: theme.surface, weight: 900 })}
    </g>
  `);
}

function editorialGalleryRecipe(context) {
  const { avatarDataUri, displayName, username, theme, title } = context;
  const headline = splitHeadline(title);
  return wrapSvg(`
    <defs>
      <linearGradient id="editorialRule" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${theme.primary}"/>
        <stop offset="1" stop-color="${theme.secondary}"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1920" fill="${theme.surface}" fill-opacity="0.25"/>
    <rect x="30" y="30" width="1020" height="1860" rx="74" fill="none" stroke="${theme.text}" stroke-opacity="0.18" stroke-width="2"/>
    <g filter="url(#shadow)">
      ${avatarBadge({ x: 68, y: 62, size: 126, avatarDataUri, theme })}
      ${text('NEW VIDEO', 228, 104, 20, { fill: theme.primary, weight: 900, spacing: 4 })}
      ${text(displayName.toUpperCase(), 228, 158, 46, { fill: theme.text, weight: 900, spacing: 1 })}
      ${text(`@${username}`, 988, 135, 25, { anchor: 'end', fill: theme.text, weight: 700, opacity: 0.72 })}
    </g>
    <rect x="68" y="238" width="944" height="6" rx="3" fill="url(#editorialRule)"/>
    <rect x="102" y="268" width="876" height="1374" rx="72" fill="none" stroke="${theme.text}" stroke-opacity="0.42" stroke-width="2"/>
    <rect x="114" y="280" width="852" height="1350" rx="60" fill="none" stroke="${theme.primary}" stroke-width="5"/>
    <g transform="translate(54 1290) rotate(-90)">
      ${text('NEW RELEASE  /  WATCH ON PROFILE', 0, 0, 18, { fill: theme.text, weight: 800, spacing: 4, opacity: 0.62 })}
    </g>
    <g filter="url(#shadow)">
      <rect x="68" y="1658" width="944" height="196" rx="52" fill="${theme.surface}" fill-opacity="0.94" stroke="${theme.text}" stroke-opacity="0.20" stroke-width="2"/>
      ${text(headline[0], 104, 1727, 42, { fill: theme.text, weight: 900 })}
      ${headline[1] ? text(headline[1], 104, 1777, 42, { fill: theme.primary, weight: 900 }) : ''}
      <rect x="780" y="1698" width="184" height="96" rx="48" fill="${theme.primary}"/>
      ${text('WATCH', 872, 1758, 25, { anchor: 'middle', fill: theme.surface, weight: 900, spacing: 2 })}
    </g>
  `);
}

function broadcastEliteRecipe(context) {
  const { avatarDataUri, displayName, username, theme, title } = context;
  const headline = splitHeadline(title);
  return wrapSvg(`
    <defs>
      <linearGradient id="broadcastBar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${theme.surface}" stop-opacity="0.98"/>
        <stop offset="0.72" stop-color="${theme.surface}" stop-opacity="0.84"/>
        <stop offset="1" stop-color="${theme.secondary}" stop-opacity="0.76"/>
      </linearGradient>
      <filter id="broadcastGlow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="10" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="1080" height="330" fill="url(#topShade)"/>
    <rect y="1260" width="1080" height="660" fill="url(#bottomShade)"/>
    <path d="M48 178V62Q48 48 62 48H196" fill="none" stroke="${theme.primary}" stroke-width="7"/>
    <path d="M884 48H1018Q1032 48 1032 62V178" fill="none" stroke="${theme.primary}" stroke-width="7"/>
    <path d="M48 1710V1848Q48 1862 62 1862H196" fill="none" stroke="${theme.primary}" stroke-width="7"/>
    <path d="M884 1862H1018Q1032 1862 1032 1848V1710" fill="none" stroke="${theme.primary}" stroke-width="7"/>
    <g filter="url(#shadow)">
      <rect x="72" y="72" width="660" height="128" rx="28" fill="url(#broadcastBar)"/>
      ${avatarBadge({ x: 88, y: 82, size: 108, avatarDataUri, theme })}
      ${text(displayName.toUpperCase(), 226, 127, 37, { fill: theme.text, weight: 900, spacing: 1 })}
      ${text(`@${username}  /  FEATURED VIDEO`, 228, 169, 20, { fill: theme.primary, weight: 800, spacing: 2 })}
      <rect x="756" y="72" width="252" height="128" rx="28" fill="${theme.accent}"/>
      ${text('NEW DROP', 882, 130, 29, { anchor: 'middle', fill: theme.text, weight: 900, spacing: 3 })}
      ${text('WATCH NOW', 882, 169, 18, { anchor: 'middle', fill: theme.text, weight: 800, spacing: 2, opacity: 0.82 })}
    </g>
    <g filter="url(#shadow)">
      <path d="M48 1450H856L1032 1546V1802H48Z" fill="url(#broadcastBar)" stroke="${theme.text}" stroke-opacity="0.18" stroke-width="2"/>
      <rect x="48" y="1450" width="18" height="352" fill="${theme.primary}" filter="url(#broadcastGlow)"/>
      ${text('FEATURED', 94, 1512, 19, { fill: theme.primary, weight: 900, spacing: 5 })}
      ${text(headline[0], 94, 1600, 58, { fill: theme.text, weight: 900 })}
      ${headline[1] ? text(headline[1], 94, 1666, 58, { fill: theme.primary, weight: 900 }) : ''}
      <rect x="94" y="1710" width="512" height="62" rx="31" fill="${theme.text}" fill-opacity="0.09" stroke="${theme.text}" stroke-opacity="0.22" stroke-width="2"/>
      ${text('FULL VIDEO ON PROFILE', 134, 1750, 22, { fill: theme.text, weight: 800, spacing: 2 })}
      <circle cx="955" cy="1714" r="42" fill="${theme.primary}" filter="url(#broadcastGlow)"/>
      ${text('>', 956, 1728, 42, { anchor: 'middle', fill: theme.surface, weight: 900 })}
    </g>
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
  const definition = VARIANT_DEFINITIONS.get(normalizedVariant);
  return {
    variantKey: normalizedVariant,
    variantSetVersion: INSTAGRAM_STORY_VARIANT_SET_VERSION,
    presentation: definition.presentation || 'fullscreen',
    progressBar: definition.progressBar === true,
    progressBarX: definition.progressBarX ?? 0,
    progressBarY: definition.progressBarY ?? 1898,
    progressBarWidth: definition.progressBarWidth ?? 1080,
    progressBarHeight: definition.progressBarHeight ?? 22,
    progressBarColor: theme.primary,
    overlaySvg: definition.build(context),
  };
}
