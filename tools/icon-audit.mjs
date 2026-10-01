import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Inventory every lucide icon size in the app, so the sizes can be corrected
// to the spec in ONE pass instead of by eye. The spec is:
//
//   toolbar button   28x28, glyph 16px   (h-7 w-7 / h-4 w-4)
//   rail             32x32, glyph 14px   (h-8 w-8 / h-3.5 w-3.5)
//   panel / gallery  24x24, glyph 12px   (h-6 w-6 / h-3 w-3)
//   micro (meta)     16x16, glyph  8px   (h-4 w-4 / h-2 w-2)

const ROOT = 'apps/video-editor/src/app';
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx$/.test(p)) files.push(p);
  }
};
walk(ROOT);

const SIZES = ['h-1 w-1', 'h-1.5 w-1.5', 'h-2 w-2', 'h-2.5 w-2.5', 'h-3 w-3', 'h-3.5 w-3.5', 'h-4 w-4', 'h-4.5 w-4.5', 'h-5 w-5', 'h-6 w-6'];

const rows = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((l, i) => {
    // Only LUCIDE icons, not lucide Icon placeholders in the chip legend.
    const m = /<([A-Z][A-Za-z0-9]*)\s+className="([^"]*h-[\d.]+ w-[\d.]+[^"]*)"/.exec(l);
    if (!m) return;
    const [, name, cls] = m;
    const size = /h-([\d.]+) w-[\d.]+/.exec(cls);
    if (!size) return;
    rows.push({ file: f.replace(/.*src[\\/]app[\\/]/, ''), line: i + 1, name, px: Number(size[1]) * 4 });
  });
}

const bySize = new Map();
for (const r of rows) {
  if (!bySize.has(r.px)) bySize.set(r.px, []);
  bySize.get(r.px).push(r);
}

console.log('lucide icon sizes currently in use (px -> count):');
for (const px of [...bySize.keys()].sort((a, b) => b - a)) {
  console.log(`  ${String(px).padStart(4)}px  x${bySize.get(px).length}`);
}

const over16 = rows.filter((r) => r.px > 16);
console.log(`\n${over16.length} icons are LARGER than the 16px toolbar glyph:`);
for (const r of over16) console.log(`  ${r.px}px  ${r.name.padEnd(20)} ${r.file}:${r.line}`);

const odd = rows.filter((r) => ![8, 10, 12, 14, 16, 18].includes(r.px));
console.log(`\n${odd.length} icons are on an off-spec size (not 8/10/12/14/16/18):`);
for (const r of odd) console.log(`  ${r.px}px  ${r.name.padEnd(20)} ${r.file}:${r.line}`);

const out = 'apps/video-editor/icon-inventory.json';
readdirSync('.').length; // no-op
console.log(`\n${rows.length} icons total`);
