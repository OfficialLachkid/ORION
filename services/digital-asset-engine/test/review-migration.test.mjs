import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

test('digital asset review migration is append-only, constrained, and service-role protected', async () => {
  const sql = await readFile(resolve(
    projectRoot,
    'supabase/migrations/20261014_create_digital_asset_review_decisions.sql',
  ), 'utf8');

  assert.match(sql, /create table if not exists public\.digital_asset_review_decisions/iu);
  assert.match(sql, /decision in \('approve', 'request_changes', 'reject'\)/u);
  assert.match(sql, /discord_interaction_id text not null unique/u);
  assert.match(sql, /enable row level security/u);
  assert.match(sql, /revoke all .* from anon, authenticated, service_role/u);
  assert.match(sql, /grant select, insert .* to service_role/u);
});
