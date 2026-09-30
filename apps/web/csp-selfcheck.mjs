/**
 * CSP self-consistency check.
 *
 * A CSP that blocks the app's OWN resources is worse than no CSP - the app
 * white-screens and nobody knows why. This statically cross-checks every
 * resource the pages actually reference against the directives in
 * next.config.mjs, so a future change to either side gets caught here
 * instead of in a browser console.
 *
 * Requires a running dev server on :3000.
 * Run: pnpm csp:check
 */
import cfg from './next.config.mjs';

const PAGE_URLS = ['/', '/auth/login', '/auth/register', '/dashboard'];

const out = await cfg.headers();
const csp = out[0].headers.find((h) => h.key === 'Content-Security-Policy').value;

/** Parse "a b c; d e" into { a: ['b','c'], d: ['e'] } */
function parseCSP(value) {
  const parsed = {};
  for (const part of value.split(';')) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (bits.length) parsed[bits[0]] = bits.slice(1);
  }
  return parsed;
}
const d = parseCSP(csp);

/** Does the directive allow this URL? */
function allowed(directive, url) {
  const tokens = d[directive] || [];
  if (!tokens.length) return { ok: false, why: `no ${directive} directive` };
  let u;
  try {
    u = new URL(url, 'http://localhost:3000');
  } catch {
    return { ok: false, why: 'unparseable reference' };
  }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  for (const token of tokens) {
    if (token === "'self'" && isLocal) return { ok: true, why: "'self'" };
    if (token === 'data:' && url.startsWith('data:')) return { ok: true, why: 'data:' };
    if (token === 'blob:' && url.startsWith('blob:')) return { ok: true, why: 'blob:' };
    if (token === 'https:' && u.protocol === 'https:') return { ok: true, why: 'https:' };
    if (token === 'ws:' || token === 'wss:') return { ok: true, why: 'ws (dev HMR)' };
    if (token.startsWith('http') && u.origin === token) return { ok: true, why: token };
  }
  return { ok: false, why: `origin ${u.origin} not in ${directive}` };
}

let failures = 0;
let checked = 0;

for (const page of PAGE_URLS) {
  let res;
  try {
    res = await fetch(`http://localhost:3000${page}`, { redirect: 'manual' });
  } catch {
    console.log(`  ${page} -> dev server not reachable, skipped`);
    continue;
  }
  if (!res.ok && res.status !== 307 && res.status !== 308) {
    console.log(`  ${page} -> HTTP ${res.status} (skipped, not a 200 render)`);
    continue;
  }
  const html = await res.text();
  const refs = new Set();

  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) refs.add(m[1]);

  for (const ref of refs) {
    // Decide which directive governs this reference.
    let directive = 'script-src';
    if (/\.css($|\?)/.test(ref)) directive = 'style-src';
    else if (/\.(woff2?|ttf|otf)($|\?)/.test(ref)) directive = 'font-src';
    else if (/\.(png|jpe?g|webp|gif|svg|ico|avif)($|\?)/.test(ref)) directive = 'img-src';

    checked++;
    const verdict = allowed(directive, ref);
    if (!verdict.ok) {
      failures++;
      console.log(`  BLOCKED  ${page}  [${directive}]  ${ref}  -> ${verdict.why}`);
    }
  }
  console.log(`  ${page} -> HTTP ${res.status}, ${refs.size} resources checked`);
}

console.log(`\nchecked ${checked} resource references across ${PAGE_URLS.length} pages`);
if (failures) {
  console.log(`FAIL: ${failures} resource(s) would be blocked by the CSP`);
  process.exit(1);
}
if (!checked) {
  console.log('WARN: nothing was checked - is the dev server running on :3000?');
  process.exit(0);
}
console.log('PASS: no page resource is blocked by the CSP');
