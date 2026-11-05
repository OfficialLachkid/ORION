import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  inspectLocalModelStorage,
  resolveLocalModelStorageConfig,
} from './local-model-storage.mjs';

test('local model storage resolves providers and validates shared model caches', () => {
  const root = mkdtempSync(join(tmpdir(), 'orion-model-storage-'));
  const projectRoot = resolve(root, 'project');
  const homeDirectory = resolve(root, 'home');
  const registry = {
    default_root: resolve(root, 'models'),
    providers: {
      ollama: { directory: 'ollama', models: ['llama3.1:8b'] },
      huggingface: { directory: 'huggingface', repositories: ['hexgrad/Kokoro-82M'] },
    },
    compatibility_links: [{
      name: 'hf',
      path_kind: 'home',
      path: '.cache/huggingface',
      target_provider: 'huggingface',
    }],
  };
  const storage = resolveLocalModelStorageConfig({
    env: { LOCAL_MODEL_STORAGE_EXPECTED: 'true' },
    projectRoot,
    homeDirectory,
    registry,
  });
  mkdirSync(resolve(storage.providers.ollama.path, 'blobs'), { recursive: true });
  mkdirSync(resolve(storage.providers.ollama.path, 'manifests'), { recursive: true });
  mkdirSync(resolve(
    storage.providers.huggingface.path,
    'hub',
    'models--hexgrad--Kokoro-82M',
  ), { recursive: true });
  const inspection = inspectLocalModelStorage(storage, {
    lstatSync: () => ({ isSymbolicLink: () => true }),
    realpathSync: () => storage.providers.huggingface.path,
  });
  assert.equal(inspection.ready, true);
  assert.equal(inspection.expectedOllamaModels[0], 'llama3.1:8b');
  assert.equal(inspection.invalidLinks.length, 0);
});

test('local model storage reports an unavailable T7 root', () => {
  const storage = resolveLocalModelStorageConfig({
    env: {},
    registry: {
      default_root: '/missing/t7-models',
      providers: { ollama: { directory: 'ollama', models: [] } },
      compatibility_links: [],
    },
  });
  const inspection = inspectLocalModelStorage(storage, {
    statSync: () => { throw new Error('missing'); },
  });

  assert.equal(inspection.ready, false);
  assert.equal(inspection.state, 'unavailable');
  assert.ok(inspection.missing.length >= 1);
});
