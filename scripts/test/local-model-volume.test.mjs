import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalModelSparseBundle,
  ensureLocalModelVolumeMounted,
} from '../lib/local-model-volume.mjs';

const storage = {
  root: '/Volumes/ORION Models',
  bundlePath: '/Volumes/T7/O.R.I.O.N. Models.sparsebundle',
  maximumCapacity: '250g',
  volumeName: 'ORION Models',
};

test('mounted model volume is reused without attaching it again', () => {
  const calls = [];
  const result = ensureLocalModelVolumeMounted(storage, {
    existsSync: () => true,
    execFileSync: (command, args) => {
      calls.push([command, args]);
      return '/Volumes/ORION Models\n';
    },
  });
  assert.equal(result.attached, false);
  assert.equal(calls.length, 1);
});

test('model sparse bundle is attached at the stable mount point', () => {
  const calls = [];
  let mounted = false;
  const result = ensureLocalModelVolumeMounted(storage, {
    existsSync: (path) => path === storage.bundlePath,
    execFileSync: (command, args) => {
      calls.push([command, args]);
      if (command === '/usr/bin/hdiutil') mounted = true;
      return mounted ? '/Volumes/ORION Models\n' : '/\n';
    },
  });
  assert.equal(result.attached, true);
  assert.deepEqual(calls[1][1], [
    'attach', storage.bundlePath, '-mountpoint', storage.root, '-nobrowse',
  ]);
});

test('missing model sparse bundle fails safely', () => {
  assert.throws(
    () => ensureLocalModelVolumeMounted(storage, { existsSync: () => false }),
    /Local model bundle is unavailable/u,
  );
});

test('model sparse bundle is created as APFS with bounded capacity', () => {
  const calls = [];
  const result = createLocalModelSparseBundle(storage, {
    existsSync: () => false,
    execFileSync: (...args) => calls.push(args),
  });
  assert.equal(result.created, true);
  assert.deepEqual(calls[0][1], [
    'create', '-type', 'SPARSEBUNDLE', '-fs', 'APFS', '-size', '250g',
    '-volname', 'ORION Models', storage.bundlePath,
  ]);
});
