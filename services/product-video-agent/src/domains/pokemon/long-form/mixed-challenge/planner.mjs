function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'pokemon-long-mixed-challenge')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createPrng(seedInput) {
  let seed = hashSeed(seedInput) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function transitionFileName(path) {
  return String(path || '').trim().split(/[\\/]/u).pop()?.toLowerCase() || '';
}

function resolveTransitionKeyProfile(path, config = {}) {
  const key = transitionFileName(path);
  if (/^transition-0[1-3]\.mp4$/u.test(key)) {
    return {
      key,
      key_color: '0x00FF00',
      similarity: Number(config.green_key_similarity ?? 0.22),
      blend: Number(config.green_key_blend ?? 0.08),
    };
  }
  if (/^(transition-04|transition1-0[1-3])\.mp4$/u.test(key)) {
    return {
      key,
      key_color: '0x000000',
      similarity: Number(config.black_key_similarity ?? 0.08),
      blend: Number(config.black_key_blend ?? 0.04),
    };
  }
  return null;
}

export function selectMixedChallengeRoundTransitions(
  transitionPaths = [],
  seed = '',
  requestedCount = 0,
  previousTransitionKey = '',
  config = {},
) {
  const count = Math.max(0, Math.round(Number(requestedCount) || 0));
  if (count === 0 || config?.enabled === false) return [];
  const pokeballDuration = Math.max(0.5, Number(config.duration_seconds || 1.15));
  const externalDuration = Math.max(0.5, Number(config.external_duration_seconds || 3));
  const candidates = [...new Map(
    (Array.isArray(transitionPaths) ? transitionPaths : [])
      .map((path) => ({ path: String(path || '').trim(), profile: resolveTransitionKeyProfile(path, config) }))
      .filter((entry) => entry.path && entry.profile)
      .map((entry) => [entry.profile.key, entry]),
  ).values()];
  const selected = [{
    key: 'pokeball',
    kind: 'pokeball',
    duration_seconds: pokeballDuration,
    direction_multiplier: hashSeed(`${seed}:first-pokeball-direction`) % 2 === 0 ? -1 : 1,
  }];
  let lastKey = String(previousTransitionKey || '').trim().toLowerCase();
  let bagIndex = 0;
  while (selected.length < count && candidates.length > 0) {
    const bag = shuffle(candidates, createPrng(`${seed}:round-transition-bag:${bagIndex}`));
    if (bag.length > 1 && bag[0].profile.key === lastKey) {
      [bag[0], bag[1]] = [bag[1], bag[0]];
    }
    for (const candidate of bag) {
      if (selected.length >= count) break;
      selected.push({
        key: candidate.profile.key,
        kind: 'keyed_overlay',
        path: candidate.path,
        duration_seconds: externalDuration,
        chroma_key_color: candidate.profile.key_color,
        chroma_similarity: candidate.profile.similarity,
        chroma_blend: candidate.profile.blend,
      });
      lastKey = candidate.profile.key;
    }
    bagIndex += 1;
  }
  while (selected.length < count) {
    selected.push({
      key: 'pokeball',
      kind: 'pokeball',
      duration_seconds: pokeballDuration,
      direction_multiplier: selected.length % 2 === 0 ? -1 : 1,
    });
  }
  return selected;
}

function subjectKey(subject = {}) {
  return String(
    subject.id
      || subject.national_dex_number
      || subject.slug
      || subject.name
      || subject.sprite_path
      || '',
  ).trim().toLowerCase();
}

export function orderLandscapeTemplateSpecs(
  specs = [],
  seed = '',
  shuffleEnabled = true,
  excludedTemplateKeys = [],
) {
  const excludedKeys = new Set([
    'tournament',
    ...(Array.isArray(excludedTemplateKeys) ? excludedTemplateKeys : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const eligible = specs.filter((entry) => !excludedKeys.has(
    String(entry?.key || '').trim().toLowerCase(),
  ));
  return shuffleEnabled ? shuffle(eligible, createPrng(`${seed}:section-order`)) : [...eligible];
}

export function selectLandscapeBackground(backgrounds = [], seed = '', sectionIndex = 0) {
  if (!Array.isArray(backgrounds) || backgrounds.length === 0) return null;
  const startIndex = hashSeed(`${seed}:background-order`) % backgrounds.length;
  const index = (startIndex + Math.max(0, Number(sectionIndex) || 0)) % backgrounds.length;
  return backgrounds[index] || backgrounds[0];
}

export function selectMixedChallengeIntroMusic(musicPaths = [], firstSectionMusicPath = '', seed = '') {
  const normalizedFirstPath = String(firstSectionMusicPath || '').trim();
  const candidates = [...new Set(musicPaths.map((value) => String(value || '').trim()).filter(Boolean))];
  const alternatives = candidates.filter((value) => value !== normalizedFirstPath);
  const pool = alternatives.length > 0 ? alternatives : candidates;
  if (pool.length === 0) return null;
  return pool[hashSeed(`${seed}:intro-music`) % pool.length];
}

export function selectMixedChallengeIntroPokeballs(
  pokeballPaths = [],
  seed = '',
  requestedCount = 4,
) {
  const count = Math.max(0, Math.round(Number(requestedCount) || 0));
  const candidates = [...new Set(
    (Array.isArray(pokeballPaths) ? pokeballPaths : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  const random = createPrng(`${seed}:intro-pokeballs`);
  return shuffle(candidates, random).slice(0, count).map((path) => ({
    path,
    speed_multiplier: Number((0.92 + (random() * 0.16)).toFixed(3)),
    direction_multiplier: random() < 0.5 ? -1 : 1,
  }));
}

export function assignMixedChallengeDifficulty(sections = [], template = {}) {
  const configuredLevels = Array.isArray(template?.episode?.difficulty_levels)
    ? template.episode.difficulty_levels
    : [];
  const levels = configuredLevels.length > 0
    ? configuredLevels
    : [
      { key: 'easy', label: 'EASY ROUND', accent_color: '0x45D483' },
      { key: 'medium', label: 'MEDIUM ROUND', accent_color: '0xFFD60A' },
      { key: 'hard', label: 'HARD ROUND', accent_color: '0xFF5B62' },
    ];
  const groupSize = Math.max(1, Math.ceil(sections.length / levels.length));
  return sections.map((section, index) => {
    const level = levels[Math.min(levels.length - 1, Math.floor(index / groupSize))];
    return {
      ...section,
      long_form_round_number: index + 1,
      long_form_round_total: sections.length,
      difficulty: {
        key: String(level?.key || `level-${index + 1}`),
        label: String(level?.label || 'ROUND'),
        accent_color: String(level?.accent_color || '0xFFD60A'),
      },
    };
  });
}

export function buildMixedChallengePlan({
  template,
  seed,
  channelProfile,
  sections = [],
  selectionState = {},
  programAssets = {},
}) {
  const arrangedSections = assignMixedChallengeDifficulty(sections, template);
  const selectedSubjects = [];
  const seenSubjects = new Set();
  for (const section of arrangedSections) {
    for (const subject of section?.selected_subjects || []) {
      const key = subjectKey(subject);
      if (!key || seenSubjects.has(key)) continue;
      seenSubjects.add(key);
      selectedSubjects.push(subject);
    }
  }
  const sectionsDurationSeconds = Number(arrangedSections.reduce(
    (sum, section) => sum + Number(section?.duration_seconds || 0),
    0,
  ).toFixed(3));
  const introDurationSeconds = Math.max(0, Number(template?.episode?.intro_duration_seconds || 0));
  const chapterIntroDurationSeconds = Math.max(0, Number(template?.episode?.chapter_intro_duration_seconds || 0));
  const outroDurationSeconds = Math.max(0, Number(template?.episode?.outro_duration_seconds || 0));
  const chapterCount = new Set(arrangedSections.map((section) => section?.difficulty?.key).filter(Boolean)).size;
  const roundTransitions = Array.isArray(programAssets?.round_transitions)
    ? programAssets.round_transitions
    : [];
  const roundTransitionDurationSeconds = Math.max(
    0,
    Number(template?.layout?.round_transition?.duration_seconds || 0),
  );
  const roundTransitionsDurationSeconds = Number(roundTransitions.reduce(
    (sum, transition) => sum + Math.max(0, Number(transition?.duration_seconds || 0)),
    0,
  ).toFixed(3));
  const totalDurationSeconds = Number((
    sectionsDurationSeconds
    + introDurationSeconds
    + (chapterIntroDurationSeconds * chapterCount)
    + roundTransitionsDurationSeconds
    + outroDurationSeconds
  ).toFixed(3));
  const publication = template?.publication || {};

  return {
    schema_version: 'pokemon-long-form-mixed-challenge-plan-v1',
    channel: {
      id: String(channelProfile?.id || ''),
      name: String(channelProfile?.name || 'Poke Quizz'),
      account_key: String(channelProfile?.account_key || ''),
      niche: String(channelProfile?.niche || 'pokemon_quiz'),
      content_lane: 'pokemon_long_form_mixed_challenge',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    content_format: 'long_form',
    content_surface: 'youtube_watch',
    media_profile: {
      width: Number(template?.canvas?.width || 1920),
      height: Number(template?.canvas?.height || 1080),
      fps: Number(template?.canvas?.fps || 30),
      aspect_ratio: '16:9',
    },
    selection: {
      mode: 'mixed_landscape_challenges',
      section_count: arrangedSections.length,
      template_keys: arrangedSections.map((section) => section.template_key),
      selected_subject_count: selectedSubjects.length,
      selected_subjects: selectedSubjects,
    },
    sections: arrangedSections,
    timing: {
      sections_duration_seconds: sectionsDurationSeconds,
      intro_duration_seconds: introDurationSeconds,
      chapter_intro_duration_seconds: chapterIntroDurationSeconds,
      round_transition_duration_seconds: roundTransitionDurationSeconds,
      round_transitions_duration_seconds: roundTransitionsDurationSeconds,
      outro_duration_seconds: outroDurationSeconds,
      total_duration_seconds: totalDurationSeconds,
    },
    assets: {
      background: {
        selected_path: arrangedSections[0]?.background_source_path || null,
        selected_paths: arrangedSections.map((section) => section.background_source_path).filter(Boolean),
      },
      program: {
        intro_music_path: String(programAssets?.intro_music_path || '').trim() || null,
        intro_pokeballs: Array.isArray(programAssets?.intro_pokeballs)
          ? programAssets.intro_pokeballs
          : [],
        subscribe_reminder_path: String(programAssets?.subscribe_reminder_path || '').trim() || null,
        round_transitions: roundTransitions,
      },
      outputs: {
        previews_directory: arrangedSections[0]?.previews_directory || '',
      },
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: [],
    },
    publication: {
      title: String(publication.title || 'The Ultimate Pokemon Challenge Compilation'),
      description: String(publication.description || 'Play every Pokemon challenge in one video.'),
      hashtags: Array.isArray(publication.hashtags) ? publication.hashtags : ['#pokemon', '#pokemonquiz'],
    },
    publication_policy: {
      manual_review_required: true,
      night_shift_enabled: false,
      related_video_enabled: false,
      auto_comment_enabled: false,
      ...(template?.publication_policy || {}),
      watermark_enabled: false,
    },
    selection_state: selectionState,
  };
}
