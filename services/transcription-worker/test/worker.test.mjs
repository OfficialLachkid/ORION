import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { processTranscriptionRequest } from '../src/worker.mjs';

test('processTranscriptionRequest returns completed for mock transcripts', async () => {
  const config = loadRuntimeConfig();
  const result = await processTranscriptionRequest({
    mockTranscript: 'Check the current Ruflo daemon health on the Mac mini.',
    attachments: [],
  }, config);

  assert.equal(result.status, 'completed');
  assert.equal(result.transcript, 'Check the current Ruflo daemon health on the Mac mini.');
  assert.equal(result.provider, config.transcription.provider);
  assert.equal(result.segmentCount, 1);
});

test('processTranscriptionRequest blocks when no supported audio is available', async () => {
  const config = loadRuntimeConfig();
  const result = await processTranscriptionRequest({
    attachments: [],
  }, config);

  assert.equal(result.status, 'blocked');
  assert.match(result.warnings[0], /supported audio attachment/u);
});
