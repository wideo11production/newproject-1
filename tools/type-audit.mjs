import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// What font sizes are actually in use, and how often.
//
// The complaint was "the fonts are all different sizes" and the fix that works is
// a system, not a hand edit. Tailwind arbitrary values like text-[13px] are how
// a codebase ends up with nine sizes, because each one felt locally right.
const ROOT = 'apps/video-editor/src/app';
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
};
walk(ROOT);

const counts = new Map();
const stray = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  src.split(/\r?\n/).forEach((l, i) => {
    // ONLY text-[Npx]. The named scale (text-xs etc) is fine and is the
    // preferred way to say this; the arbitrary values are the strays.
    for (const m of l.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      const px = Number(m[1]);
      counts.set(px, (counts.get(px) || 0) + 1);
      stray.push({ px, file: f.replace(/.*src[\\/]app[\\/]/, ''), line: i + 1 });
    }
  });
}

const named = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\btext-(xs|sm|base|lg|xl)\b/g)) {
    named.set(m[1], (named.get(m[1]) || 0) + 1);
  }
}

console.log('arbitrary text-[Npx] sizes:');
for (const [px, n] of [...counts].sort((a, b) => b[0] - a[0])) {
  console.log(`  ${String(px).padStart(5)}px  x${n}`);
}
console.log('\nnamed scale:');
for (const [k, n] of [...named].sort((a, b) => b[1] - a[1])) {
  console.log(`  text-${k.padEnd(5)} x${n}`);
}
console.log(`\ntotal stray sizes: ${stray.length}`);
