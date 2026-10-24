import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCHMARK_FIXTURES,
  BENCHMARK_PROFILES,
  PHOTOREALISTIC_BENCHMARK_FIXTURES,
  benchmarkModelRole,
  buildCounterbalancedBenchmarkCases,
  parseBenchmarkProfile,
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

test('benchmark model roles make current and candidate attachments unambiguous', () => {
  const models = ['current-model', 'candidate-model'];
  assert.equal(benchmarkModelRole(models, 'current-model'), 'CURRENT MODEL');
  assert.equal(benchmarkModelRole(models, 'candidate-model'), 'CANDIDATE MODEL');
});

test('photorealistic benchmark profile uses one identical controlled scene per model', () => {
  assert.equal(parseBenchmarkProfile([]), 'assets');
  assert.equal(parseBenchmarkProfile(['--profile', 'photorealistic']), 'photorealistic');
  assert.equal(BENCHMARK_PROFILES.photorealistic, PHOTOREALISTIC_BENCHMARK_FIXTURES);
  const cases = buildCounterbalancedBenchmarkCases(
    ['model-a', 'model-b'],
    PHOTOREALISTIC_BENCHMARK_FIXTURES,
  );
  assert.equal(cases.length, 2);
  assert.equal(cases[0].prompt, cases[1].prompt);
  assert.equal(cases[0].seed, cases[1].seed);
  assert.match(cases[0].prompt, /Ultra-photorealistic/u);
  assert.throws(() => parseBenchmarkProfile(['--profile', 'unknown']), /Unknown benchmark profile/u);
});
