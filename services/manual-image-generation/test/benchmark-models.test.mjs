import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCHMARK_FIXTURES,
  buildCounterbalancedBenchmarkCases,
} from '../benchmark-models.mjs';

test('model benchmark counterbalances execution order while preserving fixture controls', () => {
  const cases = buildCounterbalancedBenchmarkCases(['model-a', 'model-b']);
  assert.deepEqual(cases.map((entry) => entry.model), [
    'model-a',
    'model-b',
    'model-b',
    'model-a',
  ]);
  assert.deepEqual(cases.map((entry) => entry.seed), [
    BENCHMARK_FIXTURES[0].seed,
    BENCHMARK_FIXTURES[0].seed,
    BENCHMARK_FIXTURES[1].seed,
    BENCHMARK_FIXTURES[1].seed,
  ]);
  assert.equal(cases[0].prompt, cases[1].prompt);
  assert.equal(cases[2].prompt, cases[3].prompt);
});
