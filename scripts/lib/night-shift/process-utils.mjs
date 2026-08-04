import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { projectRoot } from '../../../services/lib/runtime-config.mjs';

function normalizeText(value) {
  return String(value || '').trim();
}

export function parseTrailingJsonArray(stdout) {
  const text = normalizeText(stdout);
  if (!text) {
    return [];
  }

  for (let index = text.lastIndexOf('['); index >= 0; index = text.lastIndexOf('[', index - 1)) {
    const candidate = text.slice(index);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Keep scanning backward until the trailing JSON array is found.
    }
  }

  return [];
}

export function parseLastJsonObject(stdout) {
  const text = normalizeText(stdout);
  if (!text) {
    return null;
  }

  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    const candidate = text.slice(index);
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning backward until the trailing JSON object is found.
    }
  }

  return null;
}

export function runNodeScript(scriptPath, args = [], options = {}) {
  return spawnSync(options.executable || process.execPath, [scriptPath, ...args], {
    cwd: options.cwd || projectRoot,
    encoding: 'utf8',
    timeout: options.timeoutMs,
  });
}

export function runProjectNodeScript(relativePath, args = [], options = {}) {
  return runNodeScript(resolve(projectRoot, relativePath), args, options);
}

export function collectChildError(child) {
  return child.error?.message
    || (child.status === 0 ? '' : String(child.stderr || '').trim());
}
