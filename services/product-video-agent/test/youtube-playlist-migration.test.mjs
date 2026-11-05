import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20261105_create_youtube_playlist_automation.sql',
);

test('playlist automation migration keeps compact private registry and assignment state', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /create table if not exists public\.youtube_playlist_registry/iu);
  assert.match(sql, /create table if not exists public\.youtube_playlist_assignments/iu);
  assert.match(sql, /unique \(account_key, playlist_key\)/iu);
  assert.match(sql, /unique \(publication_id, playlist_key\)/iu);
  assert.match(sql, /where status in \('pending', 'processing', 'retry'\)/iu);
  assert.match(sql, /set_youtube_playlist_summary/iu);
  assert.match(sql, /enable row level security/iu);
  assert.match(sql, /revoke all .* from anon, authenticated, service_role/iu);
});
