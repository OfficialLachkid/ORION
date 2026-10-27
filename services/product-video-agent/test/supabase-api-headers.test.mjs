import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSupabaseApiHeaders,
  isSupabaseOpaqueApiKey,
} from '../../lib/supabase-api-headers.mjs';
import { SupabasePublicationStore } from '../src/publication-store.mjs';

test('legacy JWT API keys retain the Authorization bearer header', () => {
  const headers = createSupabaseApiHeaders('eyJlegacy-service-role', {
    'Content-Type': 'application/json',
  });

  assert.deepEqual(headers, {
    apikey: 'eyJlegacy-service-role',
    Authorization: 'Bearer eyJlegacy-service-role',
    'Content-Type': 'application/json',
  });
  assert.equal(isSupabaseOpaqueApiKey('eyJlegacy-service-role'), false);
});

test('new secret API keys are sent only through the apikey header', () => {
  const headers = createSupabaseApiHeaders('sb_secret_orion_runtime', {
    Prefer: 'return=representation',
  });

  assert.deepEqual(headers, {
    apikey: 'sb_secret_orion_runtime',
    Prefer: 'return=representation',
  });
  assert.equal(isSupabaseOpaqueApiKey('sb_secret_orion_runtime'), true);
});

test('new publishable API keys are sent only through the apikey header', () => {
  const headers = createSupabaseApiHeaders('sb_publishable_orion_client');

  assert.deepEqual(headers, {
    apikey: 'sb_publishable_orion_client',
  });
  assert.equal(isSupabaseOpaqueApiKey('sb_publishable_orion_client'), true);
});

test('publication persistence uses the shared opaque-key header policy', () => {
  const store = new SupabasePublicationStore({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'sb_secret_orion_runtime',
  });

  assert.deepEqual(store.createHeaders('return=representation'), {
    apikey: 'sb_secret_orion_runtime',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  });
});
