function readPokemonDbName(input) {
  if (typeof input === 'string') {
    return input;
  }
  if (input && typeof input === 'object') {
    return input.name || input.slug || '';
  }
  return '';
}

export function buildPokemonDbShinySpriteSlug(input) {
  return readPokemonDbName(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replaceAll('\u2640', '-f')
    .replaceAll('\u2642', '-m')
    .replace(/[\u2019']/gu, '')
    .replace(/[.:]/gu, '')
    .replace(/[\\/]/gu, '-')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function buildPokemonDbShinySpriteUrl(input) {
  const slug = buildPokemonDbShinySpriteSlug(input);
  return slug
    ? `https://img.pokemondb.net/sprites/home/shiny/2x/${slug}.jpg`
    : null;
}

export function resolvePreferredSpriteSourceUrl(pokeApiPayload, input) {
  return pokeApiPayload?.sprites?.other?.home?.front_default
    || pokeApiPayload?.sprites?.other?.['official-artwork']?.front_default
    || pokeApiPayload?.sprites?.front_default
    || null;
}

export function resolvePreferredShinySpriteSourceUrl(pokeApiPayload, input) {
  return pokeApiPayload?.sprites?.other?.home?.front_shiny
    || pokeApiPayload?.sprites?.other?.['official-artwork']?.front_shiny
    || buildPokemonDbShinySpriteUrl(input)
    || pokeApiPayload?.sprites?.front_shiny
    || null;
}
