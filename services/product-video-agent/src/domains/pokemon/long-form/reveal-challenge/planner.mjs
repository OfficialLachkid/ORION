function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'pokemon-reveal-challenge')) {
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

function ensureNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function revealSubjectKey(subject = {}) {
  return normalizedKey(
    subject.pokedex_id
      || subject.id
      || subject.national_dex_number
      || subject.slug
      || subject.name
      || subject.sprite_path,
  );
}

export function resolveRevealChallengeDurationConfig(template = {}) {
  const minimum = Math.max(60, ensureNumber(template?.episode?.minimum_duration_seconds, 360));
  const maximum = Math.max(minimum, ensureNumber(template?.episode?.maximum_duration_seconds, 600));
  const target = Math.min(
    maximum,
    Math.max(minimum, ensureNumber(template?.episode?.target_duration_seconds, 390)),
  );
  const intro = Math.max(0, ensureNumber(template?.episode?.intro_duration_seconds, 5));
  const outro = Math.max(0, ensureNumber(template?.episode?.outro_duration_seconds, 6));
  return {
    minimum_seconds: minimum,
    target_seconds: target,
    maximum_seconds: maximum,
    intro_seconds: intro,
    outro_seconds: outro,
  };
}

export function selectNextRevealTemplateSpec({
  specs = [],
  template = {},
  seed = '',
  sectionIndex = 0,
  previousTemplateKey = '',
  usageCounts = {},
} = {}) {
  const allowedKeys = new Set(
    (Array.isArray(template?.episode?.reveal_template_keys)
      ? template.episode.reveal_template_keys
      : [])
      .map(normalizedKey)
      .filter(Boolean),
  );
  const eligible = specs.filter((spec) => (
    !allowedKeys.size || allowedKeys.has(normalizedKey(spec?.key))
  ));
  if (eligible.length === 0) {
    throw new Error('Reveal-only long-form requires at least one eligible reveal template.');
  }
  const normalizedPrevious = normalizedKey(previousTemplateKey);
  const nonRepeating = eligible.filter((spec) => normalizedKey(spec.key) !== normalizedPrevious);
  const candidates = nonRepeating.length > 0 ? nonRepeating : eligible;
  const weights = template?.episode?.reveal_template_weights || {};
  const minimumScore = Math.min(...candidates.map((spec) => {
    const weight = Math.max(0.01, ensureNumber(weights[spec.key], 1));
    return ensureNumber(usageCounts[spec.key], 0) / weight;
  }));
  const balanced = candidates.filter((spec) => {
    const weight = Math.max(0.01, ensureNumber(weights[spec.key], 1));
    return Math.abs((ensureNumber(usageCounts[spec.key], 0) / weight) - minimumScore) < 0.000001;
  });
  const random = createPrng(`${seed}:section-template:${sectionIndex}`);
  return balanced[Math.floor(random() * balanced.length)] || balanced[0] || candidates[0];
}

export function shouldAppendRevealSection({
  currentDurationSeconds = 0,
  nextSectionDurationSeconds = 0,
  template = {},
} = {}) {
  const duration = resolveRevealChallengeDurationConfig(template);
  const current = Math.max(0, ensureNumber(currentDurationSeconds, 0));
  const next = Math.max(0, ensureNumber(nextSectionDurationSeconds, 0));
  if (current < duration.minimum_seconds) return true;
  if (current >= duration.target_seconds) return false;
  return current + next <= duration.maximum_seconds;
}

export function filterUnusedRevealSubjects(pokedexRows = [], usedSubjectKeys = [], minimumCount = 1) {
  const used = usedSubjectKeys instanceof Set
    ? usedSubjectKeys
    : new Set((Array.isArray(usedSubjectKeys) ? usedSubjectKeys : []).map(normalizedKey));
  const fresh = (Array.isArray(pokedexRows) ? pokedexRows : []).filter(
    (subject) => !used.has(revealSubjectKey(subject)),
  );
  return fresh.length >= Math.max(1, Number(minimumCount) || 1) ? fresh : pokedexRows;
}

export function assignRevealChallengeBackgrounds({
  sections = [],
  backgrounds = [],
  template = {},
  seed = '',
  previousBackgroundPath = '',
} = {}) {
  const interval = Math.max(
    1,
    Math.round(ensureNumber(template?.episode?.background_switch_interval_sections, 2)),
  );
  const candidates = [...new Map(
    backgrounds
      .map((entry) => (typeof entry === 'string' ? { path: entry } : entry))
      .filter((entry) => String(entry?.path || '').trim())
      .map((entry) => [String(entry.path), entry]),
  ).values()];
  if (candidates.length === 0) return sections.map((section) => ({ ...section }));
  const random = createPrng(`${seed}:background-groups`);
  const startIndex = Math.floor(random() * candidates.length);
  const normalizedPrevious = normalizedKey(previousBackgroundPath);
  const groupPaths = [];
  const groupCount = Math.ceil(sections.length / interval);
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    let candidateIndex = (startIndex + groupIndex) % candidates.length;
    let candidate = candidates[candidateIndex];
    const lastPath = groupPaths.at(-1) || normalizedPrevious;
    if (candidates.length > 1 && normalizedKey(candidate.path) === normalizedKey(lastPath)) {
      candidateIndex = (candidateIndex + 1) % candidates.length;
      candidate = candidates[candidateIndex];
    }
    groupPaths.push(candidate.path);
  }
  return sections.map((section, index) => ({
    ...section,
    background_group: Math.floor(index / interval) + 1,
    background_source_path: groupPaths[Math.floor(index / interval)],
  }));
}

export function selectRevealChallengeMusicSchedule({
  tracks = [],
  totalDurationSeconds = 0,
  crossfadeSeconds = 2,
  endingFadeSeconds = 2.5,
  seed = '',
  previousTrackPath = '',
} = {}) {
  const totalDuration = Math.max(0, ensureNumber(totalDurationSeconds, 0));
  const crossfade = Math.max(0, ensureNumber(crossfadeSeconds, 2));
  const endingFade = Math.max(0, ensureNumber(endingFadeSeconds, 2.5));
  const candidates = tracks
    .map((track) => ({
      path: String(track?.path || '').trim(),
      duration_seconds: Math.max(0, ensureNumber(track?.duration_seconds, 0)),
    }))
    .filter((track) => track.path && track.duration_seconds > Math.max(1, crossfade));
  if (totalDuration <= 0 || candidates.length === 0) return [];

  const schedule = [];
  let previousPath = String(previousTrackPath || '').trim();
  while ((schedule.at(-1)?.end_seconds || 0) < totalDuration && schedule.length < 100) {
    const alternatives = candidates.filter((track) => track.path !== previousPath);
    const pool = alternatives.length > 0 ? alternatives : candidates;
    const random = createPrng(`${seed}:music:${schedule.length}`);
    const track = pool[Math.floor(random() * pool.length)] || pool[0];
    const startSeconds = schedule.length === 0
      ? 0
      : Math.max(0, schedule.at(-1).end_seconds - crossfade);
    const endSeconds = Math.min(totalDuration, startSeconds + track.duration_seconds);
    const playDuration = endSeconds - startSeconds;
    const isFinal = endSeconds >= totalDuration;
    schedule.push({
      path: track.path,
      start_seconds: Number(startSeconds.toFixed(3)),
      end_seconds: Number(endSeconds.toFixed(3)),
      duration_seconds: Number(playDuration.toFixed(3)),
      fade_in_seconds: Number((schedule.length === 0 ? Math.min(0.6, playDuration / 2) : Math.min(crossfade, playDuration / 2)).toFixed(3)),
      fade_out_seconds: Number((isFinal ? Math.min(endingFade, playDuration / 2) : Math.min(crossfade, playDuration / 2)).toFixed(3)),
    });
    previousPath = track.path;
  }
  return schedule;
}

export function buildRevealChallengePlan({
  template,
  seed,
  channelProfile,
  sections = [],
  musicSchedule = [],
  selectionState = {},
} = {}) {
  const duration = resolveRevealChallengeDurationConfig(template);
  const sectionsDuration = Number(sections.reduce(
    (sum, section) => sum + Math.max(0, ensureNumber(section?.duration_seconds, 0)),
    0,
  ).toFixed(3));
  const totalDuration = Number((
    duration.intro_seconds + sectionsDuration + duration.outro_seconds
  ).toFixed(3));
  const selectedSubjects = [];
  const seenSubjects = new Set();
  const revealMethods = [];
  let roundCount = 0;
  for (const section of sections) {
    roundCount += Math.max(0, Number(section?.round_count) || 0);
    revealMethods.push(...(Array.isArray(section?.reveal_methods) ? section.reveal_methods : []));
    for (const subject of section?.selected_subjects || []) {
      const key = revealSubjectKey(subject);
      if (!key || seenSubjects.has(key)) continue;
      seenSubjects.add(key);
      selectedSubjects.push(subject);
    }
  }
  const publication = template?.publication || {};
  return {
    schema_version: 'pokemon-long-form-reveal-challenge-plan-v1',
    channel: {
      id: String(channelProfile?.id || ''),
      name: String(channelProfile?.name || 'Poke Quizz'),
      account_key: String(channelProfile?.account_key || ''),
      niche: String(channelProfile?.niche || 'pokemon_quiz'),
      content_lane: 'pokemon_long_form_reveal_challenge',
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
      mode: 'reveal_challenge',
      section_count: sections.length,
      round_count: roundCount,
      template_keys: sections.map((section) => section.template_key),
      reveal_methods: revealMethods,
      selected_subject_count: selectedSubjects.length,
      selected_subjects: selectedSubjects,
    },
    sections,
    timing: {
      minimum_duration_seconds: duration.minimum_seconds,
      target_duration_seconds: duration.target_seconds,
      maximum_duration_seconds: duration.maximum_seconds,
      sections_duration_seconds: sectionsDuration,
      intro_duration_seconds: duration.intro_seconds,
      outro_duration_seconds: duration.outro_seconds,
      total_duration_seconds: totalDuration,
    },
    assets: {
      background: {
        selected_paths: [...new Set(sections.map((section) => section.background_source_path).filter(Boolean))],
      },
      audio: {
        music_schedule: musicSchedule,
      },
      outputs: {
        previews_directory: sections[0]?.previews_directory || '',
      },
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: [],
    },
    publication: {
      title: String(publication.title || 'Guess the Pokemon Reveal Challenge'),
      description: String(publication.description || 'Guess each Pokemon before the reveal completes.'),
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
