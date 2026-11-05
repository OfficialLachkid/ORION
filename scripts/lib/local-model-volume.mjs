import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function isMounted(root, dependencies) {
  try {
    const output = dependencies.execFileSync(
      '/sbin/mount',
      [],
      { encoding: 'utf8' },
    );
    return String(output)
      .split(/\r?\n/u)
      .some((line) => line.includes(` on ${root} (`));
  } catch {
    return false;
  }
}

export function ensureLocalModelVolumeMounted(storage, options = {}) {
  const dependencies = {
    execFileSync,
    existsSync,
    ...options,
  };

  if (isMounted(storage.root, dependencies)) {
    return { mounted: true, attached: false, root: storage.root };
  }
  if (!dependencies.existsSync(storage.bundlePath)) {
    throw new Error(`Local model bundle is unavailable: ${storage.bundlePath}`);
  }

  dependencies.execFileSync('/usr/bin/hdiutil', [
    'attach',
    storage.bundlePath,
    '-mountpoint',
    storage.root,
    '-nobrowse',
  ], { stdio: 'inherit' });

  if (!isMounted(storage.root, dependencies)) {
    throw new Error(`Local model volume did not mount at ${storage.root}`);
  }
  return { mounted: true, attached: true, root: storage.root };
}

export function createLocalModelSparseBundle(storage, options = {}) {
  const dependencies = {
    execFileSync,
    existsSync,
    ...options,
  };

  if (dependencies.existsSync(storage.bundlePath)) {
    return { created: false, bundlePath: storage.bundlePath };
  }
  dependencies.execFileSync('/usr/bin/hdiutil', [
    'create',
    '-type',
    'SPARSEBUNDLE',
    '-fs',
    'APFS',
    '-size',
    storage.maximumCapacity,
    '-volname',
    storage.volumeName,
    storage.bundlePath,
  ], { stdio: 'inherit' });

  return { created: true, bundlePath: storage.bundlePath };
}
