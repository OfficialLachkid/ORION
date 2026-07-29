import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapLibraryEntryToSupabaseRow,
  mapSupabaseRowToLibraryEntry,
} from '../lib/website-builder-supabase.mjs';

test('mapLibraryEntryToSupabaseRow maps website entries to Supabase column names', () => {
  const row = mapLibraryEntryToSupabaseRow('website', {
    id: 'website-1',
    title: 'North Coast Hideaway website',
    companyName: 'North Coast Hideaway',
    summary: 'Company-specific draft',
    templateId: 'panorama-landing',
    sourceDesignId: 'starter-design-panorama-landing',
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T11:00:00.000Z',
    draft: { site: { title: 'North Coast Hideaway' } },
  });

  assert.equal(row.company_name, 'North Coast Hideaway');
  assert.equal(row.source_design_id, 'starter-design-panorama-landing');
  assert.equal(row.template_id, 'panorama-landing');
});

test('mapSupabaseRowToLibraryEntry maps design rows back into Website Builder entries', () => {
  const entry = mapSupabaseRowToLibraryEntry('design', {
    id: 'starter-design-trust-signals',
    title: 'Canal Retreat Studio design',
    summary: 'Reusable starter design',
    template_id: 'trust-signals',
    draft: { site: { title: 'Canal Retreat Studio' } },
    created_at: '2026-07-12T10:00:00.000Z',
    updated_at: '2026-07-12T10:30:00.000Z',
  });

  assert.equal(entry.kind, 'design');
  assert.equal(entry.templateId, 'trust-signals');
  assert.equal(entry.title, 'Canal Retreat Studio design');
});
