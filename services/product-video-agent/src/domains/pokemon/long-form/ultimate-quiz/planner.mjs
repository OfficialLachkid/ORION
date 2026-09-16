import { access } from 'node:fs/promises';
import {
  scanPokeQuizzAssetInventory,
  selectTypeIconSet,
} from '../../../../poke-quizz-asset-inventory.mjs';
import { resolvePokemonChannelIdentity } from '../../templates/shared/render/channel-watermark.mjs';
import { resolvePokemonCryPath } from '../../templates/shared/pokemon-cry-resolver.mjs';

const spriteAvailabilityCache = new Map();

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'pokemon-long-form')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seedInput) {
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

function pick(values, random, fallback = '') {
  const options = (Array.isArray(values) ? values : []).filter(Boolean);
  return options[Math.floor(random() * options.length)] || fallback;
}

function normalizeSubjectKey(subject = {}) {
  return String(subject.slug || subject.name || subject.national_dex_number || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-');
}

function isDefaultForm(row = {}) {
  const configured = row?.metadata?.pokemon_api?.is_default_form;
  return configured == null || configured === true;
}

function buildEligibleSubjects(pokedexRows = []) {
  const byDexNumber = new Map();
  for (const row of Array.isArray(pokedexRows) ? pokedexRows : []) {
    const dexNumber = Number.parseInt(String(row?.national_dex_number || ''), 10);
    if (!Number.isFinite(dexNumber) || dexNumber <= 0) continue;
    if (!String(row?.name || '').trim() || !String(row?.sprite_path || '').trim()) continue;
    if (!isDefaultForm(row) || byDexNumber.has(dexNumber)) continue;
    byDexNumber.set(dexNumber, row);
  }
  return [...byDexNumber.values()];
}

function selectChapterSubjects({
  subjects,
  chapter,
  count,
  random,
  usedKeys,
  recentKeys,
}) {
  const generationScope = new Set(
    (Array.isArray(chapter.generation_scope) ? chapter.generation_scope : [])
      .map(Number)
      .filter(Number.isFinite),
  );
  const inScope = (subject) => (
    generationScope.size === 0 || generationScope.has(Number(subject.generation))
  );
  const fresh = subjects.filter((subject) => {
    const key = normalizeSubjectKey(subject);
    return inScope(subject) && !usedKeys.has(key) && !recentKeys.has(key);
  });
  const available = subjects.filter((subject) => {
    const key = normalizeSubjectKey(subject);
    return inScope(subject) && !usedKeys.has(key);
  });
  const pool = fresh.length >= count ? fresh : available;
  const selected = shuffle(pool, random).slice(0, count);
  selected.forEach((subject) => usedKeys.add(normalizeSubjectKey(subject)));
  return selected;
}

function selectDistinctMedia(entries, count, random, previousPaths = []) {
  const previous = new Set((Array.isArray(previousPaths) ? previousPaths : []).map(String));
  const normalized = [...new Map(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => [String(entry?.path || entry || '').trim(), entry])
      .filter(([filePath]) => filePath),
  ).values()];
  const fresh = normalized.filter((entry) => !previous.has(String(entry?.path || entry)));
  const pool = fresh.length >= count ? fresh : normalized;
  return shuffle(pool, random).slice(0, count);
}

function buildRoundMode(chapter, index, random) {
  const modes = Array.isArray(chapter.modes) && chapter.modes.length > 0
    ? chapter.modes
    : ['silhouette'];
  const offset = Math.floor(random() * modes.length);
  return modes[(index + offset) % modes.length];
}

async function canAccessPath(filePath) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) return false;
  if (!spriteAvailabilityCache.has(normalizedPath)) {
    spriteAvailabilityCache.set(
      normalizedPath,
      access(normalizedPath).then(() => true).catch(() => false),
    );
  }
  return spriteAvailabilityCache.get(normalizedPath);
}

async function resolveRenderSpritePath(subject) {
  const animatedPath = String(subject?.animated_sprite_path || '').trim();
  if (animatedPath && await canAccessPath(animatedPath)) return animatedPath;
  return String(subject?.sprite_path || '').trim();
}

async function normalizeSelectedSubject(subject, cryPath = '') {
  return {
    id: subject.id || null,
    national_dex_number: Number(subject.national_dex_number),
    name: String(subject.name || '').trim(),
    slug: normalizeSubjectKey(subject),
    generation: Number(subject.generation || 0),
    region: String(subject.region || '').trim(),
    types: (Array.isArray(subject.types) ? subject.types : []).map(String),
    sprite_path: String(subject.sprite_path || '').trim(),
    animated_sprite_path: String(subject.animated_sprite_path || '').trim(),
    render_sprite_path: await resolveRenderSpritePath(subject),
    cry_path: String(cryPath || '').trim(),
  };
}

function typePairKey(types = []) {
  return (Array.isArray(types) ? types : [])
    .map((type) => String(type || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
}

async function buildTypeClueBoard({ subject, subjects, random, inventory, maxSubjects = 6 }) {
  const pair = (Array.isArray(subject?.types) ? subject.types : [])
    .map((type) => String(type || '').trim().toLowerCase())
    .filter(Boolean);
  if (pair.length !== 2) return null;
  const pairKey = typePairKey(pair);
  const matches = subjects.filter((candidate) => typePairKey(candidate.types) === pairKey);
  if (matches.length < 2) return null;

  const subjectKey = normalizeSubjectKey(subject);
  const otherMatches = shuffle(
    matches.filter((candidate) => normalizeSubjectKey(candidate) !== subjectKey),
    random,
  );
  const selected = shuffle(
    [subject, ...otherMatches.slice(0, Math.max(1, maxSubjects - 1))],
    random,
  );
  const typeIconSet = selectTypeIconSet(pair, inventory);
  const typeIcons = pair.map((type, index) => ({
    type,
    local_path: String(typeIconSet.file_paths[index] || '').trim(),
    style: typeIconSet.style,
    style_variant: typeIconSet.style_variant,
  }));
  const pokeballPath = String(inventory?.overlay_presets?.pokeball_primary || '').trim();
  if (!pokeballPath || typeIcons.some((icon) => !icon.local_path)) return null;

  return {
    type_pair: pair,
    type_icons: typeIcons,
    pokeball_path: pokeballPath,
    subjects: await Promise.all(selected.map((candidate) => normalizeSelectedSubject(candidate))),
  };
}

function buildPublicationMetadata(random) {
  const titles = [
    'The Ultimate Pokemon Quiz - Can You Get 24/24?',
    'Only Pokemon Experts Can Score 24/24!',
    'Easy to Impossible Pokemon Quiz!',
    'How Well Do You Really Know Pokemon?',
  ];
  return {
    title: pick(titles, random, titles[0]),
    description: 'Test your Pokemon knowledge across 24 questions and three difficulty levels. Keep track of your score, then share it in the comments.\n\nNew Pokemon quizzes and challenges are added regularly.',
    hashtags: ['pokemon', 'pokemonquiz', 'guessthepokemon', 'pokemontest'],
  };
}

export async function planUltimatePokemonQuiz({
  template,
  pokedexRows,
  seed = new Date().toISOString(),
  channelProfile = {},
  inventory = null,
  landscapeBackgrounds = [],
  selectionState = null,
}) {
  const random = createSeededRandom(seed);
  const assets = inventory || await scanPokeQuizzAssetInventory();
  const chaptersConfig = Array.isArray(template?.episode?.chapters) ? template.episode.chapters : [];
  if (chaptersConfig.length === 0) throw new Error('Long-form quiz template has no chapters.');
  const subjects = buildEligibleSubjects(pokedexRows);
  const requiredQuestionCount = chaptersConfig.reduce(
    (sum, chapter) => sum + Math.max(1, Number(chapter.question_count || 0)),
    0,
  );
  if (subjects.length < requiredQuestionCount) {
    throw new Error(`Long-form quiz needs ${requiredQuestionCount} unique Pokemon but only ${subjects.length} are eligible.`);
  }

  const backgroundCount = Math.max(1, Number(template?.assets?.background_count || chaptersConfig.length));
  const backgroundProgram = selectDistinctMedia(
    landscapeBackgrounds,
    backgroundCount,
    random,
    selectionState?.last_background_paths,
  );
  if (backgroundProgram.length < backgroundCount) {
    throw new Error(`Long-form quiz needs ${backgroundCount} eligible landscape backgrounds but found ${backgroundProgram.length}.`);
  }
  const musicCount = Math.max(1, Number(template?.assets?.music_count || chaptersConfig.length));
  const musicProgram = selectDistinctMedia(
    assets.music || [],
    musicCount,
    random,
    selectionState?.last_music_paths,
  ).map((entry) => String(entry?.path || entry));
  if (musicProgram.length === 0) throw new Error('Long-form quiz needs at least one approved music track.');

  const introDuration = Number(template?.episode?.intro_duration_seconds || 12);
  const chapterIntroDuration = Number(template?.episode?.chapter_intro_duration_seconds || 5);
  const questionDuration = Number(template?.episode?.question_duration_seconds || 6);
  const answerReveal = Number(template?.episode?.answer_reveal_seconds || 5);
  const outroDuration = Number(template?.episode?.outro_duration_seconds || 16);
  const recentKeys = new Set(selectionState?.recent_subject_keys || []);
  const usedKeys = new Set();
  const chapters = [];
  const rounds = [];
  let cursor = introDuration;
  let roundNumber = 1;

  for (let chapterIndex = 0; chapterIndex < chaptersConfig.length; chapterIndex += 1) {
    const chapterConfig = chaptersConfig[chapterIndex];
    const count = Math.max(1, Number(chapterConfig.question_count || 0));
    const selected = selectChapterSubjects({
      subjects,
      chapter: chapterConfig,
      count,
      random,
      usedKeys,
      recentKeys,
    });
    if (selected.length < count) {
      throw new Error(`Could not select ${count} unique Pokemon for ${chapterConfig.label || chapterConfig.key}.`);
    }
    const chapterStart = cursor;
    const questionsStart = chapterStart + chapterIntroDuration;
    const chapterRounds = [];
    for (let index = 0; index < selected.length; index += 1) {
      const subject = selected[index];
      const requestedMode = buildRoundMode(chapterConfig, index, random);
      const cryPath = await resolvePokemonCryPath(subject);
      const typeBoard = requestedMode === 'type_clue'
        ? await buildTypeClueBoard({ subject, subjects, random, inventory: assets })
        : null;
      const mode = requestedMode === 'cry_clue' && !cryPath
        ? 'silhouette'
        : requestedMode === 'type_clue' && !typeBoard
          ? 'silhouette'
          : requestedMode;
      const startSeconds = questionsStart + (index * questionDuration);
      const answerStartSeconds = startSeconds + answerReveal;
      const normalizedSubject = await normalizeSelectedSubject(subject, cryPath);
      const round = {
        round_number: roundNumber,
        chapter_key: String(chapterConfig.key || `chapter-${chapterIndex + 1}`),
        chapter_label: String(chapterConfig.label || `ROUND ${chapterIndex + 1}`),
        accent_color: String(chapterConfig.accent_color || '0xFFD60A'),
        mode,
        prompt: mode === 'cry_clue'
          ? 'WHICH POKEMON MADE THIS CRY?'
          : mode === 'type_clue'
            ? 'WHO MATCHES THESE TYPES?'
            : 'WHO IS THAT POKEMON?',
        start_seconds: Number(startSeconds.toFixed(3)),
        answer_start_seconds: Number(answerStartSeconds.toFixed(3)),
        end_seconds: Number((startSeconds + questionDuration).toFixed(3)),
        subject: normalizedSubject,
        type_board: mode === 'type_clue' ? typeBoard : null,
      };
      chapterRounds.push(round);
      rounds.push(round);
      roundNumber += 1;
    }
    const chapterEnd = questionsStart + (selected.length * questionDuration);
    chapters.push({
      key: String(chapterConfig.key || `chapter-${chapterIndex + 1}`),
      label: String(chapterConfig.label || `ROUND ${chapterIndex + 1}`),
      accent_color: String(chapterConfig.accent_color || '0xFFD60A'),
      start_seconds: Number(chapterStart.toFixed(3)),
      questions_start_seconds: Number(questionsStart.toFixed(3)),
      end_seconds: Number(chapterEnd.toFixed(3)),
      background: backgroundProgram[chapterIndex % backgroundProgram.length],
      music_path: musicProgram[chapterIndex % musicProgram.length],
      rounds: chapterRounds.map((round) => round.round_number),
    });
    cursor = chapterEnd;
  }

  const outroStart = cursor;
  const totalDuration = Number((outroStart + outroDuration).toFixed(3));
  if (totalDuration <= 0) throw new Error('Long-form quiz runtime must be positive.');
  const introText = pick(template?.question_contract?.intro_spoken_variants, random);
  const outroText = pick(template?.question_contract?.outro_spoken_variants, random);
  const hookText = pick(template?.question_contract?.hook_variants, random, 'THE ULTIMATE POKEMON QUIZ');
  const narrationCues = [
    { role: 'intro', text: introText, start_seconds: 0 },
    ...chapters.map((chapter, index) => ({
      role: `chapter-${index + 1}`,
      text: `${chapter.label}. Eight Pokemon. One point for every correct answer.`,
      start_seconds: chapter.start_seconds + 0.35,
    })),
    { role: 'outro', text: outroText, start_seconds: outroStart + 0.35 },
  ].filter((cue) => cue.text);

  const selectedSubjects = rounds.map((round) => round.subject);
  return {
    schema_version: 'pokemon-long-form-plan-v1',
    template_id: template.template_id,
    template_key: template.template_key,
    content_format: 'long_form',
    content_surface: 'youtube_watch',
    seed,
    channel: resolvePokemonChannelIdentity(channelProfile),
    media_profile: {
      width: Number(template?.canvas?.width || 1920),
      height: Number(template?.canvas?.height || 1080),
      fps: Number(template?.canvas?.fps || 30),
      aspect_ratio: '16:9',
    },
    timing: {
      intro_duration_seconds: introDuration,
      chapter_intro_duration_seconds: chapterIntroDuration,
      question_duration_seconds: questionDuration,
      answer_reveal_seconds: answerReveal,
      outro_start_seconds: Number(outroStart.toFixed(3)),
      outro_duration_seconds: outroDuration,
      total_duration_seconds: totalDuration,
    },
    presentation: { hook_text: hookText },
    chapters,
    rounds,
    narration: { cues: narrationCues },
    selection: {
      mode: 'ultimate_quiz',
      round_count: rounds.length,
      selected_subjects: selectedSubjects,
    },
    assets: {
      backgrounds: backgroundProgram,
      audio: {
        music_program: musicProgram,
        ding_path: assets?.sound_effects?.ding || assets?.sound_effects?.timer_end || null,
      },
      outputs: {
        previews_directory: `${assets?.directories?.previews || ''}/Long Form/Ultimate Quiz`,
      },
    },
    publication: buildPublicationMetadata(random),
    publication_policy: {
      manual_review_required: true,
      night_shift_enabled: false,
      related_video_enabled: false,
      auto_comment_enabled: false,
    },
    selection_state: {
      updated_at: new Date().toISOString(),
      recent_subject_keys: selectedSubjects.map(normalizeSubjectKey),
      last_background_paths: backgroundProgram.map((entry) => String(entry.path || entry)),
      last_music_paths: musicProgram,
    },
  };
}
