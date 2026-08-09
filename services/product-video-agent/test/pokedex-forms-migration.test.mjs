import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const migrationPath = resolve(
  projectRoot,
  'supabase/migrations/20260809_allow_pokedex_forms.sql',
);

test('pokedex forms migration removes national dex uniqueness and adds a default-form flag', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /drop constraint pokemon_species_national_dex_number_key/iu);
  assert.match(sql, /drop constraint pokedex_national_dex_number_key/iu);
  assert.match(sql, /add column if not exists is_default_form boolean not null default true/iu);
  assert.match(sql, /create index if not exists pokedex_national_dex_number_form_idx/iu);
});
