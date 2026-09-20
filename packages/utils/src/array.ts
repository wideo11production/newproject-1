export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) throw new Error("Chunk size must be positive");
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export function flatten<T>(array: T[][]): T[] {
  return array.reduce((acc, val) => acc.concat(val), []);
}

export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

export function uniqueBy<T, K>(array: T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  return array.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function groupBy<T, K>(array: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of array) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

export function groupByObject<T, K extends string>(array: T[], key: (item: T) => K): Record<K, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of array) {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result as Record<K, T[]>;
}

export function sortBy<T>(array: T[], key: (item: T) => number | string, order: "asc" | "desc" = "asc"): T[] {
  return [...array].sort((a, b) => {
    const aVal = key(a);
    const bVal = key(b);
    if (aVal < bVal) return order === "asc" ? -1 : 1;
    if (aVal > bVal) return order === "asc" ? 1 : -1;
    return 0;
  });
}

export function partition<T>(array: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const truthy: T[] = [];
  const falsy: T[] = [];
  for (const item of array) {
    if (predicate(item)) truthy.push(item);
    else falsy.push(item);
  }
  return [truthy, falsy];
}

export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j]!;
    result[j] = temp!;
  }
  return result;
}

export function sample<T>(array: T[], count = 1): T[] {
  if (count >= array.length) return shuffle(array);
  const shuffled = shuffle(array);
  return shuffled.slice(0, count);
}

export function intersection<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter((item) => setB.has(item));
}

export function difference<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter((item) => !setB.has(item));
}

export function union<T>(...arrays: T[][]): T[] {
  const set = new Set<T>();
  for (const arr of arrays) {
    for (const item of arr) set.add(item);
  }
  return [...set];
}

export function zip<T, U>(a: T[], b: U[]): [T, U][] {
  const length = Math.min(a.length, b.length);
  const result: [T, U][] = [];
  for (let i = 0; i < length; i++) {
    const aVal = a[i];
    const bVal = b[i];
    if (aVal !== undefined && bVal !== undefined) {
      result.push([aVal, bVal]);
    }
  }
  return result;
}

export function unzip<T, U>(pairs: [T, U][]): [T[], U[]] {
  return pairs.reduce(
    ([a, b], [x, y]) => {
      a.push(x);
      b.push(y);
      return [a, b];
    },
    [[], []] as [T[], U[]]
  );
}

export function range(start: number, end?: number, step = 1): number[] {
  if (end === undefined) {
    end = start;
    start = 0;
  }
  const result: number[] = [];
  if (step > 0) {
    for (let i = start; i < end; i += step) result.push(i);
  } else {
    for (let i = start; i > end; i += step) result.push(i);
  }
  return result;
}

export function sum(array: number[]): number {
  return array.reduce((a, b) => a + b, 0);
}

export function average(array: number[]): number {
  if (array.length === 0) return 0;
  return sum(array) / array.length;
}

export function median(array: number[]): number {
  if (array.length === 0) return 0;
  const sorted = [...array].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid - 1] ?? 0;
  const right = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
}

export function min(array: number[]): number {
  return Math.min(...array);
}

export function max(array: number[]): number {
  return Math.max(...array);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}