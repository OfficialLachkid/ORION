import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { withItchBrowserLock } from '../src/itch-browser-lock.mjs';

test('authenticated itch browser operations wait and execute sequentially', async () => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-browser-lock-'));
  const events = [];
  let releaseFirst;
  const firstMayFinish = new Promise((resolveRelease) => { releaseFirst = resolveRelease; });
  let notifyFirstStarted;
  const firstStarted = new Promise((resolveStarted) => { notifyFirstStarted = resolveStarted; });

  const first = withItchBrowserLock({ projectRoot, pollIntervalMs: 5 }, async () => {
    events.push('first-start');
    notifyFirstStarted();
    await firstMayFinish;
    events.push('first-end');
  });
  await firstStarted;
  const second = withItchBrowserLock({ projectRoot, pollIntervalMs: 5 }, async () => {
    events.push('second-start');
    events.push('second-end');
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  assert.deepEqual(events, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('authenticated itch browser lock recovers a stale dead owner', async () => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-browser-stale-lock-'));
  const lockPath = resolve(projectRoot, 'data/runtime/digital-asset-engine/.itch-browser.lock');
  await mkdir(resolve(lockPath, '..'), { recursive: true });
  await writeFile(lockPath, JSON.stringify({ pid: 987654321, token: 'stale' }));
  let ran = false;
  await withItchBrowserLock({
    projectRoot,
    processAlive: () => false,
    pollIntervalMs: 1,
  }, async () => { ran = true; });
  assert.equal(ran, true);
});

test('authenticated itch browser lock recovers after a crashed stale-lock recovery attempt', async () => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-browser-stale-recovery-'));
  const lockPath = resolve(projectRoot, 'data/runtime/digital-asset-engine/.itch-browser.lock');
  await mkdir(resolve(lockPath, '..'), { recursive: true });
  await Promise.all([
    writeFile(lockPath, JSON.stringify({ pid: 987654321, token: 'stale' })),
    writeFile(`${lockPath}.recovery`, 'stale recovery marker'),
  ]);
  let ran = false;
  await withItchBrowserLock({
    projectRoot,
    processAlive: () => false,
    staleLockMs: 1,
    recoveryMarkerStaleMs: 1,
    pollIntervalMs: 1,
  }, async () => { ran = true; });
  assert.equal(ran, true);
});

test('authenticated itch browser lock does not remove a fresh lock before its owner metadata is written', async () => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-browser-fresh-lock-'));
  const lockPath = resolve(projectRoot, 'data/runtime/digital-asset-engine/.itch-browser.lock');
  await mkdir(resolve(lockPath, '..'), { recursive: true });
  await writeFile(lockPath, '');
  await assert.rejects(
    withItchBrowserLock({
      projectRoot,
      processAlive: () => false,
      waitTimeoutMs: 5,
      pollIntervalMs: 1,
    }, async () => {}),
    (error) => error.code === 'RUNTIME_RESOURCE_BUSY',
  );
});

test('authenticated itch browser lock reports bounded resource contention', async () => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-browser-busy-lock-'));
  const lockPath = resolve(projectRoot, 'data/runtime/digital-asset-engine/.itch-browser.lock');
  await mkdir(resolve(lockPath, '..'), { recursive: true });
  await writeFile(lockPath, JSON.stringify({ pid: 42, token: 'active' }));
  await assert.rejects(
    withItchBrowserLock({
      projectRoot,
      processAlive: () => true,
      waitTimeoutMs: 5,
      pollIntervalMs: 1,
    }, async () => {}),
    (error) => error.code === 'RUNTIME_RESOURCE_BUSY'
      && error.resource === 'itch_browser_profile',
  );
});
