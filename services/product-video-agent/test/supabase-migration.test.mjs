import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const migrationPath = resolve(
  projectRoot,
  'supabase/migrations/20260726_compact_video_generation_tables.sql',
);

const EXPECTED_TABLES = [
  'video_channels',
  'videos',
  'video_assets',
  'video_publications',
  'video_analytics',
];

test('video-generation compaction leaves five private durable tables', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  for (const table of EXPECTED_TABLES) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, 'u'));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'u'));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`, 'u'));
    assert.match(sql, new RegExp(`grant all on public\\.${table} to postgres, service_role`, 'u'));
  }

  assert.match(sql, /if total_rows > 0 then/iu);
  assert.match(sql, /Video schema compaction stopped/iu);
  assert.match(sql, /drop view if exists public\.video_generation_overview/iu);
  assert.match(sql, /drop table if exists public\.video_script_jobs/iu);
  assert.match(sql, /drop table if exists public\.video_generations/iu);
  assert.match(sql, /subjects jsonb not null/iu);
  assert.match(sql, /scripts jsonb not null/iu);
  assert.match(sql, /workflow jsonb not null/iu);
  assert.match(sql, /archive jsonb not null/iu);
  assert.match(sql, /rights_status text not null/iu);
  assert.match(sql, /scheduled_for timestamptz/iu);
  assert.doesNotMatch(sql, /create table public\.video_(?:script|voice|caption|render|approval|subject)/iu);
});
