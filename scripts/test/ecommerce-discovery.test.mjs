import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  acquireResourceLock,
  EcommerceDiscoveryBatchError,
  ensurePilotIsActive,
  parseSingleJsonObject,
  runEcommerceDiscovery,
  runStructuredProcess,
  sanitizeOperationalError,
  summarizeDiscoveryBatch,
} from '../lib/ecommerce-discovery.mjs';

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), 'orion-ecommerce-discovery-'));
}

function fakeFetch(url) {
  if (String(url).endsWith('/api/tags')) {
    return Promise.resolve({ ok: true, json: async () => ({ models: [{ name: 'qwen-test:latest' }] }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
}

function batchOutput() {
  return {
    schema: 'product-discovery-batch.v1',
    planId: 'pets-pilot',
    status: 'completed_with_warnings',
    jobCount: 2,
    completedJobCount: 2,
    failedJobCount: 0,
    totals: { candidateCount: 7, observationCount: 9, apiRequestsUsed: 3 },
    startedAt: '2026-10-12T00:00:00.000Z',
    completedAt: '2026-10-12T00:00:02.000Z',
    results: [
      { runId: 'run-1', source: 'cache', warnings: [] },
      { runId: 'run-2', source: 'supplier', warnings: [{ code: 'partial' }] },
    ],
  };
}

test('summarizeDiscoveryBatch accepts the owned ecommerce schema and returns operational fields only', () => {
  const summary = summarizeDiscoveryBatch(batchOutput(), 0);
  assert.deepEqual(summary, {
    schema: 'orion-ecommerce-discovery-run.v1',
    planId: 'pets-pilot',
    status: 'completed_with_warnings',
    startedAt: '2026-10-12T00:00:00.000Z',
    completedAt: '2026-10-12T00:00:02.000Z',
    durationMs: 2_000,
    jobCount: 2,
    completedJobCount: 2,
    failedJobCount: 0,
    candidateCount: 7,
    observationCount: 9,
    apiRequestsUsed: 3,
    cachedJobCount: 1,
    supplierJobCount: 1,
    warningCount: 1,
    exitCode: 0,
  });
  assert.equal(JSON.stringify(summary).includes('originalQuery'), false);
});

test('runEcommerceDiscovery uses the ecommerce cwd and exact batch arguments sequentially', async () => {
  const root = fixtureRoot();
  const repoPath = resolve(root, 'ecommerce');
  mkdirSync(resolve(repoPath, 'config'), { recursive: true });
  writeFileSync(resolve(repoPath, 'config', 'discovery-plan.example.json'), '{}');
  const calls = [];
  const outputs = [
    {
      exitCode: 0,
      timedOut: false,
      stdout: JSON.stringify({
        schema: 'product-discovery-plan-validation.v1',
        planSchema: 'product-discovery-plan.v1',
        planId: 'pets-pilot',
        jobCount: 2,
        valid: true,
      }),
      stderr: '',
    },
    { exitCode: 0, timedOut: false, stdout: JSON.stringify(batchOutput()), stderr: '' },
  ];
  const environment = {
    ECOMMERCE_REPO_PATH: repoPath,
    ECOMMERCE_DISCOVERY_PLAN_PATH: 'config/discovery-plan.example.json',
    ECOMMERCE_NPM_BIN: '/opt/homebrew/bin/npm',
    CJ_API_KEY: 'cj-secret',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'supabase-secret',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    OLLAMA_MODEL: 'qwen-test:latest',
  };
  const summary = await runEcommerceDiscovery({
    environment,
    orionRoot: root,
    pilotEnd: '2026-11-09',
    now: new Date('2026-10-12T10:00:00.000Z'),
    fetchImpl: fakeFetch,
    runProcess: async (input) => {
      calls.push(input);
      return outputs.shift();
    },
  });
  assert.equal(summary.candidateCount, 7);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cwd, repoPath);
  assert.equal(calls[0].env.PATH.startsWith('/opt/homebrew/bin'), true);
  assert.deepEqual(calls[0].args, [
    'run', '--silent', 'discovery:batch', '--', '--plan',
    resolve(repoPath, 'config', 'discovery-plan.example.json'), '--validate',
  ]);
  assert.deepEqual(calls[1].args.slice(0, 6), [
    'run', '--silent', 'discovery:batch', '--', '--plan',
    resolve(repoPath, 'config', 'discovery-plan.example.json'),
  ]);
  assert.equal(existsSync(resolve(root, 'data', 'runtime', 'resource-locks', 'ecommerce-discovery.lock')), false);
  assert.equal(existsSync(resolve(root, 'data', 'runtime', 'resource-locks', 'ollama.lock')), false);
});

test('failed ecommerce batches preserve safe operational counts for reporting', async () => {
  const root = fixtureRoot();
  const repoPath = resolve(root, 'ecommerce');
  mkdirSync(resolve(repoPath, 'config'), { recursive: true });
  writeFileSync(resolve(repoPath, 'config', 'discovery-plan.example.json'), '{}');
  const failedBatch = {
    ...batchOutput(),
    status: 'completed_with_warnings',
    completedJobCount: 1,
    failedJobCount: 1,
  };
  const outputs = [
    {
      exitCode: 0,
      timedOut: false,
      stdout: JSON.stringify({
        schema: 'product-discovery-plan-validation.v1',
        planId: 'pets-pilot',
        jobCount: 2,
        valid: true,
      }),
      stderr: '',
    },
    { exitCode: 1, timedOut: false, stdout: JSON.stringify(failedBatch), stderr: '' },
  ];
  await assert.rejects(
    runEcommerceDiscovery({
      environment: {
        ECOMMERCE_REPO_PATH: repoPath,
        CJ_API_KEY: 'cj',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'role',
        OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
        OLLAMA_MODEL: 'qwen-test:latest',
      },
      orionRoot: root,
      fetchImpl: fakeFetch,
      runProcess: async () => outputs.shift(),
    }),
    (error) => {
      assert.equal(error instanceof EcommerceDiscoveryBatchError, true);
      assert.equal(error.summary.completedJobCount, 1);
      assert.equal(error.summary.failedJobCount, 1);
      assert.equal(error.summary.exitCode, 1);
      return true;
    },
  );
});

test('resource locks refuse concurrent ownership and are released by their owner', () => {
  const lockPath = resolve(fixtureRoot(), 'locks', 'ollama.lock');
  const release = acquireResourceLock(lockPath);
  assert.throws(() => acquireResourceLock(lockPath), /already held/u);
  release();
  assert.equal(existsSync(lockPath), false);
});

test('pilot guard fails closed on and after the configured end date', () => {
  assert.doesNotThrow(() => ensurePilotIsActive('2026-11-09', new Date('2026-11-08T12:00:00.000Z')));
  assert.throws(
    () => ensurePilotIsActive('2026-11-09', new Date('2026-11-09T12:00:00.000Z')),
    /pilot ended/u,
  );
});

test('operational errors redact known secret values and credential-shaped fields', () => {
  const sanitized = sanitizeOperationalError(
    'CJ_API_KEY=cj-secret token=tok-123 https://example.test/?access_token=visible',
    ['cj-secret'],
  );
  assert.equal(sanitized.includes('cj-secret'), false);
  assert.equal(sanitized.includes('tok-123'), false);
  assert.equal(sanitized.includes('visible'), false);
  assert.match(sanitized, /REDACTED/u);
});

test('parseSingleJsonObject rejects noisy stdout', () => {
  assert.throws(() => parseSingleJsonObject('notice\n{"ok":true}'), /not one JSON object/u);
});

test('runStructuredProcess terminates a process that exceeds its timeout', async () => {
  const result = await runStructuredProcess({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.signal, null);
});
