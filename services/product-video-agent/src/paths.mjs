import { isAbsolute, relative, resolve } from 'node:path';

export function resolveInsideRoot(rootPath, candidatePath, label = 'path') {
  const root = resolve(rootPath);
  const target = resolve(root, candidatePath);
  const relativePath = relative(root, target);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the project root.`);
  }

  return target;
}
