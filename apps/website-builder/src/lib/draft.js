export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function mergeDeep(defaultValue, overrideValue) {
  if (overrideValue === undefined) {
    return structuredClone(defaultValue);
  }

  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(overrideValue)) {
      return structuredClone(defaultValue);
    }

    const length = Math.max(defaultValue.length, overrideValue.length);
    return Array.from({ length }, (_, index) => {
      const baseItem = defaultValue[index];
      const nextItem = overrideValue[index];

      if (baseItem === undefined) {
        return structuredClone(nextItem);
      }

      return mergeDeep(baseItem, nextItem);
    });
  }

  if (isPlainObject(defaultValue)) {
    const normalizedOverride = isPlainObject(overrideValue) ? overrideValue : {};
    const keys = new Set([...Object.keys(defaultValue), ...Object.keys(normalizedOverride)]);
    const mergedObject = {};

    keys.forEach((key) => {
      mergedObject[key] = mergeDeep(defaultValue[key], normalizedOverride[key]);
    });

    return mergedObject;
  }

  return structuredClone(overrideValue);
}

export function getValueByPath(target, path) {
  return path.split('.').reduce((current, part) => {
    if (current === undefined || current === null) {
      return undefined;
    }

    return current[part];
  }, target);
}

export function setValueByPath(target, path, value) {
  const parts = path.split('.');
  const draftClone = structuredClone(target);
  let current = draftClone;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const nextKey = parts[index + 1];

    if (current[key] === undefined) {
      current[key] = /^\d+$/u.test(nextKey) ? [] : {};
    }

    current = current[key];
  }

  current[parts.at(-1)] = value;
  return draftClone;
}
