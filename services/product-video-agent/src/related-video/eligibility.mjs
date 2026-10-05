function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

export function isRelatedVideoEligiblePublication(publication = {}) {
  if (publication?.metadata?.publication_policy?.related_video_enabled === false) {
    return false;
  }

  const contentSurface = normalizeToken(publication?.metadata?.content_surface);
  if (contentSurface) {
    return contentSurface === 'youtube_shorts';
  }

  // Older Shorts predate content_surface metadata. Their platform remains a
  // reliable fallback, while newer long-form rows explicitly use
  // content_surface=youtube_watch and are rejected above.
  return normalizeToken(publication?.platform) === 'youtube_shorts';
}
