import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearchGenerationWorker } from '../src/generation-worker-loop.mjs';

test('generation worker loop waits and retries the same job after resource contention', async () => {
  const calls = [];
  const result = await runResearchGenerationWorker({
    jobPath: '/durable/job.json',
    sleep: async (delay) => { calls.push(['sleep', delay]); },
    runJob: async (options) => {
      calls.push(['run', options.jobPath]);
      if (calls.filter(([type]) => type === 'run').length === 1) {
        const error = new Error('shared local image slot busy');
        error.code = 'RESEARCH_GENERATION_RESOURCE_BUSY';
        error.retryAfterMs = 2500;
        throw error;
      }
      return { status: 'completed', product_slug: 'space-station-essentials' };
    },
  });
  assert.deepEqual(calls, [
    ['run', '/durable/job.json'],
    ['sleep', 2500],
    ['run', '/durable/job.json'],
  ]);
  assert.equal(result.status, 'completed');
  assert.equal(result.resource_wait_cycles, 1);
});

test('generation worker loop does not retry unrelated failures', async () => {
  await assert.rejects(
    runResearchGenerationWorker({
      sleep: async () => { throw new Error('must not sleep'); },
      runJob: async () => { throw new Error('invalid generated asset'); },
    }),
    /invalid generated asset/iu,
  );
});
