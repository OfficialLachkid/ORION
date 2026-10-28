const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RECENT_HISTORY_LIMIT = 3;
const DEFAULT_VARIANT_LOOKBACK_LIMIT = 20;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(numeric));
}

function createVariantId(templateId, id, index) {
  const normalizedTemplateId = normalizeText(templateId).replace(/[^a-z0-9]+/giu, '-').replace(/^-+|-+$/gu, '');
  const normalizedId = normalizeText(id).replace(/[^a-z0-9]+/giu, '-').replace(/^-+|-+$/gu, '');
  if (normalizedId) {
    return normalizedTemplateId ? `${normalizedTemplateId}-${normalizedId}` : normalizedId;
  }
  if (normalizedTemplateId) {
    return `${normalizedTemplateId}-variant-${index + 1}`;
  }
  return `variant-${index + 1}`;
}

function normalizeVariantList(entries = [], templateId = '') {
  const items = Array.isArray(entries) ? entries : [];
  return items
    .map((entry, index) => {
      if (typeof entry === 'string') {
        const text = normalizeText(entry);
        return text ? { id: createVariantId(templateId, '', index), text } : null;
      }
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const text = normalizeText(entry.text || entry.body || entry.comment);
      return text
        ? { id: createVariantId(templateId, entry.id, index), text }
        : null;
    })
    .filter(Boolean);
}

function dedupeVariants(variants = []) {
  const deduped = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = `${normalizeText(variant?.id).toLowerCase()}::${normalizeText(variant?.text).toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(variant);
  }
  return deduped;
}

function normalizeTemplateVariantMap(entries = {}) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(entries)
      .map(([templateId, variants]) => {
        const normalizedTemplateId = normalizeText(templateId);
        if (!normalizedTemplateId) return null;
        return [
          normalizedTemplateId,
          dedupeVariants(normalizeVariantList(variants, normalizedTemplateId)),
        ];
      })
      .filter((entry) => Array.isArray(entry?.[1]) && entry[1].length > 0),
  );
}

function platformSettings(source = {}, platform = '') {
  const normalizedPlatform = normalizeText(platform).toLowerCase();
  const settings = source?.platforms?.[normalizedPlatform];
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}

export function resolveAutomaticCommentConfig(channelProfile = {}, options = {}) {
  const platform = normalizeText(options.platform).toLowerCase();
  const metadata = channelProfile?.metadata || {};
  const source = metadata.automatic_comments
    || (platform === 'youtube' ? metadata.youtube_auto_comment : null)
    || {};
  const perPlatform = platformSettings(source, platform);
  const defaults = perPlatform.default_variants
    || perPlatform.defaults
    || perPlatform.variants
    || source.default_variants
    || source.defaults
    || source.variants
    || [];
  const templateVariants = perPlatform.template_variants
    || perPlatform.templates
    || source.template_variants
    || source.templates
    || {};
  const enabled = perPlatform.enabled === undefined
    ? source.enabled === true
    : perPlatform.enabled === true;

  return {
    enabled,
    maxAttempts: normalizeInteger(
      perPlatform.max_attempts ?? source.max_attempts,
      DEFAULT_MAX_ATTEMPTS,
    ),
    recentHistoryLimit: normalizeInteger(
      perPlatform.recent_history_limit ?? source.recent_history_limit,
      DEFAULT_RECENT_HISTORY_LIMIT,
    ),
    lookbackLimit: normalizeInteger(
      perPlatform.lookback_limit ?? source.lookback_limit,
      DEFAULT_VARIANT_LOOKBACK_LIMIT,
    ),
    defaultVariants: dedupeVariants(normalizeVariantList(defaults, 'default')),
    templateVariants: normalizeTemplateVariantMap(templateVariants),
  };
}

export function collectAutomaticCommentVariants({
  publication,
  channelProfile,
  platform = '',
} = {}) {
  const config = resolveAutomaticCommentConfig(channelProfile, { platform });
  const templateId = normalizeText(publication?.metadata?.template_id);
  return dedupeVariants([
    ...(templateId ? (config.templateVariants[templateId] || []) : []),
    ...config.defaultVariants,
  ]);
}

export function selectAutomaticCommentVariant({
  publication,
  channelProfile,
  platform = '',
  recordKey = '',
  recentPublications = [],
  random = Math.random,
} = {}) {
  const variants = collectAutomaticCommentVariants({ publication, channelProfile, platform });
  if (variants.length === 0) return null;

  const config = resolveAutomaticCommentConfig(channelProfile, { platform });
  const recentVariantIds = new Set(
    (Array.isArray(recentPublications) ? recentPublications : [])
      .filter((candidate) => candidate?.id !== publication?.id)
      .slice(0, config.recentHistoryLimit)
      .map((candidate) => normalizeText(candidate?.metadata?.[recordKey]?.variant_id))
      .filter(Boolean),
  );
  const eligible = variants.filter((variant) => !recentVariantIds.has(variant.id));
  const pool = eligible.length > 0 ? eligible : variants;
  const numericRandom = typeof random === 'function' ? Number(random()) : Number(random);
  const boundedRandom = Number.isFinite(numericRandom)
    ? Math.min(Math.max(numericRandom, 0), 0.999999)
    : 0;
  return pool[Math.floor(boundedRandom * pool.length)] || pool[0] || null;
}
