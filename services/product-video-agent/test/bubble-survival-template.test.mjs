import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUBBLE_SURVIVAL_CATEGORIES,
  isEligibleForBubbleSurvivalCategory,
  resolveBubbleSurvivalCategoryPool,
} from '../src/domains/pokemon/templates/bubble-survival/category-resolver.mjs';
import {
  movingCircleIntersectsSegment,
  simulateBubbleSurvival,
} from '../src/domains/pokemon/templates/bubble-survival/simulation.mjs';
import { planPokemonBubbleSurvival } from '../src/domains/pokemon/templates/bubble-survival/planner.mjs';
import {
  alphaBlendRgba,
  buildBubbleSurvivalFfmpegArgs,
  buildBubbleSurvivalTitleMarkup,
  buildPokeQuizzRenderPlan,
  resolveCountdownVisualState,
  resolveDefeatedBubbleScale,
  wrapTextInsideFrame,
} from '../src/domains/pokemon/templates/bubble-survival/renderer.mjs';
import {
  resolvePokeQuizzPlanner,
  resolvePokeQuizzRenderer,
  resolvePokeQuizzTemplateKey,
} from '../src/poke-quizz-template-registry.mjs';
import {
  PRODUCT_VIDEO_TEMPLATE_DEFINITIONS,
  resolveProductVideoTemplateId,
} from '../src/product-video-template-routing.mjs';
import { buildPokeQuizzPreviewDirectory } from '../src/poke-quizz-asset-layout.mjs';

function row(overrides = {}) {
  const { metadata: metadataOverrides = {}, ...directOverrides } = overrides;
  const pokemonApiOverrides = metadataOverrides.pokemon_api || {};
  return {
    id: overrides.id || overrides.slug || 'pokemon',
    national_dex_number: overrides.national_dex_number || 1,
    is_default_form: overrides.is_default_form ?? true,
    slug: overrides.slug || 'pokemon',
    name: overrides.name || overrides.slug || 'Pokemon',
    sprite_path: overrides.sprite_path || '/tmp/pokemon.png',
    metadata: {
      is_legendary: false,
      is_mythical: false,
      evolution_depth: 0,
      is_final_evolution: false,
      evolves_from_species_id: null,
      ...metadataOverrides,
      pokemon_api: {
        species_name: overrides.species_name || overrides.slug || 'pokemon',
        pokemon_name: overrides.slug || 'pokemon',
        pokemon_id: overrides.pokemon_id || overrides.national_dex_number || 1,
        is_default_form: overrides.is_default_form ?? true,
        is_mega: false,
        ...pokemonApiOverrides,
      },
    },
    ...directOverrides,
  };
}

test('category resolver implements every explicit Pokemon pool', () => {
  const examples = {
    mixed: row({ slug: 'eevee' }),
    'first-stage': row({ slug: 'caterpie' }),
    'middle-stage': row({
      slug: 'ivysaur',
      metadata: { evolution_depth: 1, is_final_evolution: false },
    }),
    'legendary-mythical': row({ slug: 'mew', metadata: { is_mythical: true } }),
    'dynamax-gigantamax': row({
      slug: 'charizard-gmax',
      is_default_form: false,
      metadata: { pokemon_api: { form_name: 'gigantamax', is_default_form: false } },
    }),
    'final-starter': row({
      slug: 'venusaur',
      metadata: { evolution_depth: 2, is_final_evolution: true, evolves_from_species_id: 2 },
    }),
    'mega-legendary': row({
      slug: 'mewtwo-mega-x',
      is_default_form: false,
      metadata: { pokemon_api: { is_mega: true, is_default_form: false } },
    }),
    baby: row({ slug: 'pichu' }),
    starters: row({ slug: 'bulbasaur' }),
    'final-stage': row({
      slug: 'gengar',
      metadata: { evolution_depth: 2, is_final_evolution: true, evolves_from_species_id: 2 },
    }),
    mega: row({
      slug: 'charizard-mega-x',
      is_default_form: false,
      metadata: { pokemon_api: { species_name: 'charizard', pokemon_name: 'charizard-mega-x', pokemon_id: 10034, is_default_form: false, is_mega: true } },
    }),
  };

  assert.deepEqual(Object.keys(examples), [...BUBBLE_SURVIVAL_CATEGORIES]);
  for (const [category, candidate] of Object.entries(examples)) {
    assert.equal(isEligibleForBubbleSurvivalCategory(candidate, category), true, category);
  }
  assert.equal(isEligibleForBubbleSurvivalCategory(examples['middle-stage'], 'first-stage'), false);
  assert.equal(isEligibleForBubbleSurvivalCategory(examples['middle-stage'], 'first-evolutions'), true);
  assert.equal(isEligibleForBubbleSurvivalCategory(examples['legendary-mythical'], 'mythical'), true);
});

test('category pool removes duplicate forms and rows without localized sprites', () => {
  const legendary = row({ id: 'a', slug: 'mewtwo', pokemon_id: 150, metadata: { is_legendary: true } });
  const duplicate = row({ id: 'b', slug: 'mewtwo', pokemon_id: 150, metadata: { is_legendary: true } });
  const missingSprite = row({ id: 'c', slug: 'lugia', pokemon_id: 249, sprite_path: '', metadata: { is_legendary: true } });
  assert.deepEqual(
    resolveBubbleSurvivalCategoryPool([legendary, duplicate, missingSprite], 'legendary-mythical').map((item) => item.id),
    ['a'],
  );
});

test('template rotates through the complete Bubble Survival pool catalog', async () => {
  const template = JSON.parse(await readFile(join(
    process.cwd(),
    'services/product-video-agent/config/templates/pokemon/bubble-survival.v1.json',
  ), 'utf8'));
  assert.equal(template.selection_rules.category, undefined);
  assert.equal(template.selection_rules.pool_selection_mode, 'seeded_weighted');
  assert.deepEqual(
    template.selection_rules.pool_variants.map((pool) => pool.category),
    [...BUBBLE_SURVIVAL_CATEGORIES],
  );
});

test('swept circle-to-tail collision detects crossings between fixed steps', () => {
  assert.equal(movingCircleIntersectsSegment(
    { x: -5, y: 0 },
    { x: 5, y: 0 },
    0.5,
    { x: 0, y: -4 },
    { x: 0, y: 4 },
  ), true);
  assert.equal(movingCircleIntersectsSegment(
    { x: -5, y: 5 },
    { x: 5, y: 5 },
    0.5,
    { x: 0, y: -4 },
    { x: 0, y: 4 },
  ), false);
});

test('fixed-step simulation is deterministic, starts without overlap, and shrinks defeated bubbles', () => {
  const subjects = Array.from({ length: 9 }, (_, index) => ({ id: `subject-${index}` }));
  const first = simulateBubbleSurvival({ subjects, seed: 'deterministic-seed' });
  const second = simulateBubbleSurvival({ subjects, seed: 'deterministic-seed' });
  assert.deepEqual(first, second);
  assert.equal(first.outcome, 'winner');
  assert.ok(first.winner_id);
  assert.equal(first.frames[0].bubbles.length, 9);
  assert.equal(first.frames[0].bubbles.every((bubble) => bubble.tail_count === 3), true);
  assert.equal(first.frames[0].tails.length, 27);
  assert.equal(
    new Set(first.frames[0].tails.map((tail) => `${tail.anchor_x},${tail.anchor_y}`)).size,
    27,
  );
  for (let leftIndex = 0; leftIndex < first.frames[0].bubbles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < first.frames[0].bubbles.length; rightIndex += 1) {
      const left = first.frames[0].bubbles[leftIndex];
      const right = first.frames[0].bubbles[rightIndex];
      assert.ok(
        Math.hypot(left.x - right.x, left.y - right.y) >= first.config.bubble_radius * 2,
      );
    }
  }
  assert.equal(first.frames.at(-1).bubbles.filter((bubble) => !bubble.is_defeated).length, 1);
  assert.equal(first.frames.at(-1).bubbles.some((bubble) => bubble.is_defeated), true);
  assert.equal(first.frames.some((frame) => frame.bubbles.length < subjects.length), true);
  assert.equal(first.config.sample_fps, 30);
  const defeatedBubbleKeepsMoving = first.frames.some((frame, frameIndex) => {
    const nextFrame = first.frames[frameIndex + 1];
    if (!nextFrame) return false;
    return frame.bubbles.some((bubble) => {
      if (!bubble.is_defeated) return false;
      const nextBubble = nextFrame.bubbles.find((candidate) => candidate.id === bubble.id);
      return nextBubble?.is_defeated
        && Math.hypot(nextBubble.x - bubble.x, nextBubble.y - bubble.y) > 0.01;
    });
  });
  assert.equal(defeatedBubbleKeepsMoving, true);
  const tailBreakEvents = first.events.filter((event) => event.type === 'tail_destroyed');
  assert.ok(tailBreakEvents.length > 0);
  assert.equal(tailBreakEvents.every((event) => Number.isFinite(event.time)), true);
  assert.equal(tailBreakEvents.some((event) => event.attacker_is_defeated), true);
  assert.equal(first.events.filter((event) => event.type === 'eliminated').length, 8);
  const defeatedBubble = { is_defeated: true, defeated_at: 4 };
  const despawn = { popScale: 1.2, popSeconds: 0.1, shrinkSeconds: 0.577 };
  assert.equal(resolveDefeatedBubbleScale({ bubble: { is_defeated: false }, simulationTime: 5, ...despawn }), 1);
  assert.equal(resolveDefeatedBubbleScale({ bubble: defeatedBubble, simulationTime: 4, ...despawn }), 1);
  assert.ok(Math.abs(resolveDefeatedBubbleScale({
    bubble: defeatedBubble,
    simulationTime: 4.05,
    ...despawn,
  }) - 1.1) < 1e-9);
  assert.ok(Math.abs(resolveDefeatedBubbleScale({
    bubble: defeatedBubble,
    simulationTime: 4.1,
    ...despawn,
  }) - 1.2) < 1e-9);
  assert.ok(Math.abs(resolveDefeatedBubbleScale({
    bubble: defeatedBubble,
    simulationTime: 4.3885,
    ...despawn,
  }) - 0.6) < 1e-9);
  assert.equal(resolveDefeatedBubbleScale({ bubble: defeatedBubble, simulationTime: 4.677, ...despawn }), 0);
});

test('planner selects unique readable Pokemon, produces replay data, and is seed-stable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bubble-survival-'));
  try {
    const musicPath = join(root, 'music.mp3');
    const shortMusicPath = join(root, 'short-music.mp3');
    const dingPath = join(root, 'ding-sound.mp3');
    const reflectionPath = join(root, 'reflection-sound.mp3');
    await writeFile(musicPath, 'music');
    await writeFile(shortMusicPath, 'short music');
    await writeFile(dingPath, 'ding');
    await writeFile(reflectionPath, 'reflection');
    const rows = [];
    for (let index = 0; index < 14; index += 1) {
      const spritePath = join(root, `sprite-${index}.png`);
      await writeFile(spritePath, 'sprite');
      rows.push(row({
        id: `legendary-${index}`,
        slug: `legendary-${index}`,
        name: `Legendary ${index}`,
        pokemon_id: 1000 + index,
        national_dex_number: 1000 + index,
        sprite_path: spritePath,
        metadata: { is_legendary: true, is_mythical: false },
      }));
    }
    const template = {
      template_id: 'pokemon.bubble-survival.v1',
      template_key: 'bubble-survival',
      selection_rules: { category: 'legendary', pokemon_count: 9 },
      simulation: { maximum_seconds: 40, maximum_attempts: 4 },
    };
    const options = {
      template,
      pokedexRows: rows,
      seed: 'planner-seed',
      assetInventory: {
        music: [shortMusicPath, musicPath],
        sound_effects: { ding: dingPath, reflection: reflectionPath },
      },
      probeDuration: async ({ mediaPath }) => (mediaPath === musicPath ? 120 : 5),
    };
    const first = await planPokemonBubbleSurvival(options);
    const second = await planPokemonBubbleSurvival(options);
    assert.deepEqual(first, second);
    assert.equal(first.selection.selected_subjects.length, 9);
    assert.equal(first.selection.category, 'legendary-mythical');
    assert.equal(first.selection.category_label, 'Legendary + Mythical Pokemon');
    assert.equal(new Set(first.selection.selected_subjects.map((subject) => subject.id)).size, 9);
    assert.equal(first.simulation.outcome, 'winner');
    assert.equal(first.simulation.config.bubble_radius, 25.2);
    assert.equal(first.simulation.config.initial_tail_count, 3);
    assert.equal(first.simulation.config.defeat_pop_scale, 1.2);
    assert.equal(first.simulation.config.defeat_pop_seconds, 0.1);
    assert.equal(first.simulation.config.defeat_shrink_seconds, 0.577);
    assert.equal(first.simulation.config.initial_speed, 92.5);
    assert.equal(first.simulation.config.center_y, 450);
    assert.equal(first.assets.music_path, musicPath);
    assert.equal(first.assets.music_duration_seconds, 120);
    assert.ok(first.assets.minimum_music_duration_seconds > 5);
    assert.equal(first.assets.winner_ding_path, dingPath);
    assert.equal(first.assets.defeat_sound_path, reflectionPath);
    assert.equal(first.video.intro_seconds, 1.16);
    assert.equal(first.video.countdown_playback_rate, 4 / 3);
    assert.equal(first.video.visual_countdown_playback_rate, 1.3);
    assert.equal(first.video.winner_delay_seconds, 0.75);
    assert.equal(first.video.frame_fps, 30);
    assert.equal(first.audio.defeat_sound_volume, 0.165);
    assert.equal(first.audio.winner_ding_volume, 0.36);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Bubble Survival is exposed through template routing and the runtime registry', () => {
  assert.equal(resolvePokeQuizzTemplateKey({ template_key: 'bubble-survival' }), 'bubble-survival');
  assert.equal(resolveProductVideoTemplateId('bubble-survival'), 'pokemon.bubble-survival.v1');
  assert.equal(typeof resolvePokeQuizzPlanner({ template_key: 'bubble-survival' }), 'function');
  assert.equal(typeof resolvePokeQuizzRenderer({ template_key: 'bubble-survival' }), 'function');
  assert.match(
    buildPokeQuizzPreviewDirectory({ template_key: 'bubble-survival' }),
    /Previews\/Bubble Survival$/u,
  );
  assert.equal(
    PRODUCT_VIDEO_TEMPLATE_DEFINITIONS.some((definition) => definition.templateKey === 'bubble-survival'),
    true,
  );
});

test('Bubble Survival title is split into frame-safe lines', () => {
  const title = buildBubbleSurvivalTitleMarkup({ centerX: 270, frameWidth: 540 });
  const titleMarkup = title.markup.join('');
  assert.match(titleMarkup, />POKEMON BUBBLE<\/text>/u);
  assert.match(titleMarkup, />SURVIVAL<\/text>/u);
  assert.doesNotMatch(titleMarkup, />POKEMON BUBBLE SURVIVAL<\/text>/u);
  assert.equal(title.maximum_width, 440);
  assert.equal(title.estimated_widths.every((width) => width <= title.maximum_width), true);
  const longWord = wrapTextInsideFrame({
    text: 'EXTRAORDINARILYLONGPOKEMONNAME',
    frameWidth: 540,
    fontSize: 38,
    sideMargin: 50,
  });
  assert.equal(longWord.estimated_widths[0], longWord.maximum_width);
});

test('visual countdown advances 30 percent faster and ends as physics begins', () => {
  assert.deepEqual(resolveCountdownVisualState(0, 1.16, 1.3), {
    text: '3',
    phase_index: 0,
    local_phase: 0,
  });
  assert.equal(resolveCountdownVisualState(0.23, 1.16, 1.3).text, '2');
  assert.equal(resolveCountdownVisualState(0.46, 1.16, 1.3).text, '1');
  assert.equal(resolveCountdownVisualState(0.7, 1.16, 1.3).text, "LET'S GO!");
  assert.equal(resolveCountdownVisualState(1.15, 1.16, 1.3).text, "LET'S GO!");
});

test('sprite compositing alpha-blends RGBA pixels without altering untouched pixels', () => {
  const destination = Buffer.from([
    10, 20, 30, 255,
    40, 50, 60, 255,
  ]);
  alphaBlendRgba({
    destination,
    destinationWidth: 2,
    destinationHeight: 1,
    source: Buffer.from([210, 120, 30, 128]),
    sourceWidth: 1,
    sourceHeight: 1,
    left: 1,
    top: 0,
  });
  assert.deepEqual([...destination.subarray(0, 4)], [10, 20, 30, 255]);
  assert.deepEqual([...destination.subarray(4)], [125, 85, 45, 255]);
});

test('sprite compositing preserves smooth fractional-pixel motion', () => {
  const compositeAt = (left) => {
    const destination = Buffer.alloc(3 * 4);
    alphaBlendRgba({
      destination,
      destinationWidth: 3,
      destinationHeight: 1,
      source: Buffer.from([255, 255, 255, 255]),
      sourceWidth: 1,
      sourceHeight: 1,
      left,
      top: 0,
    });
    const alphas = [destination[3], destination[7], destination[11]];
    const totalAlpha = alphas.reduce((sum, alpha) => sum + alpha, 0);
    const centroid = alphas.reduce((sum, alpha, index) => sum + (alpha * index), 0) / totalAlpha;
    return { alphas, centroid };
  };
  const quarterPixel = compositeAt(0.25);
  assert.deepEqual(quarterPixel.alphas, [191, 64, 0]);
  assert.ok(Math.abs(quarterPixel.centroid - 0.25) < 0.002);
  assert.ok(Math.abs(compositeAt(0.51).centroid - compositeAt(0.49).centroid - 0.02) < 0.002);
});

test('winner hold, ding, and defeat-only shrink cues are scheduled at their boundaries', () => {
  const plan = {
    template_id: 'pokemon.bubble-survival.v1',
    simulation: {
      duration_seconds: 20,
      events: [
        { type: 'tail_destroyed', time: 4.125 },
        { type: 'eliminated', time: 7 },
        { type: 'tail_destroyed', time: 8 },
        { type: 'eliminated', time: 9 },
      ],
    },
    assets: {
      music_path: '/tmp/music.mp3',
      winner_ding_path: '/tmp/ding-sound.mp3',
      defeat_sound_path: '/tmp/reflection-sound.mp3',
    },
    audio: {
      music_volume: 0.12,
      winner_ding_volume: 0.36,
      defeat_sound_volume: 0.165,
    },
    video: {
      intro_seconds: 1.16,
      countdown_playback_rate: 4 / 3,
      winner_delay_seconds: 0.75,
      winner_seconds: 1.8,
      frame_fps: 30,
      output_fps: 30,
      output_width: 1080,
      output_height: 1920,
    },
  };
  const renderPlan = buildPokeQuizzRenderPlan({ plan });
  assert.equal(renderPlan.duration_seconds, 23.71);
  const args = buildBubbleSurvivalFfmpegArgs({
    plan,
    framesRoot: '/tmp/frames',
    narrationPath: '/tmp/countdown.wav',
    outputPath: '/tmp/output.mp4',
    durationSeconds: renderPlan.duration_seconds,
  });
  assert.equal(args.includes('/tmp/ding-sound.mp3'), true);
  assert.equal(args.filter((arg) => arg === '/tmp/reflection-sound.mp3').length, 2);
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /atempo=1\.3333333333333333/u);
  assert.match(filter, /adelay=21910\|21910/u);
  assert.match(filter, /afade=t=out:st=21\.910:d=1\.800/u);
  assert.doesNotMatch(filter, /adelay=5625\|5625/u);
  assert.match(filter, /adelay=8160\|8160,volume=0\.165\[defeat_0\]/u);
  assert.match(filter, /adelay=10160\|10160,volume=0\.165\[defeat_1\]/u);
  assert.doesNotMatch(args.join(' '), /-stream_loop/u);
  assert.match(filter, /\[base\]\[defeat_0\]\[defeat_1\]amix=inputs=3/u);
  assert.match(filter, /normalize=0,alimiter=limit=0\.95\[audio\]/u);
  assert.match(filter, /amix=inputs=3/u);
});
