const SEREBII_POKEDEX_GENERATIONS = Object.freeze({
  1: {
    generation: 1,
    region: 'kanto',
    sourceUrl: 'https://www.serebii.net/pokemon/gen1pokemon.shtml',
    typingBasis: 'current_canonical_types_from_serebii_gen1_page',
  },
  2: {
    generation: 2,
    region: 'johto',
    sourceUrl: 'https://www.serebii.net/pokemon/gen2pokemon.shtml',
    typingBasis: 'current_canonical_types_from_serebii_gen2_page',
  },
  3: {
    generation: 3,
    region: 'hoenn',
    sourceUrl: 'https://www.serebii.net/pokemon/gen3pokemon.shtml',
    typingBasis: 'current_canonical_types_from_serebii_gen3_page',
  },
});

const ROW_PATTERN = /<tr>\s*<td align="center" class="fooinfo">\s*#(\d{4})\s*<\/td>\s*<td align="center" class="fooinfo">.*?<img src="([^"]+)"[^>]*>.*?<\/td>\s*<td align="center" class="fooinfo">\s*<a href="\/pokemon\/([^"]+)">([^<]+)<\/a>\s*<\/td>\s*<td align="center" class="fooinfo">(.*?)<\/td>\s*<td align="center" class="fooinfo">(.*?)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<\/tr>/gsu;

function normalizeText(value) {
  return decodeHtmlEntities(String(value || '').replace(/\s+/gu, ' ').trim());
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/gu, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 10)))
    .replace(/&#x([0-9a-f]+);/giu, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/&amp;/gu, '&')
    .replace(/&apos;|&#39;/gu, '\'')
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&nbsp;/gu, ' ');
}

function buildAbsoluteUrl(sourceUrl, assetPath) {
  return new URL(assetPath, sourceUrl).toString();
}

function getGenerationConfig(generation) {
  const config = SEREBII_POKEDEX_GENERATIONS[generation];
  if (!config) {
    throw new Error(`Unsupported Serebii generation: ${generation}.`);
  }
  return config;
}

function parseTypeMetadata(typeHtml, sourceUrl) {
  const typeMatches = [...typeHtml.matchAll(/\/pokemon\/type\/([^"]+)/gu)];
  const iconMatches = [...typeHtml.matchAll(/<img src="([^"]+)"/gu)];
  const types = typeMatches
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  const typeIconSourceUrls = iconMatches
    .map((match) => buildAbsoluteUrl(sourceUrl, match[1]))
    .filter(Boolean)
    .slice(0, types.length);

  return { types, typeIconSourceUrls };
}

export function parseSerebiiPokedex(html, options = {}) {
  const generation = Number.parseInt(String(options.generation || 1), 10);
  const generationConfig = getGenerationConfig(generation);
  const sourceUrl = options.sourceUrl || generationConfig.sourceUrl;
  const rows = [];

  for (const match of html.matchAll(ROW_PATTERN)) {
    const [
      ,
      dexText,
      spriteSourcePath,
      slug,
      name,
      typeHtml,
      abilitiesHtml,
      hp,
      attack,
      defense,
      specialAttack,
      specialDefense,
      speed,
    ] = match;

    const nationalDexNumber = Number.parseInt(dexText, 10);
    const { types, typeIconSourceUrls } = parseTypeMetadata(typeHtml, sourceUrl);
    if (!nationalDexNumber || !slug || !name || types.length < 1) {
      continue;
    }

    const abilities = [...abilitiesHtml.matchAll(/>([^<]+)<\/a>/gu)]
      .map((item) => normalizeText(item[1]))
      .filter(Boolean);

    rows.push({
      id: `pokedex-${dexText}`,
      national_dex_number: nationalDexNumber,
      slug: slug.trim(),
      name: normalizeText(name),
      generation: generationConfig.generation,
      region: generationConfig.region,
      types,
      sprite_path: null,
      silhouette_path: null,
      shiny_sprite_path: null,
      cry_path: null,
      sprite_source_url: buildAbsoluteUrl(sourceUrl, spriteSourcePath),
      silhouette_source_url: null,
      shiny_sprite_source_url: null,
      cry_source_url: null,
      asset_status: 'core_facts_seeded',
      metadata: {
        source_name: 'serebii',
        source_page_url: sourceUrl,
        display_dex_number: `#${dexText}`,
        typing_basis: generationConfig.typingBasis,
        type_icon_source_urls: typeIconSourceUrls,
        abilities,
        base_stats: {
          hp: Number.parseInt(hp, 10),
          attack: Number.parseInt(attack, 10),
          defense: Number.parseInt(defense, 10),
          special_attack: Number.parseInt(specialAttack, 10),
          special_defense: Number.parseInt(specialDefense, 10),
          speed: Number.parseInt(speed, 10),
        },
        missing_sources: [
          'silhouette_source_url',
          'shiny_sprite_source_url',
          'cry_source_url',
        ],
      },
    });
  }

  return rows;
}

export async function fetchSerebiiPokedex(options = {}) {
  const generation = Number.parseInt(String(options.generation || 1), 10);
  const generationConfig = getGenerationConfig(generation);
  const sourceUrl = options.sourceUrl || generationConfig.sourceUrl;
  const fetchImpl = options.fetch || globalThis.fetch;
  const response = await fetchImpl(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch Serebii Gen ${generation} page (${response.status}).`);
  }
  return parseSerebiiPokedex(await response.text(), { sourceUrl, generation });
}

export function parseSerebiiGen1Pokedex(html, options = {}) {
  return parseSerebiiPokedex(html, { ...options, generation: 1 });
}

export function parseSerebiiGen2Pokedex(html, options = {}) {
  return parseSerebiiPokedex(html, { ...options, generation: 2 });
}

export function parseSerebiiGen3Pokedex(html, options = {}) {
  return parseSerebiiPokedex(html, { ...options, generation: 3 });
}

export async function fetchSerebiiGen1Pokedex(options = {}) {
  return fetchSerebiiPokedex({ ...options, generation: 1 });
}

export async function fetchSerebiiGen2Pokedex(options = {}) {
  return fetchSerebiiPokedex({ ...options, generation: 2 });
}

export async function fetchSerebiiGen3Pokedex(options = {}) {
  return fetchSerebiiPokedex({ ...options, generation: 3 });
}

export const DEFAULT_SEREBII_GEN1_SOURCE_URL = SEREBII_POKEDEX_GENERATIONS[1].sourceUrl;
export const DEFAULT_SEREBII_GEN2_SOURCE_URL = SEREBII_POKEDEX_GENERATIONS[2].sourceUrl;
export const DEFAULT_SEREBII_GEN3_SOURCE_URL = SEREBII_POKEDEX_GENERATIONS[3].sourceUrl;

export {
  SEREBII_POKEDEX_GENERATIONS,
  getGenerationConfig as getSerebiiPokedexGenerationConfig,
};
