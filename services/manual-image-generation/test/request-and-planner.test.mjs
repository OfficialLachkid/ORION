import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertManualImageOperator,
  parseManualImageGenerationRequest,
} from '../src/request.mjs';
import {
  buildDeterministicManualImagePlan,
  createManualImagePlan,
} from '../src/planner.mjs';
import { resolveManualImageGenerationConfig } from '../src/config.mjs';

function interaction(overrides = {}) {
  return {
    id: 'interaction-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      name: 'generate-image',
      options: [
        { name: 'prompt', value: 'Create a bomb and separate explosion stages on a transparent background' },
        { name: 'aspect_ratio', value: '16:9' },
      ],
    },
    member: {
      nick: 'Valen',
      roles: ['operator-role'],
      user: { id: 'operator-1', username: 'vbjservices' },
    },
    ...overrides,
  };
}

test('parses an omitted count for local decomposition and detects transparency', () => {
  const input = interaction();
  assert.doesNotThrow(() => assertManualImageOperator(input, {
    operatorRoleId: 'operator-role',
    operatorUserIds: [],
  }));
  const request = parseManualImageGenerationRequest(input, { now: '2026-10-23T12:00:00.000Z' });
  assert.equal(request.count, null);
  assert.equal(request.aspect_ratio, '16:9');
  assert.equal(request.transparent_background, true);
  assert.equal(request.requested_by_discord_id, 'operator-1');
});

test('rejects callers outside the configured operator allowlist', () => {
  assert.throws(
    () => assertManualImageOperator(interaction(), {
      operatorRoleId: 'different-role',
      operatorUserIds: ['different-user'],
    }),
    /approved ORION operator/u,
  );
});

test('manual image model override does not change the shared digital asset model', () => {
  const config = resolveManualImageGenerationConfig({
    env: {
      DIGITAL_ASSET_ARCHIVE_ROOT: 'C:\\archive',
      DIGITAL_ASSET_IMAGE_MODEL: 'x/flux2-klein:4b',
      MANUAL_IMAGE_MODEL: 'x/flux2-klein:4b-fp8',
    },
  });
  assert.equal(config.generation.model, 'x/flux2-klein:4b-fp8');
});

test('local planner decomposes an implicit multi-image request into a bounded plan', async () => {
  const request = parseManualImageGenerationRequest(interaction(), { now: '2026-10-23T12:00:00.000Z' });
  const plan = await createManualImagePlan(request, {
    jobId: 'manual-image-test',
    endpoint: 'http://127.0.0.1:11434',
    model: 'llama3.1:8b',
    maximumCount: 8,
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          message: {
            content: JSON.stringify({
              status: 'ready',
              inferred_count: 3,
              shared_style_context: 'Matching stylized bomb sequence.',
              consistency_constraints: ['Same bomb design and palette.'],
              clarification_message: '',
              images: [
                { index: 1, label: 'Idle bomb', prompt: 'Idle bomb.' },
                { index: 2, label: 'Initial blast', prompt: 'Initial blast.' },
                { index: 3, label: 'Smoke', prompt: 'Dissipating smoke.' },
              ],
            }),
          },
        });
      },
    }),
  });
  assert.equal(plan.inferred_count, 3);
  assert.equal(plan.width, 1024);
  assert.equal(plan.height, 576);
  assert.equal(plan.planner.provider, 'ollama');
  assert.equal(new Set(plan.images.map((image) => image.seed)).size, 3);
});

test('explicit count has a deterministic fallback when text planning is unavailable', async () => {
  const request = parseManualImageGenerationRequest(interaction({
    data: {
      name: 'generate-image',
      options: [
        { name: 'prompt', value: 'Three matching landscape concepts' },
        { name: 'count', value: 3 },
        { name: 'aspect_ratio', value: '3:2' },
      ],
    },
  }), { now: '2026-10-23T12:00:00.000Z' });
  const plan = await createManualImagePlan(request, {
    jobId: 'manual-image-explicit',
    endpoint: 'http://127.0.0.1:11434',
    model: 'llama3.1:8b',
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(plan.inferred_count, 3);
  assert.equal(plan.images.length, 3);
  assert.equal(plan.planner.provider, 'deterministic');
  assert.deepEqual(
    buildDeterministicManualImagePlan(request, { jobId: 'manual-image-explicit' }).images.map((image) => image.index),
    [1, 2, 3],
  );
});

test('uncertain automatic planning returns a clarification without image prompts', async () => {
  const request = parseManualImageGenerationRequest(interaction(), { now: '2026-10-23T12:00:00.000Z' });
  const plan = await createManualImagePlan(request, {
    jobId: 'manual-image-clarify',
    endpoint: 'http://127.0.0.1:11434',
    model: 'llama3.1:8b',
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          message: {
            content: JSON.stringify({
              status: 'clarification_required',
              inferred_count: 0,
              shared_style_context: '',
              consistency_constraints: [],
              clarification_message: 'Should the explosion stages share one fixed camera angle?',
              images: [],
            }),
          },
        });
      },
    }),
  });
  assert.equal(plan.status, 'clarification_required');
  assert.equal(plan.inferred_count, 0);
  assert.deepEqual(plan.images, []);
});
