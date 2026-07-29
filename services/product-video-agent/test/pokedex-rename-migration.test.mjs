import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const migrationPath = resolve(
  projectRoot,
  'supabase/migrations/20260727_rename_pokemon_species_to_pokedex.sql',
);

test('rename migration promotes pokemon species table to pokedex', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /alter table public\.pokemon_species rename to pokedex/iu);
  assert.match(sql, /rename to pokedex_generation_dex_idx/iu);
  assert.match(sql, /rename to pokedex_asset_status_idx/iu);
  assert.match(sql, /rename to pokedex_types_gin_idx/iu);
  assert.match(sql, /create or replace function public\.set_pokedex_updated_at/iu);
  assert.match(sql, /create trigger set_pokedex_updated_at/iu);
  assert.match(sql, /alter table public\.pokedex enable row level security/iu);
  assert.match(sql, /revoke all on public\.pokedex from anon, authenticated/iu);
  assert.match(sql, /grant all on public\.pokedex to postgres, service_role/iu);
});
