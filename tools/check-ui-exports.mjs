import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every entry in `exports` must point at a file that EXISTS.
 *
 * =============================================================================
 * WHY THIS FILE IS NECESSARY
 * =============================================================================
 *
 * The export map had:
 *
 *     "./collapse": "./src/collapse.tsx"
 *
 * and the file on disk is `collapsible.tsx`. So `@wideo11/ui/collapse` did not
 * resolve - and nothing reported it, because the entry was never imported by
 * anything. A dead export path is invisible to the compiler: TypeScript only
 * checks the specifiers somebody actually writes.
 *
 * At the same time `jwt-payload.ts` existed, was fully written, and had NO export
 * entry - so it was unreachable, dead code with no way to tell.
 *
 * Both are the same failure: the map and the directory are two lists that nobody
 * compares. So this compares them.
 *
 * =============================================================================
 * WHAT IS CHECKED, IN BOTH DIRECTIONS
 * =============================================================================
 *
 *   1. Every `exports` TARGET exists on disk.      (a dangling entry is a bug)
 *   2. Every top-level `src/*.ts(x)` is EXPORTED.   (an unexported file is dead)
 *
 * Direction 2 is a WARNING, not a failure. A component can be legitimately
 * internal, and refusing to build over one would train people to ignore the check.
 * Direction 1 is a failure, because a dangling entry breaks an import the moment
 * anybody uses it.
 *
 * Run:  node tools/check-ui-exports.mjs
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const pkgDir = join(here, '..', 'packages', 'ui');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

let pass = 0;
const fails = [];
const warns = [];
const check = (label, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`, detail ? JSON.stringify(detail) : '');
  } else {
    fails.push(label);
    console.log(`FAIL  ${label}`, detail ? JSON.stringify(detail) : '');
  }
};
const warn = (label, detail) => {
  warns.push(label);
  console.log(`WARN  ${label}`, detail ? JSON.stringify(detail) : '');
};

// ---------------------------------------------------------------------------
// 1. Every export target exists
// ---------------------------------------------------------------------------
const entries = Object.entries(pkg.exports ?? {});
check('the package declares an export map', entries.length > 0, { entries: entries.length });

const dangling = [];
const wildcards = [];
for (const [specifier, target] of entries) {
  // A wildcard subpath maps a directory, not a file - `./styles/*` is legal and
  // there is no single file to check.
  if (typeof target !== 'string' || target.includes('*')) {
    wildcards.push(specifier);
    continue;
  }
  const resolved = join(pkgDir, target);
  if (!existsSync(resolved)) dangling.push({ specifier, target });
}

check(
  'every export target EXISTS on disk',
  dangling.length === 0,
  {
    dangling,
    why: 'a dangling entry breaks the import the moment anything uses it, and nothing ' +
      'reports it until then - TypeScript only checks specifiers that are written',
  }
);

// ---------------------------------------------------------------------------
// 2. Every top-level source file is reachable
// ---------------------------------------------------------------------------
const srcDir = join(pkgDir, 'src');
const files = readdirSync(srcDir)
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .sort();

// What the map reaches, flattened back to `./name` form.
const reachable = new Set();
for (const [specifier, target] of entries) {
  if (typeof target === 'string') {
    const m = /^\.\/src\/(.+)\.(ts|tsx)$/.exec(target);
    if (m) reachable.add(`${m[1]}.${m[2]}`);
  }
}

// `index.ts` is the package root, not a subpath, so it is reached by `.`.
reachable.add('index.ts');

const unexported = files.filter((f) => !reachable.has(f));
check(
  'every top-level src file is reachable through the export map',
  unexported.length === 0,
  {
    unexported,
    why: 'an unexported file cannot be imported by any app, so it is dead code that ' +
      'still looks maintained',
  }
);

// ---------------------------------------------------------------------------
// 3. No entry points at a name that does not match the file
// ---------------------------------------------------------------------------
// This is the exact bug that was live: the SPECIFIER said one thing and the TARGET
// another. Nothing above catches it, because both the specifier and the target are
// perfectly well-formed - they just disagree with each other.
//
// `./collapse -> ./src/collapsible.tsx` resolves fine and fails at import time,
// so the check is that the specifier's basename equals the target's basename.
//
// Two shapes are legitimately exempt, and both are LISTS rather than patterns, so
// every exemption is a decision somebody wrote down:
//
//   - a directory barrel (`./brand -> ./src/brand/index.ts`), where the export name
//     is the directory by definition
//   - a deliberate alias (`./gate -> ./src/auth-gate.ts`), where the friendlier
//     public name is the point
//
// An earlier version of this check had no exemption list and failed on both, which
// would have trained people to ignore it.
const BARREL_TARGETS = /\/index\.(ts|tsx)$/;

/** specifier -> target, where the two deliberately differ. */
const INTENTIONAL_ALIASES = {
  // `auth-gate.ts` is the filename; `gate` is the name an app imports. Shorter at
  // the call site and it does not suggest it is only about authentication - it is
  // also the redirect policy and the API/page split.
  './gate': './src/auth-gate.ts',
};

const mismatched = [];
for (const [specifier, target] of entries) {
  if (typeof target !== 'string' || specifier === '.' || target.includes('*')) continue;
  const m = /^\.\/src\/(.+)\.(ts|tsx)$/.exec(target);
  if (!m) continue;

  if (BARREL_TARGETS.test(target)) continue;
  if (INTENTIONAL_ALIASES[specifier] === target) continue;

  const specifierName = specifier.replace(/^\./, '').replace(/^\//, '');
  if (specifierName !== m[1]) {
    mismatched.push({ specifier, target, targetName: m[1], targetExists: existsSync(join(pkgDir, target)) });
  }
}

check(
  'every export SPECIFIER names the file its TARGET points at, unless it is an intentional alias',
  mismatched.length === 0,
  {
    mismatched,
    intentionalAliases: Object.keys(INTENTIONAL_ALIASES),
    why: '`./collapse -> ./src/collapsible.tsx` resolves and then fails at import. ' +
      'Both halves are well-formed; they just disagree, and nothing else notices',
  }
);

// ---------------------------------------------------------------------------
// 4. Nothing imports a package's src/ by relative path
// ---------------------------------------------------------------------------
// `enterprise-theme` was imported by eight apps as
//
//     from '../../packages/ui/src/enterprise-theme'
//
// which bypasses the export map entirely - so nothing validated it, and moving the
// file would break eight build configs at once with no single place to look. It is
// exported now and the imports use the package name.
//
// The exception is a Tailwind `content` glob, which is a FILESYSTEM path rather
// than an import and genuinely cannot be a bare specifier.
const deepImports = [];
const appDirs = join(here, '..', 'apps');
for (const app of readdirSync(appDirs)) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        // node_modules and build output are not source.
        if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
        walk(p);
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
        const src = readFileSync(p, 'utf8');
        src.split('\n').forEach((line, i) => {
          if (/from\s+['"][^'"]*packages\/ui\/src\//.test(line)) {
            deepImports.push(`${relative(join(here, '..'), p)}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(join(appDirs, app));
}

check(
  'no app imports a package source file by relative path',
  deepImports.length === 0,
  {
    deepImports,
    why: 'a relative path into another package bypasses its export map, so nothing ' +
      'validates it and moving the file breaks every importer at once',
  }
);

// ---------------------------------------------------------------------------
// 4. Anything the gate needs is declared
// ---------------------------------------------------------------------------
check(
  '`jose` is a declared dependency - auth-gate verifies signatures with it',
  Boolean(pkg.dependencies?.jose),
  { jose: pkg.dependencies?.jose ?? null, why: 'apps/web imported it without declaring it; it resolved by hoisting and would break on a stricter resolver' }
);

check(
  'the shared gate is exported as `./gate`',
  pkg.exports?.['./gate'] === './src/auth-gate.ts',
  { actual: pkg.exports?.['./gate'] ?? null }
);

check('at least one wildcard subpath is declared', wildcards.length > 0, { wildcards });

console.log(`\n${pass}/${pass + fails.length} checks passed`);
console.log(fails.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails.length})`);
for (const f of fails) console.log(`  - ${f}`);
if (warns.length) console.log(`(${warns.length} warnings)`);
process.exit(fails.length ? 1 : 0);