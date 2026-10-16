import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('research migration keeps evidence and decisions service-role-only', async () => {
  const sql = await readFile(resolve(
    process.cwd(),
    'supabase/migrations/20261016_create_digital_asset_research_tables.sql',
  ), 'utf8');
  for (const table of [
    'digital_asset_research_runs',
    'digital_asset_research_observations',
    'digital_asset_research_opportunities',
    'digital_asset_research_reviews',
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'u'));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated, service_role`, 'u'));
  }
  assert.match(sql, /discord_interaction_id text not null unique/u);
  assert.match(sql, /check \(evidence_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
});
