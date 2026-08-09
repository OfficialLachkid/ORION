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
    .replaceAll('♀', '-f')
    .replaceAll('♂', '-m')
    .replace(/[’']/gu, '')
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
