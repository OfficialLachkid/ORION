import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(currentDir, '..', '..');

function resolveConfiguredPath(basePath, configuredPath) {
  return isAbsolute(configuredPath)
    ? resolve(configuredPath)
    : resolve(basePath, configuredPath);
}

function repositoryDirectory(repository) {
  return `models--${String(repository).replaceAll('/', '--')}`;
}

export function loadLocalModelRegistry(projectRoot = defaultProjectRoot) {
  const registryPath = resolve(projectRoot, 'config', 'runtime', 'local-models.json');
  return {
    registryPath,
    registry: JSON.parse(readFileSync(registryPath, 'utf8')),
  };
}

export function resolveLocalModelStorageConfig(options = {}) {
  const projectRoot = options.projectRoot || defaultProjectRoot;
  const homeDirectory = options.homeDirectory || homedir();
  const env = options.env || process.env;
  const loaded = options.registry
    ? { registry: options.registry, registryPath: options.registryPath || '' }
    : loadLocalModelRegistry(projectRoot);
  const root = resolve(env.ORION_LOCAL_MODELS_ROOT || loaded.registry.default_root);
  const providers = Object.fromEntries(
    Object.entries(loaded.registry.providers || {}).map(([name, provider]) => [
      name,
      { ...provider, path: resolveConfiguredPath(root, provider.directory) },
    ]),
  );
  const compatibilityLinks = (loaded.registry.compatibility_links || []).map((link) => ({
    ...link,
    path: resolveConfiguredPath(
      link.path_kind === 'home' ? homeDirectory : projectRoot,
      link.path,
    ),
    target: providers[link.target_provider]?.path || '',
  }));
  const configuredBundlePath = env.ORION_LOCAL_MODELS_BUNDLE_PATH
    || loaded.registry.default_bundle_path
    || `${root}.sparsebundle`;

  return {
    expected: ['1', 'true', 'yes', 'on'].includes(
      String(env.LOCAL_MODEL_STORAGE_EXPECTED || '').trim().toLowerCase(),
    ),
    root,
    bundlePath: resolve(configuredBundlePath),
    volumeName: loaded.registry.volume_name || 'ORION Models',
    maximumCapacity: loaded.registry.maximum_capacity || '250g',
    registryPath: loaded.registryPath,
    providers,
    compatibilityLinks,
  };
}

function isDirectory(path, dependencies) {
  try {
    return dependencies.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function inspectLocalModelStorage(storage, options = {}) {
  const dependencies = {
    existsSync,
    lstatSync,
    realpathSync,
    statSync,
    ...options,
  };
  const missing = [];
  const invalidLinks = [];

  if (!isDirectory(storage.root, dependencies)) missing.push(storage.root);
  const ollama = storage.providers.ollama;
  if (ollama) {
    for (const directory of ['blobs', 'manifests']) {
      const path = resolve(ollama.path, directory);
      if (!isDirectory(path, dependencies)) missing.push(path);
    }
  }
  const huggingface = storage.providers.huggingface;
  if (huggingface) {
    for (const repository of huggingface.repositories || []) {
      const path = resolve(huggingface.path, 'hub', repositoryDirectory(repository));
      if (!isDirectory(path, dependencies)) missing.push(path);
    }
  }
  for (const link of storage.compatibilityLinks || []) {
    try {
      const stat = dependencies.lstatSync(link.path);
      const actualTarget = stat.isSymbolicLink() ? dependencies.realpathSync(link.path) : '';
      if (!stat.isSymbolicLink() || resolve(actualTarget) !== resolve(link.target)) {
        invalidLinks.push({ name: link.name, path: link.path, expectedTarget: link.target });
      }
    } catch {
      invalidLinks.push({ name: link.name, path: link.path, expectedTarget: link.target });
    }
  }

  const ready = missing.length === 0 && invalidLinks.length === 0;
  return {
    state: ready ? 'ready' : 'unavailable',
    ready,
    root: storage.root,
    missing,
    invalidLinks,
    expectedOllamaModels: ollama?.models || [],
    expectedHuggingFaceRepositories: huggingface?.repositories || [],
  };
}
