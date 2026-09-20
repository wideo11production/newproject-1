export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}

export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

export function pickBy<T extends Record<string, unknown>>(
  obj: T,
  predicate: (value: unknown, key: string) => boolean
): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (predicate(value, key)) result[key as keyof T] = value as T[keyof T];
  }
  return result;
}

export function omitBy<T extends Record<string, unknown>>(
  obj: T,
  predicate: (value: unknown, key: string) => boolean
): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!predicate(value, key)) result[key as keyof T] = value as T[keyof T];
  }
  return result;
}

export function mapKeys<T extends Record<string, unknown>>(
  obj: T,
  mapper: (key: string, value: unknown) => string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[mapper(key, value)] = value;
  }
  return result;
}

export function mapValues<T extends Record<string, unknown>, U>(
  obj: T,
  mapper: (value: unknown, key: string) => U
): Record<string, U> {
  const result: Record<string, U> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = mapper(value, key);
  }
  return result;
}

export function invert<T extends Record<string, string | number>>(obj: T): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[String(value)] = key;
  }
  return result;
}

export function hasKey<T extends Record<string, unknown>>(obj: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function getPath<T>(obj: Record<string, unknown>, path: string): T | undefined {
  return path.split(".").reduce((current: unknown, key: string) => {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj) as T | undefined;
}

export function setPath<T>(obj: Record<string, unknown>, path: string, value: T): Record<string, unknown> {
  const result = deepClone(obj);
  const keys = path.split(".");
  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey) current[lastKey] = value;
  return result;
}

export function deletePath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const result = deepClone(obj);
  const keys = path.split(".");
  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      return result;
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey) delete current[lastKey];
  return result;
}

export function isEmpty(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length === 0;
}

export function keysOf<T extends Record<string, unknown>>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[];
}

export function valuesOf<T extends Record<string, unknown>>(obj: T): T[keyof T][] {
  return Object.values(obj) as T[keyof T][];
}

export function entriesOf<T extends Record<string, unknown>>(obj: T): [keyof T, T[keyof T]][] {
  return Object.entries(obj) as [keyof T, T[keyof T]][];
}

export function fromEntries<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries);
}

export function renameKeys<T extends Record<string, unknown>>(
  obj: T,
  keyMap: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = keyMap[key] || key;
    result[newKey] = value;
  }
  return result;
}

export function defaults<T extends Record<string, unknown>>(obj: T, defaults: Partial<T>): T {
  return { ...defaults, ...obj };
}