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

export function orderLandscapeTemplateSpecs(specs = [], seed = '', shuffleEnabled = true) {
  const eligible = specs.filter((entry) => String(entry?.key || '').trim() !== 'tournament');
  return shuffleEnabled ? shuffle(eligible, createPrng(`${seed}:section-order`)) : [...eligible];
}

export function selectLandscapeBackground(backgrounds = [], seed = '', sectionIndex = 0) {
  if (!Array.isArray(backgrounds) || backgrounds.length === 0) return null;
  const startIndex = hashSeed(`${seed}:background-order`) % backgrounds.length;
  const index = (startIndex + Math.max(0, Number(sectionIndex) || 0)) % backgrounds.length;
  return backgrounds[index] || backgrounds[0];
}

export function buildMixedChallengePlan({
  template,
  seed,
  channelProfile,
  sections = [],
  selectionState = {},
}) {
  const selectedSubjects = [];
  const seenSubjects = new Set();
  for (const section of sections) {
    for (const subject of section?.selected_subjects || []) {
      const key = subjectKey(subject);
      if (!key || seenSubjects.has(key)) continue;
      seenSubjects.add(key);
      selectedSubjects.push(subject);
    }
  }
  const totalDurationSeconds = Number(sections.reduce(
    (sum, section) => sum + Number(section?.duration_seconds || 0),
    0,
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
      section_count: sections.length,
      template_keys: sections.map((section) => section.template_key),
      selected_subject_count: selectedSubjects.length,
      selected_subjects: selectedSubjects,
    },
    sections,
    timing: {
      total_duration_seconds: totalDurationSeconds,
    },
    assets: {
      background: {
        selected_path: sections[0]?.background_source_path || null,
        selected_paths: sections.map((section) => section.background_source_path).filter(Boolean),
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
