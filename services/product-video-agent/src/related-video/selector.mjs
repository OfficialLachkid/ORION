function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function normalizeList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeToken(value))
      .filter(Boolean),
  )];
}

function workflowState(publication = {}) {
  if (publication.metadata?.workflow_state) {
    return String(publication.metadata.workflow_state).trim().toLowerCase();
  }
  return String(publication.status || '').trim().toLowerCase();
}

function publishedAtMs(publication = {}) {
  const dateValue = publication.published_at
    || publication.metadata?.youtube_live_published_at
    || publication.uploaded_at
    || publication.created_at
    || '1970-01-01T00:00:00.000Z';
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function getPublicationCanonicalUrl(publication = {}) {
  const publicUrl = String(publication.public_url || '').trim();
  if (publicUrl) {
    return publicUrl;
  }
  const externalId = String(publication.external_id || '').trim();
  return externalId ? `https://youtube.com/shorts/${externalId}` : '';
}

function buildExactTypePairKey(typePair = []) {
  return normalizeList(typePair).sort().join('::');
}

function buildRecentRelatedTargetIdSet(publications, targetPublication, windowSize = 5) {
  const sameChannelRows = (Array.isArray(publications) ? publications : [])
    .filter((publication) => (
      publication
      && publication.id !== targetPublication?.id
      && publication.platform === targetPublication?.platform
      && publication.account_key === targetPublication?.account_key
      && workflowState(publication) === 'published'
    ))
    .sort((left, right) => publishedAtMs(right) - publishedAtMs(left))
    .slice(0, Math.max(0, Number(windowSize) || 0));

  return new Set(
    sameChannelRows
      .map((publication) => String(publication?.metadata?.related_video?.target_publication_id || '').trim())
      .filter(Boolean),
  );
}

function buildGenericScore(candidateProfile, targetProfile) {
  let score = 0;
  const reasons = [];

  if (candidateProfile.content_lane && candidateProfile.content_lane === targetProfile.content_lane) {
    score += 40;
    reasons.push('same content lane');
  }
  if (candidateProfile.template_key && candidateProfile.template_key === targetProfile.template_key) {
    score += 35;
    reasons.push('same template');
  }
  if (candidateProfile.series_key && candidateProfile.series_key === targetProfile.series_key) {
    score += 20;
    reasons.push('same series');
  }

  return { score, reasons };
}

export function buildPublicationContentProfile({
  publication,
  video = null,
  channelProfile = null,
} = {}) {
  const normalizedTypePair = normalizeList(
    publication?.metadata?.type_pair
      || video?.render?.type_pair
      || publication?.render?.type_pair
      || [],
  );
  const selectedSubjects = Array.isArray(publication?.metadata?.selected_subjects)
    ? publication.metadata.selected_subjects
    : Array.isArray(video?.render?.selected_subjects)
      ? video.render.selected_subjects
      : [];
  const subjectKeys = normalizeList(
    selectedSubjects.map((subject) => (
      typeof subject === 'string' ? subject : subject?.name || ''
    )),
  );
  const hashtagKeys = normalizeList(
    (publication?.hashtags || []).map((hashtag) => String(hashtag || '').replace(/^#/u, '')),
  ).filter((value) => value !== 'pokemon' && value !== 'shorts');
  const templateKey = normalizeToken(
    publication?.metadata?.template_id
      || video?.template_key
      || publication?.template_key
      || channelProfile?.content_lane
      || '',
  );
  const contentLane = normalizeToken(
    publication?.content_lane
      || video?.content_lane
      || channelProfile?.content_lane
      || '',
  );

  return {
    platform: normalizeToken(publication?.platform || channelProfile?.platform || ''),
    account_key: normalizeToken(publication?.account_key || channelProfile?.account_key || ''),
    content_lane: contentLane,
    template_key: templateKey,
    series_key: [contentLane, templateKey].filter(Boolean).join(':'),
    type_pair: normalizedTypePair,
    exact_type_pair_key: buildExactTypePairKey(normalizedTypePair),
    subject_keys: subjectKeys,
    topic_keys: hashtagKeys,
  };
}

function isEligiblePublishedCandidate(candidate, targetPublication) {
  return Boolean(
    candidate
      && candidate.id !== targetPublication?.id
      && candidate.platform === targetPublication?.platform
      && candidate.account_key === targetPublication?.account_key
      && workflowState(candidate) === 'published'
      && getPublicationCanonicalUrl(candidate),
  );
}

function selectCandidatePool(candidates, recentTargetIds) {
  const freshCandidates = candidates.filter((candidate) => !recentTargetIds.has(candidate.publication.id));
  return {
    pool: freshCandidates.length > 0 ? freshCandidates : candidates,
    reusedRecentTarget: freshCandidates.length === 0 && candidates.length > 0,
  };
}

function buildSelectionReason({
  scoreReasons,
  reusedRecentTarget,
  exactPairExcluded,
}) {
  const reasons = [];
  if (scoreReasons.length > 0) {
    reasons.push(`Selected for ${scoreReasons.join(', ')}`);
  } else {
    reasons.push('Selected as the best recent published short on this channel');
  }
  if (exactPairExcluded) {
    reasons.push('exact same type-pair targets stay excluded for Poke Quizz');
  }
  if (reusedRecentTarget) {
    reasons.push('all fresher related targets were recently used, so the reuse guard fell back');
  } else {
    reasons.push('the recent related-target reuse guard was respected');
  }
  return reasons.join('; ');
}

export function mergeRelatedVideoRuntimeState(existingRelatedVideo = {}, plannedRelatedVideo = {}) {
  const sameTarget = String(existingRelatedVideo?.target_publication_id || '').trim()
    && String(existingRelatedVideo?.target_publication_id || '').trim() === String(plannedRelatedVideo?.target_publication_id || '').trim();

  return {
    ...plannedRelatedVideo,
    capability_status: sameTarget
      ? String(existingRelatedVideo?.capability_status || plannedRelatedVideo?.capability_status || 'pending').trim()
      : String(plannedRelatedVideo?.capability_status || 'pending').trim(),
    capability_checked_at: sameTarget
      ? String(existingRelatedVideo?.capability_checked_at || '').trim()
      : '',
    apply_status: sameTarget
      ? String(existingRelatedVideo?.apply_status || plannedRelatedVideo?.apply_status || 'pending').trim()
      : String(plannedRelatedVideo?.apply_status || 'pending').trim(),
    applied_at: sameTarget
      ? String(existingRelatedVideo?.applied_at || '').trim()
      : '',
    last_attempted_at: sameTarget
      ? String(existingRelatedVideo?.last_attempted_at || '').trim()
      : '',
    last_error: sameTarget
      ? String(existingRelatedVideo?.last_error || '').trim()
      : '',
    studio_edit_url: sameTarget
      ? String(existingRelatedVideo?.studio_edit_url || '').trim()
      : '',
  };
}

export function planRelatedVideoSelection({
  publications,
  targetPublication,
  targetVideo = null,
  channelProfile = null,
  asOf = new Date().toISOString(),
  recentReuseWindow = 5,
} = {}) {
  const targetProfile = buildPublicationContentProfile({
    publication: targetPublication,
    video: targetVideo,
    channelProfile,
  });
  const exactPairExcluded = targetProfile.content_lane === 'poke-quizz';
  const recentTargetIds = buildRecentRelatedTargetIdSet(publications, targetPublication, recentReuseWindow);
  const candidateEntries = (Array.isArray(publications) ? publications : [])
    .filter((publication) => isEligiblePublishedCandidate(publication, targetPublication))
    .map((publication) => {
      const candidateProfile = buildPublicationContentProfile({ publication, channelProfile });
      const exactPairMatch = exactPairExcluded
        && candidateProfile.exact_type_pair_key
        && candidateProfile.exact_type_pair_key === targetProfile.exact_type_pair_key;
      const { score, reasons } = buildGenericScore(candidateProfile, targetProfile);
      return {
        publication,
        profile: candidateProfile,
        url: getPublicationCanonicalUrl(publication),
        publishedAtMs: publishedAtMs(publication),
        exactPairMatch,
        score,
        scoreReasons: reasons,
      };
    })
    .filter((entry) => !entry.exactPairMatch)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.publishedAtMs - left.publishedAtMs;
    });

  const { pool, reusedRecentTarget } = selectCandidatePool(candidateEntries, recentTargetIds);
  const selected = pool[0] || null;
  if (!selected) {
    const relatedVideo = mergeRelatedVideoRuntimeState(
      targetPublication?.metadata?.related_video || {},
      {
        selector_version: 'related-video-v1',
        content_profile: targetProfile,
        selection_status: 'none',
        selected_at: new Date(asOf).toISOString(),
        recent_reuse_window: Math.max(0, Number(recentReuseWindow) || 0),
        target_publication_id: '',
        target_video_id: '',
        target_external_id: '',
        target_url: '',
        target_title: '',
        target_type_pair: [],
        match_reason: exactPairExcluded
          ? 'No eligible published short was available after excluding exact same Poke Quizz type pairs.'
          : 'No eligible published short was available for this channel.',
        capability_status: 'pending',
        apply_status: 'pending',
      },
    );
    return {
      candidate: null,
      relatedVideo,
    };
  }

  const relatedVideo = mergeRelatedVideoRuntimeState(
    targetPublication?.metadata?.related_video || {},
    {
      selector_version: 'related-video-v1',
      content_profile: targetProfile,
      selection_status: 'planned',
      selected_at: new Date(asOf).toISOString(),
      recent_reuse_window: Math.max(0, Number(recentReuseWindow) || 0),
      target_publication_id: selected.publication.id,
      target_video_id: selected.publication.video_id || '',
      target_external_id: selected.publication.external_id || '',
      target_url: selected.url,
      target_title: String(selected.publication.title || '').trim(),
      target_type_pair: normalizeList(selected.publication?.metadata?.type_pair || []),
      match_reason: buildSelectionReason({
        scoreReasons: selected.scoreReasons,
        reusedRecentTarget,
        exactPairExcluded,
      }),
      capability_status: 'pending',
      apply_status: 'pending',
    },
  );

  return {
    candidate: selected.publication,
    relatedVideo,
  };
}

export function selectRelatedPublicationCandidate(publications, targetPublication, options = {}) {
  return planRelatedVideoSelection({
    publications,
    targetPublication,
    targetVideo: options.targetVideo || null,
    channelProfile: options.channelProfile || null,
    asOf: options.asOf || new Date().toISOString(),
    recentReuseWindow: options.recentReuseWindow ?? 5,
  }).candidate;
}
