// Generic de-duplicator: finds repeated line runs and removes the LATER copy.
//
// The check script had a hand-spliced block land in the wrong place, which left
// one long region present twice. Rather than hunt for the seam by hand, hash
// every window and cut the repeats - a repeated 40-line window can only be an
// accidental copy.
import { readFileSync, writeFileSync } from 'node:fs';

const f = process.argv[2];
const WINDOW = 40;
const lines = readFileSync(f, 'utf8').split(/\r?\n/);

const seen = new Map();
const dupRanges = [];
for (let i = 0; i + WINDOW <= lines.length; i++) {
  const key = lines.slice(i, i + WINDOW).join('\n');
  const first = seen.get(key);
  if (first !== undefined) {
    dupRanges.push([first, i]);
  } else {
    seen.set(key, i);
  }
}

if (!dupRanges.length) {
  console.log('no duplicated regions found');
  process.exit(0);
}

// Merge the ranges, then drop the later copy of each.
dupRanges.sort((a, b) => a[1] - b[1]);
const drop = new Set();
for (const [, start] of dupRanges) {
  for (let i = start; i < start + WINDOW; i++) drop.add(i);
}
console.log(`dropping ${drop.size} lines`);
const kept = lines.filter((_, i) => !drop.has(i));
writeFileSync(f, kept.join('\n'), 'utf8');
console.log(`${lines.length} -> ${kept.length}`);
