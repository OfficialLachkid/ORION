import { access } from 'node:fs/promises';
import {
  scanPokeQuizzAssetInventory,
  selectSeededFile,
} from '../../../../poke-quizz-asset-inventory.mjs';
import { normalizePokeQuizzSelectionState } from '../../../../poke-quizz-selection-state.mjs';
import {
  normalizeBubbleSurvivalCategory,
  resolveBubbleSurvivalCategoryPool,
} from './category-resolver.mjs';
import {
  createSeededRandom,
  simulateBubbleSurvival,
} from './simulation.mjs';

const DEFAULT_POKEMON_COUNT = 9;
const DEFAULT_MAXIMUM_SIMULATION_ATTEMPTS = 8;

async function pathIsReadable(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compactSubject(row, index) {
  return {
    id: String(row.id || `pokemon-${index}`),
    national_dex_number: Number(row.national_dex_number || 0) || null,
    name: String(row.name || row.slug || `Pokemon ${index + 1}`).trim(),
    slug: String(row.slug || row.name || `pokemon-${index + 1}`).trim(),
    generation: Number(row.generation || 0) || null,
    types: Array.isArray(row.types) ? [...row.types] : [],
    sprite_path: String(row.sprite_path || '').trim(),
    form_id: row?.metadata?.pokemon_api?.form_id || null,
    pokemon_id: row?.metadata?.pokemon_api?.pokemon_id || null,
  };
}

function buildSimulationConfig(template) {
  const frameWidth = Number(template?.render?.frame_width || 540);
  const frameHeight = Number(template?.render?.frame_height || 960);
  return {
    center_x: Number(template?.arena?.center_x ?? (frameWidth / 2)),
    center_y: Number(template?.arena?.center_y ?? (frameHeight / 2)),
    arena_radius: Number(template?.arena?.radius ?? 230),
    bubble_radius: Number(template?.bubbles?.radius ?? 25.2),
    start_inset: Number(template?.bubbles?.start_inset ?? 5),
    initial_tail_count: Number(template?.bubbles?.initial_tail_count ?? 3),
    initial_tail_anchor_spread_degrees: Number(
      template?.bubbles?.initial_tail_anchor_spread_degrees ?? 7,
    ),
    defeat_shrink_seconds: Number(template?.bubbles?.defeat_shrink_seconds ?? 0.75),
    initial_speed: Number(template?.bubbles?.initial_speed ?? 92.5),
    initial_angle_variation_degrees: Number(template?.bubbles?.initial_angle_variation_degrees ?? 0),
    collision_restitution: Number(template?.bubbles?.collision_restitution ?? 0.98),
    fixed_step_seconds: Number(template?.simulation?.fixed_step_seconds ?? (1 / 120)),
    sample_fps: Number(template?.render?.frame_fps ?? 15),
    maximum_seconds: Number(template?.simulation?.maximum_seconds ?? 40),
    stagnation_seconds: Number(template?.simulation?.stagnation_seconds ?? 10),
    speed_up_interval_seconds: Number(template?.simulation?.speed_up_interval_seconds ?? 7),
    speed_up_multiplier: Number(template?.simulation?.speed_up_multiplier ?? 1.18),
  };
}

function buildSelectionState(category, selectedSubjects) {
  return normalizePokeQuizzSelectionState({
    recent_subject_ids: selectedSubjects.map((subject) => subject.id),
    recent_template_values: [`bubble-survival:${category}`],
  });
}

export async function planPokemonBubbleSurvival({
  template,
  pokedexRows,
  seed,
  assetInventory = null,
} = {}) {
  const normalizedSeed = String(seed || new Date().toISOString()).trim();
  const category = normalizeBubbleSurvivalCategory(
    template?.selection_rules?.category || 'legendary',
  );
  const pokemonCount = positiveInteger(
    template?.selection_rules?.pokemon_count,
    DEFAULT_POKEMON_COUNT,
  );
  const maximumAttempts = positiveInteger(
    template?.simulation?.maximum_attempts,
    DEFAULT_MAXIMUM_SIMULATION_ATTEMPTS,
  );
  const categoryPool = resolveBubbleSurvivalCategoryPool(pokedexRows, category);
  const readablePool = [];
  for (const row of categoryPool) {
    if (await pathIsReadable(row.sprite_path)) readablePool.push(row);
  }
  if (readablePool.length < pokemonCount) {
    throw new Error(
      `Bubble Survival category ${category} has ${readablePool.length} readable unique sprites; ${pokemonCount} are required.`,
    );
  }

  const random = createSeededRandom(`${normalizedSeed}|selection|${category}`);
  const selectedSubjects = shuffle(readablePool, random)
    .slice(0, pokemonCount)
    .map(compactSubject);
  const simulationConfig = buildSimulationConfig(template);
  let simulation = null;
  let simulationSeed = '';
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    simulationSeed = `${normalizedSeed}|simulation|${attempt}`;
    simulation = simulateBubbleSurvival({
      subjects: selectedSubjects,
      seed: simulationSeed,
      config: simulationConfig,
    });
    if (simulation.outcome === 'winner') break;
  }
  if (simulation?.outcome !== 'winner') {
    throw new Error(
      `Bubble Survival could not produce one winner after ${maximumAttempts} deterministic attempts (${simulation?.outcome || 'unknown'}).`,
    );
  }

  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const musicPath = selectSeededFile(inventory.music, random);
  if (!musicPath) {
    throw new Error('Bubble Survival requires at least one readable Poke Quizz music asset on T7.');
  }
  const winnerDingPath = String(inventory?.sound_effects?.ding || '').trim();
  if (!winnerDingPath || !(await pathIsReadable(winnerDingPath))) {
    throw new Error('Bubble Survival requires the readable T7 ding sound effect for its winner reveal.');
  }
  const defeatSoundPath = String(inventory?.sound_effects?.reflection || '').trim();
  if (!defeatSoundPath || !(await pathIsReadable(defeatSoundPath))) {
    throw new Error('Bubble Survival requires the readable T7 reflection sound effect for defeats.');
  }
  const winner = selectedSubjects.find((subject) => subject.id === simulation.winner_id);
  if (!winner) {
    throw new Error(`Bubble Survival winner ${simulation.winner_id} is missing from the selected subjects.`);
  }

  const introSeconds = Number(template?.intro?.duration_seconds ?? 1.5);
  const countdownPlaybackRate = Number(template?.intro?.voice_playback_rate ?? (4 / 3));
  const winnerDelaySeconds = Number(template?.winner?.announcement_delay_seconds ?? 0.75);
  const winnerSeconds = Number(template?.winner?.duration_seconds ?? 1.8);

  return {
    template_id: String(template?.template_id || 'pokemon.bubble-survival.v1'),
    template_key: 'bubble-survival',
    schema_version: 'pokemon-bubble-survival-plan-v1',
    seed: normalizedSeed,
    selection: {
      category,
      requested_count: pokemonCount,
      eligible_count: readablePool.length,
      selected_subjects: selectedSubjects,
      type_pair: [],
    },
    simulation: {
      ...simulation,
      seed: simulationSeed,
    },
    winner,
    narration: {
      lines: [
        { role: 'countdown', text: String(template?.intro?.voiceover || "3, 2, 1, let's go!") },
      ],
    },
    assets: {
      music_path: musicPath,
      winner_ding_path: winnerDingPath,
      defeat_sound_path: defeatSoundPath,
    },
    audio: {
      music_volume: Number(template?.audio?.music_volume ?? 0.12),
      winner_ding_volume: Number(template?.winner?.sound_volume ?? 0.9),
      defeat_sound_volume: Number(template?.audio?.defeat_sound_volume ?? 0.55),
    },
    video: {
      intro_seconds: introSeconds,
      countdown_playback_rate: countdownPlaybackRate,
      winner_delay_seconds: winnerDelaySeconds,
      winner_seconds: winnerSeconds,
      output_fps: Number(template?.video?.fps ?? 30),
      output_width: Number(template?.video?.resolution?.[0] ?? 1080),
      output_height: Number(template?.video?.resolution?.[1] ?? 1920),
      frame_width: Number(template?.render?.frame_width ?? 540),
      frame_height: Number(template?.render?.frame_height ?? 960),
      frame_fps: Number(template?.render?.frame_fps ?? 15),
    },
    timing: {
      total_duration_seconds: introSeconds
        + simulation.duration_seconds
        + winnerDelaySeconds
        + winnerSeconds,
    },
    selection_state: buildSelectionState(category, selectedSubjects),
  };
}
