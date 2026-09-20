export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(str: string, length: number, suffix = "..."): string {
  if (str.length <= length) return str;
  return str.slice(0, length - suffix.length) + suffix;
}

export function truncateWords(str: string, maxWords: number, suffix = "..."): string {
  const words = str.split(/\s+/);
  if (words.length <= maxWords) return str;
  return words.slice(0, maxWords).join(" ") + suffix;
}

export function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function capitalizeWords(str: string): string {
  return str
    .split(/\s+/)
    .map((word) => capitalize(word))
    .join(" ");
}

export function camelCase(str: string): string {
  return str
    .replace(/[_\s-]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

export function pascalCase(str: string): string {
  const camel = camelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function snakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function kebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export function constantCase(str: string): string {
  return kebabCase(str).toUpperCase();
}

export function titleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function startsWith(str: string, prefix: string): boolean {
  return str.startsWith(prefix);
}

export function endsWith(str: string, suffix: string): boolean {
  return str.endsWith(suffix);
}

export function includes(str: string, substring: string): boolean {
  return str.includes(substring);
}

export function removePrefix(str: string, prefix: string): string {
  return startsWith(str, prefix) ? str.slice(prefix.length) : str;
}

export function removeSuffix(str: string, suffix: string): string {
  return endsWith(str, suffix) ? str.slice(0, -suffix.length) : str;
}

export function padStart(str: string, length: number, pad = " "): string {
  return str.padStart(length, pad);
}

export function padEnd(str: string, length: number, pad = " "): string {
  return str.padEnd(length, pad);
}

export function repeat(str: string, count: number): string {
  return str.repeat(count);
}

export function reverse(str: string): string {
  return str.split("").reverse().join("");
}

export function countOccurrences(str: string, substring: string): number {
  if (!substring) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(substring, pos)) !== -1) {
    count++;
    pos += substring.length;
  }
  return count;
}

export function replaceAll(str: string, search: string, replace: string): string {
  return str.split(search).join(replace);
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function unescapeHtml(str: string): string {
  return str
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#039;/g, "'");
}

export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

export function wordCount(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

export function lineCount(str: string): number {
  return str.split("\n").length;
}

export function indent(str: string, spaces = 2): string {
  const prefix = " ".repeat(spaces);
  return str
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");
}

export function dedent(str: string): string {
  const lines = str.split("\n");
  const minIndent = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = line.match(/^(\s*)/);
      return match?.[1]?.length ?? 0;
    })
    .reduce((min, indent) => Math.min(min, indent), Infinity);

  if (minIndent === Infinity || minIndent === 0) return str;

  return lines.map((line) => line.slice(minIndent)).join("\n");
}

export function template(str: string, data: Record<string, unknown>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ""));
}

export function generateId(prefix = "", length = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix ? `${prefix}_${result}` : result;
}

export function isBlank(str: string): boolean {
  return !str || str.trim().length === 0;
}

export function isNumeric(str: string): boolean {
  return /^\d+$/.test(str);
}

export function isAlphanumeric(str: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(str);
}

export function isAlpha(str: string): boolean {
  return /^[a-zA-Z]+$/.test(str);
}