import process from 'node:process';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isExecutedDirectly(importMetaUrl) {
  return Boolean(process.argv[1])
    && resolve(process.argv[1]) === resolve(fileURLToPath(importMetaUrl));
}

export function runCompatWrapper(importMetaUrl, relativeTargetPath) {
  if (!isExecutedDirectly(importMetaUrl)) {
    return null;
  }

  const currentFilePath = fileURLToPath(importMetaUrl);
  const targetPath = resolve(dirname(currentFilePath), relativeTargetPath);
  const child = spawn(
    process.execPath,
    [targetPath, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );

  child.on('error', (error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
  return child;
}
