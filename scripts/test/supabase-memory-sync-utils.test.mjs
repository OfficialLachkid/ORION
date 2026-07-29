import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBridgeCacheManifestEntry,
  buildBridgeRecord,
  createBridgeMergePlan,
  createBridgeSyncPlan,
  extractMarkdownSummary,
  extractMarkdownTitle,
} from '../lib/supabase-memory-sync-utils.mjs';

test('extractMarkdownTitle prefers the first markdown heading', () => {
  assert.equal(extractMarkdownTitle('# Bridge Hub\n\nSummary'), 'Bridge Hub');
});

test('extractMarkdownSummary returns the first non-heading line', () => {
  assert.equal(extractMarkdownSummary('# Title\n\nFirst summary line.\n\n- bullet'), 'First summary line.');
});

test('buildBridgeRecord creates a normalized bridge memory record', () => {
  const record = buildBridgeRecord({
    manifestEntry: {
      name: 'patterns.md',
      source: 'C:/Vault/Jacobs-2/90_Ruflo_Bridge/patterns.md',
      sha256: 'ABC123',
      lastWriteTimeUtc: '2026-07-09T10:00:00.000Z',
    },
    content: '# Patterns\n\nUseful bridge summary.',
    sourceDevice: 'mac-mini',
    syncedAtUtc: '2026-07-09T10:30:00.000Z',
  });

  assert.equal(record.record_key, 'bridge:patterns');
  assert.equal(record.memory_namespace, 'bridge');
  assert.equal(record.topic, 'patterns');
  assert.equal(record.title, 'Patterns');
  assert.equal(record.summary, 'Useful bridge summary.');
  assert.equal(record.source_device, 'mac-mini');
});

test('createBridgeSyncPlan separates inserts, updates, and unchanged bridge records', () => {
  const localRecords = [
    {
      record_key: 'bridge:patterns',
      source_sha256: 'NEW',
    },
    {
      record_key: 'bridge:security',
      source_sha256: 'SAME',
    },
    {
      record_key: 'bridge:debugging',
      source_sha256: 'FIRST',
    },
  ];

  const remoteRecords = [
    {
      id: 'record-1',
      record_key: 'bridge:patterns',
      source_sha256: 'OLD',
      version: 3,
    },
    {
      id: 'record-2',
      record_key: 'bridge:security',
      source_sha256: 'SAME',
      version: 2,
    },
  ];

  const plan = createBridgeSyncPlan(localRecords, remoteRecords);

  assert.equal(plan.insertedCount, 1);
  assert.equal(plan.updatedCount, 1);
  assert.equal(plan.unchangedCount, 1);
  assert.equal(plan.upserts.length, 2);
  assert.equal(plan.upserts.find((item) => item.record_key === 'bridge:patterns')?.version, 4);
  assert.equal(plan.upserts.find((item) => item.record_key === 'bridge:debugging')?.version, 1);
});

test('createBridgeMergePlan classifies local and remote bridge state', () => {
  const plan = createBridgeMergePlan(
    [
      {
        record_key: 'bridge:patterns',
        source_sha256: 'LOCAL-1',
        updated_at: '2026-07-09T10:00:00.000Z',
        content_markdown: '# Patterns\n',
      },
      {
        record_key: 'bridge:security',
        source_sha256: 'SAME',
        updated_at: '2026-07-09T10:00:00.000Z',
        content_markdown: '# Security\n',
      },
      {
        record_key: 'bridge:debugging',
        source_sha256: 'LOCAL-ONLY',
        updated_at: '2026-07-09T10:00:00.000Z',
        content_markdown: '# Debugging\n',
      },
      {
        record_key: 'bridge:local-ahead',
        source_sha256: 'LOCAL-AHEAD',
        updated_at: '2026-07-09T12:00:00.000Z',
        content_markdown: '# Local Ahead\n',
      },
    ],
    [
      {
        record_key: 'bridge:patterns',
        source_sha256: 'REMOTE-2',
        updated_at: '2026-07-09T11:00:00.000Z',
        content_markdown: '# Patterns remote\n',
        version: 2,
      },
      {
        record_key: 'bridge:security',
        source_sha256: 'SAME',
        updated_at: '2026-07-09T09:00:00.000Z',
        content_markdown: '# Security remote\n',
        version: 1,
      },
      {
        record_key: 'bridge:remote-only',
        source_sha256: 'REMOTE-ONLY',
        updated_at: '2026-07-09T11:00:00.000Z',
        content_markdown: '# Remote Only\n',
        version: 1,
      },
      {
        record_key: 'bridge:local-ahead',
        source_sha256: 'REMOTE-OLDER',
        updated_at: '2026-07-09T09:00:00.000Z',
        content_markdown: '# Local Ahead remote\n',
        version: 3,
      },
    ],
  );

  assert.equal(plan.remoteAheadCount, 1);
  assert.equal(plan.inSyncCount, 1);
  assert.equal(plan.remoteOnlyCount, 1);
  assert.equal(plan.localOnlyCount, 1);
  assert.equal(plan.localAheadCount, 1);
  assert.equal(plan.conflictCount, 0);
  assert.equal(plan.mergedRecords.find((item) => item.record_key === 'bridge:patterns')?.merge_state, 'remote_ahead');
  assert.equal(plan.mergedRecords.find((item) => item.record_key === 'bridge:local-ahead')?.merge_state, 'local_ahead');
});

test('buildBridgeCacheManifestEntry creates a machine-facing cache manifest row', () => {
  const entry = buildBridgeCacheManifestEntry({
    record_key: 'bridge:patterns',
    topic: 'patterns',
    title: 'Patterns',
    summary: 'Useful bridge summary.',
    source_sha256: 'ABC123',
    source_device: 'mac-mini',
    updated_at: '2026-07-09T10:00:00.000Z',
    merge_state: 'in_sync',
    selected_source: 'shared',
    conflict_flag: false,
    version: 3,
  });

  assert.equal(entry.name, 'patterns.md');
  assert.equal(entry.recordKey, 'bridge:patterns');
  assert.equal(entry.mergeState, 'in_sync');
  assert.equal(entry.selectedSource, 'shared');
  assert.equal(entry.version, 3);
});
