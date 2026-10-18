import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  evaluateResearchCadence,
  findBlockingProcesses,
  parseProcessTable,
  runScheduledDigitalAssetResearch,
} from '../lib/digital-asset-research-schedule.mjs';
import { inspectRuntimeResourceLock } from '../lib/runtime-resource-lock.mjs';

test('research cadence prevents a retry from creating a second snapshot', () => {
  const now = new Date('2026-10-18T21:05:00.000Z');
  assert.equal(evaluateResearchCadence({
    lastSuccessfulAt: '2026-10-18T20:35:00.000Z',
    now,
    minimumIntervalMs: 23 * 60 * 60 * 1000,
  }).eligible, false);
  assert.equal(evaluateResearchCadence({
    lastSuccessfulAt: '2026-10-17T20:00:00.000Z',
    now,
    minimumIntervalMs: 23 * 60 * 60 * 1000,
  }).eligible, true);
});

test('research preflight recognizes night-shift and rendering processes', () => {
  const processes = parseProcessTable([
    '101 node scripts/run-night-shift.mjs --limit 30',
    '102 /opt/homebrew/bin/ffmpeg -i source.mov',
    '103 node services/discord-bot/index.mjs --live',
  ].join('\n'), -1);
  const blocking = findBlockingProcesses(processes);
  assert.deepEqual(blocking.map((entry) => entry.pid), [101, 102]);
});

test('runtime resource lock distinguishes active and stale owners', () => {
  const serialized = JSON.stringify({ pid: 4321, startedAt: '2026-10-19T01:30:00.000Z' });
  const active = inspectRuntimeResourceLock('/tmp/research.lock', {
    existsSync: () => true,
    readFileSync: () => serialized,
    kill: () => undefined,
  });
  const stale = inspectRuntimeResourceLock('/tmp/research.lock', {
    existsSync: () => true,
    readFileSync: () => serialized,
    kill: () => { throw new Error('missing'); },
  });

  assert.equal(active.held, true);
  assert.equal(active.reason, 'active');
  assert.equal(stale.held, false);
  assert.equal(stale.reason, 'stale');
});

test('scheduled research acquires shared locks and records one successful collection', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'orion-research-schedule-'));
  const archiveRoot = resolve(root, 'archive');
  mkdirSync(archiveRoot, { recursive: true });
  const releases = [];
  let writtenState;
  let processCall;
  const result = await runScheduledDigitalAssetResearch({
    projectRoot: root,
    archiveRoot,
    statePath: resolve(root, 'state.json'),
    generationLockPath: resolve(root, 'generation.lock'),
    researchLockPath: resolve(root, 'research.lock'),
    ollamaLockPath: resolve(root, 'ollama.lock'),
    researchScriptPath: resolve(root, 'research.mjs'),
    configPath: resolve(root, 'config.json'),
    runtimeEnvPath: resolve(root, '.env'),
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'llama3.1:8b',
    readState: () => ({}),
    writeState: (_path, value) => { writtenState = value; },
    listProcesses: () => [],
    acquireLock: (path) => () => releases.push(path),
    inspectOllama: async () => ({ installed: true, loadedModelCount: 0 }),
    runProcess: async (value) => {
      processCall = value;
      return {
        exitCode: 0,
        timedOut: false,
        stderr: '',
        stdout: JSON.stringify({
          runId: 'run-3',
          observationCount: 60,
          report: { status: 'monitoring' },
        }),
      };
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.runId, 'run-3');
  assert.equal(result.observationCount, 60);
  assert.equal(writtenState.runId, 'run-3');
  assert.ok(processCall.args.includes('--scheduled'));
  assert.deepEqual(releases, [resolve(root, 'ollama.lock'), resolve(root, 'research.lock')]);
});

