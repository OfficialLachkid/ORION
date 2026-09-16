const LANDSCAPE_CANVAS = Object.freeze({
  width: 1920,
  height: 1080,
  fps: 30,
  aspect_ratio: '16:9',
  safe_zone: Object.freeze({
    top: 60,
    right: 120,
    bottom: 70,
    left: 120,
  }),
});

export const LANDSCAPE_POKEMON_TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    key: 'dual-type-reveal',
    path: 'services/product-video-agent/config/templates/pokemon/dual-type-reveal.v1.json',
  }),
  Object.freeze({
    key: 'find-the-shiny',
    path: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
  }),
  Object.freeze({
    key: 'know-your-shiny',
    path: 'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
  }),
  Object.freeze({
    key: 'progressive-reveal',
    path: 'services/product-video-agent/config/templates/pokemon/progressive-reveal.v1.json',
  }),
  Object.freeze({
    key: 'stat-clash',
    path: 'services/product-video-agent/config/templates/pokemon/stat-clash.v1.json',
  }),
  Object.freeze({
    key: 'build-your-team',
    path: 'services/product-video-agent/config/templates/pokemon/build-your-team.v1.json',
  }),
  Object.freeze({
    key: 'memory',
    path: 'services/product-video-agent/config/templates/pokemon/memory.v1.json',
  }),
  Object.freeze({
    key: 'type-quiz',
    path: 'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json',
  }),
  Object.freeze({
    key: 'cry-match',
    path: 'services/product-video-agent/config/templates/pokemon/cry-match.v1.json',
  }),
]);

const COMMON_LAYOUT = Object.freeze({
  foreground_y_offset_px: 0,
  background: Object.freeze({
    blur_sigma: 0,
    darken_alpha: 0,
    motion: Object.freeze({ enabled: false }),
  }),
});

const FOUR_OPTION_GRID = Object.freeze({
  rows: 1,
  columns: 4,
  item_size_px: 250,
  min_item_size_px: 210,
  column_gap_px: 100,
  row_gap_px: 24,
  sprite_center_y_offset_px: 34,
  stage_bounds_px: Object.freeze({
    left: 150,
    top: 330,
    width: 1620,
    height: 430,
  }),
});

const TEMPLATE_LAYOUT_OVERRIDES = Object.freeze({
  'dual-type-reveal': Object.freeze({
    type_icons: Object.freeze({
      icon_size_px: 170,
      spacing_px: 36,
      y: 112,
      hook_y: 330,
    }),
    pokeball_grid: Object.freeze({
      max_columns: 5,
      item_size_px: 190,
      column_gap_px: 55,
      row_gap_px: 32,
      stage_bounds_px: Object.freeze({
        left: 110,
        top: 440,
        width: 1700,
        height: 520,
      }),
    }),
    text: Object.freeze({
      hook_y: 94,
      prompt_y: 58,
      reveal_y: 70,
      hook_font_size: 76,
      prompt_font_size: 62,
      reveal_font_size: 64,
    }),
  }),
  'find-the-shiny': Object.freeze({
    sprite_grid: Object.freeze({
      difficulty_levels: Object.freeze({
        easy: Object.freeze({ sprite_count: 3, rows: 1, columns: 3 }),
        medium: Object.freeze({ sprite_count: 6, rows: 2, columns: 3 }),
        hard: Object.freeze({ sprite_count: 9, rows: 2, columns: 5 }),
      }),
      available_grids: Object.freeze([
        Object.freeze({ rows: 1, columns: 3 }),
        Object.freeze({ rows: 2, columns: 3 }),
        Object.freeze({ rows: 2, columns: 5 }),
      ]),
      item_size_px: 210,
      min_item_size_px: 138,
      column_gap_px: 44,
      row_gap_px: 50,
      stage_bounds_px: Object.freeze({
        left: 180,
        top: 300,
        width: 1560,
        height: 600,
      }),
    }),
    text: Object.freeze({
      hook_y: 88,
      hook_font_size: 92,
      prompt_y: 65,
      prompt_font_size: 72,
      reveal_y: 65,
    }),
    timer: Object.freeze({ hp_bar_max_height_px: 120 }),
  }),
  'know-your-shiny': Object.freeze({
    text: Object.freeze({
      hook_y: 72,
      hook_font_size: 82,
      prompt_y: 72,
      prompt_font_size: 66,
      reveal_y: 72,
      reveal_font_size: 72,
      counter_x: 56,
      counter_y: 42,
      counter_font_size: 54,
    }),
    sprite_grid: FOUR_OPTION_GRID,
    reveal_sprite: Object.freeze({
      center_x: 960,
      center_y: 560,
      item_size_px: 330,
    }),
    timer: Object.freeze({
      center_y: 920,
      bar_horizontal_inset_px: 260,
    }),
  }),
  'progressive-reveal': Object.freeze({
    text: Object.freeze({
      hook_y: 54,
      hook_font_size: 72,
      counter_x: 52,
      counter_y: 38,
      counter_font_size: 42,
      answer_y: 925,
      answer_font_size: 68,
    }),
    reveal_box: Object.freeze({
      center_x: 960,
      center_y: 545,
      width_px: 700,
      height_px: 700,
      sprite_size_px: 610,
      shadow_offset_px: 14,
    }),
  }),
  'stat-clash': Object.freeze({
    text: Object.freeze({
      prompt_y: 62,
      prompt_font_size: 68,
      reveal_y: 72,
      reveal_font_size: 64,
      counter_x: 52,
      counter_y: 42,
      counter_font_size: 54,
    }),
    sprite_grid: FOUR_OPTION_GRID,
    timer: Object.freeze({
      center_y: 920,
      bar_horizontal_inset_px: 250,
    }),
    stat_values: Object.freeze({
      font_size: 58,
      top_row_y_offset_px: 6,
      bottom_row_y_offset_px: 190,
    }),
  }),
  'build-your-team': Object.freeze({
    text: Object.freeze({
      hook_y: 350,
      hook_font_size: 88,
      prompt_y: 62,
      prompt_font_size: 58,
      round_headline: Object.freeze({
        y: 46,
        lines: Object.freeze([
          Object.freeze({
            text: 'BUILD YOUR',
            font_size: 46,
            color: '0xF4FBFF',
            outline_color: '0x173A63',
            depth_color: '0x2B6DA6',
          }),
          Object.freeze({
            text: 'ULTIMATE TEAM!',
            font_size: 58,
            color: '0xFFD60A',
            outline_color: '0x704400',
            depth_color: '0xC97900',
          }),
        ]),
      }),
      final_prompt: Object.freeze({
        center_y_offset_px: -80,
        font_size: 58,
      }),
    }),
    sprite_grid: Object.freeze({
      ...FOUR_OPTION_GRID,
      row_y_offsets_px: Object.freeze([0]),
    }),
    timer: Object.freeze({
      center_y: 920,
      bar_horizontal_inset_px: 250,
    }),
  }),
  memory: Object.freeze({
    text: Object.freeze({
      hook_y: 70,
      hook_font_size: 76,
      question_y: 64,
      question_font_size: 62,
      option_label_font_size: 54,
      reveal_y: 70,
      reveal_font_size: 70,
    }),
    sprite_grid: Object.freeze({
      item_size_px: 190,
      min_item_size_px: 145,
      column_gap_px: 65,
      row_gap_px: 54,
      stage_bounds_px: Object.freeze({
        left: 170,
        top: 250,
        width: 1580,
        height: 560,
      }),
      difficulty_levels: Object.freeze({
        easy: Object.freeze({ sprite_count: 4, rows: 1, columns: 4 }),
        medium: Object.freeze({ sprite_count: 6, rows: 2, columns: 3 }),
        hard: Object.freeze({
          sprite_count: 9,
          rows: 2,
          columns: 5,
          stage_bounds_px: Object.freeze({
            left: 150,
            top: 230,
            width: 1620,
            height: 600,
          }),
        }),
      }),
    }),
    option_grid: Object.freeze({
      ...FOUR_OPTION_GRID,
      item_size_px: 280,
      stage_bounds_px: Object.freeze({
        left: 130,
        top: 250,
        width: 1660,
        height: 520,
      }),
    }),
    reveal_sprite: Object.freeze({
      center_x: 960,
      center_y: 560,
      item_size_px: 330,
    }),
    timer: Object.freeze({
      center_x: 960,
      center_y: 900,
      hp_bar_width_px: 1180,
      hp_bar_top_gap_px: 170,
    }),
  }),
  'type-quiz': Object.freeze({
    text: Object.freeze({
      hook_y: 70,
      hook_font_size: 82,
      prompt_y: 70,
      prompt_font_size: 82,
      counter_x: 52,
      counter_y: 42,
      counter_font_size: 54,
      name_y: 880,
      name_font_size: 80,
      type_text_y: 92,
      type_text_font_size: 58,
    }),
    sprite: Object.freeze({
      center_x: 960,
      center_y: 570,
      size_px: 380,
      scale_multiplier: 1.65,
    }),
    type_badges: Object.freeze({
      center_y: 165,
      icon_size_px: 160,
      spacing_px: 28,
      label_gap_px: 50,
    }),
    timer: Object.freeze({
      size_px: 190,
      center_x: 960,
      center_y: 245,
    }),
  }),
  'cry-match': Object.freeze({
    text: Object.freeze({
      prompt_y: 62,
      prompt_font_size: 68,
      reveal_y: 72,
      reveal_font_size: 64,
      counter_x: 52,
      counter_y: 42,
      counter_font_size: 54,
    }),
    sprite_grid: FOUR_OPTION_GRID,
    timer: Object.freeze({
      center_y: 930,
      bar_horizontal_inset_px: 250,
    }),
    cry_meter: Object.freeze({
      center_y: 225,
      bar_width_px: 1080,
      bar_horizontal_inset_px: 420,
      equalizer: Object.freeze({
        band_width_px: 1080,
        max_bar_height_px: 190,
      }),
    }),
  }),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return structuredClone(patch);
  }
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? mergeObjects(result[key], value)
      : structuredClone(value);
  }
  return result;
}

export function adaptPokemonShortTemplateToLandscape(template = {}) {
  const templateKey = String(template?.template_key || '').trim().toLowerCase();
  const overrides = TEMPLATE_LAYOUT_OVERRIDES[templateKey];
  if (!overrides) {
    throw new Error(`Pokemon template ${templateKey || '(unknown)'} has no landscape adapter.`);
  }
  if (templateKey === 'tournament') {
    throw new Error('Tournament is intentionally excluded from long-form landscape compilation.');
  }
  const adaptedLayout = mergeObjects(
    mergeObjects(template?.layout || {}, COMMON_LAYOUT),
    overrides,
  );
  return {
    ...structuredClone(template),
    template_id: `${String(template.template_id || templateKey)}.landscape`,
    canvas: structuredClone(LANDSCAPE_CANVAS),
    layout: adaptedLayout,
    long_form_adapter: {
      source_template_id: String(template.template_id || ''),
      source_template_key: templateKey,
      preserves_short_template: true,
      watermark_enabled: false,
    },
  };
}

export function listLandscapePokemonTemplateKeys() {
  return LANDSCAPE_POKEMON_TEMPLATE_SPECS.map((entry) => entry.key);
}
