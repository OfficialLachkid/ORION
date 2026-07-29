import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCorpusSignals,
  summarizeCorpusSignals,
  summarizeModelResults,
} from '../scripts/benchmark-script-models.mjs';

test('model benchmark reports comparable pass rates and timing', () => {
  const summaries = summarizeModelResults([
    { model: 'model-a', status: 'passed', elapsed_ms: 100 },
    { model: 'model-a', status: 'failed', elapsed_ms: 300 },
    { model: 'model-b', status: 'passed', elapsed_ms: 150 },
  ]);

  assert.deepEqual(summaries, [
    {
      model: 'model-a',
      attempts: 2,
      passed: 1,
      failed: 1,
      elapsed_ms: 400,
      pass_rate: 0.5,
      average_elapsed_ms: 200,
    },
    {
      model: 'model-b',
      attempts: 1,
      passed: 1,
      failed: 0,
      elapsed_ms: 150,
      pass_rate: 1,
      average_elapsed_ms: 150,
    },
  ]);
});

test('model benchmark reports duration fit and duplicate angle scripts', () => {
  const results = addCorpusSignals([
    {
      model: 'model-a',
      product_id: 'product-a',
      angle: 'problem_solution',
      target_duration_seconds: 10,
      status: 'passed',
      script: {
        spoken_text: 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.',
      },
    },
    {
      model: 'model-a',
      product_id: 'product-a',
      angle: 'novelty',
      target_duration_seconds: 10,
      status: 'passed',
      script: {
        spoken_text: 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen!',
      },
    },
    {
      model: 'model-b',
      product_id: 'product-a',
      angle: 'novelty',
      target_duration_seconds: 10,
      status: 'failed',
      script: null,
    },
  ]);

  assert.equal(results[0].corpus_signals.word_count, 16);
  assert.equal(results[0].corpus_signals.target_word_count, 23);
  assert.equal(results[0].corpus_signals.within_duration_band, false);
  assert.equal(results[1].corpus_signals.duplicates_another_angle, true);
  assert.equal(results[2].corpus_signals, null);
  assert.deepEqual(summarizeCorpusSignals(results), [
    {
      model: 'model-a',
      passed_scripts: 2,
      scripts_within_duration_band: 0,
      duplicate_angle_scripts: 1,
    },
    {
      model: 'model-b',
      passed_scripts: 0,
      scripts_within_duration_band: 0,
      duplicate_angle_scripts: 0,
    },
  ]);
});
