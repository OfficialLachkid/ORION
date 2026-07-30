import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const migrationPath = resolve(
  projectRoot,
  'supabase/migrations/20260727_create_pokemon_species_table.sql',
);

test('pokemon species catalog stores metadata and local asset references without media blobs', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /create table if not exists public\.pokemon_species/iu);
  assert.match(sql, /national_dex_number integer not null unique/iu);
  assert.match(sql, /generation integer not null check \(generation between 1 and 20\)/iu);
  assert.match(sql, /types jsonb not null default '\[\]'::jsonb/iu);
  assert.match(sql, /sprite_path text/iu);
  assert.match(sql, /silhouette_path text/iu);
  assert.match(sql, /shiny_sprite_path text/iu);
  assert.match(sql, /cry_path text/iu);
  assert.match(sql, /asset_status text not null default 'planned'/iu);
  assert.match(sql, /using gin \(types jsonb_path_ops\)/iu);
  assert.match(sql, /alter table public\.pokemon_species enable row level security/iu);
  assert.match(sql, /revoke all on public\.pokemon_species from anon, authenticated/iu);
  assert.match(sql, /grant all on public\.pokemon_species to postgres, service_role/iu);
  assert.doesNotMatch(sql, /\bbytea\b/iu);
});
