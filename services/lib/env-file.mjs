import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

function assertEnvEntry(key, value) {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`);
  }
  if (/[\r\n]/u.test(String(value))) {
    throw new Error(`Environment variable ${key} cannot contain a newline.`);
  }
}

export function upsertEnvValues(filePath, values = {}, options = {}) {
  const entries = Object.entries(values);
  for (const [key, value] of entries) {
    assertEnvEntry(key, value);
  }

  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const remaining = new Map(entries.map(([key, value]) => [key, String(value)]));
  const lines = existing.split(/\r?\n/u).map((line) => {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) return line;

    const key = line.slice(0, separatorIndex).trim();
    if (!remaining.has(key)) return line;

    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${value}`;
  });

  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }
  for (const [key, value] of remaining) {
    lines.push(`${key}=${value}`);
  }

  writeFileSync(filePath, `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    mode: options.mode ?? 0o600,
  });
  chmodSync(filePath, options.mode ?? 0o600);

  return {
    filePath,
    keys: entries.map(([key]) => key),
  };
}
