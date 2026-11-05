const SUPPORTED_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

function normalizeToken(value = '') {
  return String(value || '').trim().toLowerCase();
}

function titleCaseWords(value = '') {
  return String(value || '')
    .split(/[-_.\s]+/u)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '')
    .filter(Boolean)
    .join(' ');
}

export function normalizePlaylistTemplateKey(templateId = '') {
  return normalizeToken(templateId)
    .replace(/\.landscape$/u, '')
    .replace(/\.v\d+$/u, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function buildPlaylistTemplateTitle(templateId = '', override = '') {
  const explicit = String(override || '').trim();
  if (explicit) return explicit;
  const key = normalizePlaylistTemplateKey(templateId);
  const segments = key.split('.').filter(Boolean);
  return titleCaseWords(segments.at(-1) || key || 'Video');
}

export function normalizePlaylistDifficulty(value = '') {
  const normalized = normalizeToken(value);
  return SUPPORTED_DIFFICULTIES.has(normalized) ? normalized : '';
}

export function classifyRelativeDifficulty(selectedValue, availableValues = []) {
  const selected = Number(selectedValue);
  const ordered = [...new Set((Array.isArray(availableValues) ? availableValues : [])
    .map(Number)
    .filter(Number.isFinite))]
    .sort((left, right) => left - right);
  const selectedIndex = ordered.indexOf(selected);
  if (selectedIndex < 0 || ordered.length < 2) return '';
  if (selectedIndex === 0) return 'easy';
  if (selectedIndex === ordered.length - 1) return 'hard';
  return 'medium';
}

export function buildYoutubePlaylistClassification(plan = {}) {
  const contentSurface = normalizeToken(plan?.content_surface || 'youtube_shorts');
  const policy = plan?.publication_policy || {};
  if (contentSurface !== 'youtube_shorts' || policy.playlist_enabled === false) {
    return null;
  }

  const templateId = String(plan?.template_id || '').trim();
  const templateKey = normalizePlaylistTemplateKey(
    plan?.playlist_classification?.template_key || templateId,
  );
  if (!templateKey) return null;

  const explicitDifficulty = normalizePlaylistDifficulty(
    plan?.playlist_classification?.difficulty_key
      || plan?.selection?.difficulty_key
      || plan?.selection?.difficulty_id,
  );

  return {
    schema_version: 'youtube-playlist-classification-v1',
    template_key: templateKey,
    template_title: buildPlaylistTemplateTitle(
      templateId,
      plan?.playlist_classification?.template_title,
    ),
    ...(explicitDifficulty ? { difficulty_key: explicitDifficulty } : {}),
  };
}

export function resolvePublicationPlaylistClassification(publication = {}) {
  const metadata = publication?.metadata || {};
  const contentSurface = normalizeToken(metadata.content_surface || publication.content_surface || 'youtube_shorts');
  if (contentSurface !== 'youtube_shorts') return null;
  if (metadata?.publication_policy?.playlist_enabled === false) return null;

  const stored = metadata.playlist_classification
    || metadata?.youtube_playlists?.backfill_classification
    || {};
  const templateId = String(stored.template_key || publication.playlist_template_key || '').trim();
  const templateKey = normalizePlaylistTemplateKey(templateId);
  if (!templateKey) return null;

  const difficulty = normalizePlaylistDifficulty(
    stored.difficulty_key
      || metadata?.video_signals?.variant?.difficulty
      || publication.playlist_difficulty_key,
  );

  return {
    schema_version: 'youtube-playlist-classification-v1',
    template_key: templateKey,
    template_title: buildPlaylistTemplateTitle(
      metadata.template_id || publication.template_id || templateId,
      stored.template_title || publication.playlist_template_title,
    ),
    ...(difficulty ? { difficulty_key: difficulty } : {}),
  };
}
