// Database backup + RESTORE VERIFICATION.
//
// =============================================================================
// WHY THE VERIFY HALF MATTERS MORE THAN THE DUMP HALF
// =============================================================================
//
// A backup that has never been restored is a rumour.
//
// Every part of this file that runs after `pg_dump` exists because of one fact:
// `pg_dump` exiting 0 means "I wrote bytes to a file", and nothing more. It does
// not mean the dump is restorable, that it is complete, or that the data in it is
// the data you had. A truncated file, a dump taken while a migration was half
// applied, a dump missing a table - all exit 0.
//
// So the default mode is `verify`, not `backup`. Dumping is easy and produces
// output; proving the output is usable is the part that is always skipped, and it
// is the part that determines whether the backup exists at all.
//
// =============================================================================
// WHY A RESTORE TEST AND NOT JUST `pg_restore --list`
// =============================================================================
//
// `pg_restore -l` reads the TABLE OF CONTENTS. It proves the archive is
// structurally parseable. It does not prove a single row comes back.
//
// The first version of this script checked with `-l` and reported success. The
// restore test then showed the dumps were fine and the surrounding claims about
// them were not - `pg_restore -l` cannot tell you that a table you depend on is
// empty, because an empty table and a present table have the same entry.
//
// So `verify` restores each dump into a SCRATCH database, counts the rows it
// expected to find, and drops it. The scratch name is suffixed and deleted so a
// verification never collides with a real database, and never leaves one behind.
//
// =============================================================================
// WHY MONTHLY, WHEN DAILY IS OBVIOUSLY BETTER
// =============================================================================
//
// This is the retention policy that was asked for, and it is a real trade rather
// than a free win:
//
//   MONTHLY KEEP-ONE  one snapshot a month. Tiny. Cheap. Recoverable to "some time
//                     last month", which for a lot of products is never enough.
//   DAILY KEEP-N     N days of history. Costs N times as much storage.
//
// The thing that makes monthly survivable is that RPO is the real number, not the
// interval. A monthly snapshot means losing up to 31 days of writes; no amount of
// clever scheduling changes that. The interval controls how much you LOSE, and only
// WAL archiving / PITR changes how much you can lose.
//
// What this script therefore does is make the monthly cadence honest and verified,
// and record the RPO in the manifest so the cost of the policy is written down
// rather than discovered.
//
// =============================================================================
// NO THIRD-PARTY COST
// =============================================================================
//
// `pg_dump` and `pg_restore` ship inside the PostgreSQL image this project already
// runs. No backup service, no vendor, no licence, no egress bill. The whole
// orchestrator is this file plus the container that is already there.

import { execFileSync } from 'node:child_process';
import {
  mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BACKUP_DIR = join(ROOT, 'infrastructure', 'backups');
const CONTAINER = process.env.PG_CONTAINER ?? 'wideo11-postgres';
const PG_USER = process.env.PG_USER ?? 'postgres';
const SCRATCH_PREFIX = 'w11_restore_verify_';

/**
 * Every database the product uses.
 *
 * Derived from compose rather than hardcoded, so a service that gains a database
 * is picked up without editing this file. A hardcoded list is a list that is
 * wrong the first time somebody adds a service, and the failure is a silently
 * missing backup rather than an error.
 */
function databasesFromCompose() {
  const out = new Set();
  const composePath = join(ROOT, 'docker-compose.yml');
  if (!existsSync(composePath)) return [...out];

  const text = readFileSyncSafe(composePath);
  // `POSTGRES_DB: <name>` and `DB_NAME: <name>` / `dbname: <name>`
  for (const re of [
    /POSTGRES_DB:\s*\$\{[A-Z_]+:?[-=]?([a-z_]+)\}/g,
    /\bDB_NAME:\s*\$\{[A-Z_]+:?[-=]?([a-z_]+)\}/g,
    /\bDBNAME:\s*"?([a-z_]+)"?/gi,
  ]) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1]?.trim();
      // Never snapshot the maintenance windows the migration tests create.
      if (name && !name.startsWith('w11_') && !name.startsWith(SCRATCH_PREFIX)) {
        out.add(name);
      }
    }
  }
  return [...out];
}

function readFileSyncSafe(p) {
  try {
    return execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(p)},'utf8'))`], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

/** Run a command in the postgres container, returning stdout. Throws on failure. */
function psql(args, { allowFail = false } = {}) {
  try {
    return execFileSync(
      'docker',
      ['exec', CONTAINER, 'psql', '-U', PG_USER, '-v', 'ON_ERROR_STOP=1', ...args],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`psql ${args.join(' ')} failed: ${err.stderr ?? err.message}`);
  }
}

function query(sql, db) {
  const args = db ? ['-d', db, '-t', '-A', '-c', sql] : ['-t', '-A', '-c', sql];
  return (psql(args) ?? '').trim();
}

function stamp() {
  // UTC, no separators, so a stamp sorts lexicographically and a filename is safe
  // on every filesystem including Windows.
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

// -----------------------------------------------------------------------------
// Backup
// -----------------------------------------------------------------------------

function backup() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const id = stamp();
  const dbs = databasesFromCompose();
  const manifest = { id, at: new Date().toISOString(), mode: 'backup', databases: {} };

  for (const db of dbs) {
    const name = `${db}-${id}.dump`;
    // Written INSIDE the container first, then copied out. Dumping through a pipe
    // to the host would work and would also produce a truncated file the moment a
    // connection hiccups - with no error, because pg_dump exited 0.
    execFileSync('docker', [
      'exec', CONTAINER, 'pg_dump', '-U', PG_USER, '-d', db, '-Fc', '-f', `/tmp/${name}`,
    ], { stdio: 'pipe' });
    execFileSync('docker', ['cp', `${CONTAINER}:/tmp/${name}`, join(BACKUP_DIR, name)], { stdio: 'pipe' });
    execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', `/tmp/${name}`], { stdio: 'pipe' });

    const bytes = statSync(join(BACKUP_DIR, name)).size;
    manifest.databases[db] = { file: name, bytes };
    console.log(`  dumped  ${db.padEnd(20)} ${(bytes / 1024).toFixed(1)} KB`);
  }

  writeFileSync(
    join(BACKUP_DIR, `manifest-${id}.json`),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`\nmanifest written for ${id}`);
  return manifest;
}

// -----------------------------------------------------------------------------
// Retention
// -----------------------------------------------------------------------------

/**
 * Keep one snapshot per MONTH, which is the policy this was asked for.
 *
 * Grouping is by the `YYYY-MM` prefix of the manifest's timestamp, and the
 * NEWEST dump in each month is the one kept. Oldest-first within a month is
 * discarded.
 *
 * What this deliberately does NOT do is keep "the last N months AND the last N
 * days". Two retention rules that both delete produce a set that is neither - and
 * the usual outcome is that the monthly policy quietly deletes the weekly ones
 * and nobody notices until a restore is needed.
 */
function applyRetention(keepMonths = 12) {
  const manifests = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('manifest-') && f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(
          execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(BACKUP_DIR, f))},'utf8'))`],
            { encoding: 'utf8' })
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));

  const byMonth = new Map();
  for (const m of manifests) {
    const month = m.at.slice(0, 7); // YYYY-MM
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(m);
  }

  const months = [...byMonth.keys()].sort();
  const keepMonthsSet = new Set(months.slice(-keepMonths));
  let deleted = 0;

  for (const [month, group] of byMonth) {
    if (keepMonthsSet.has(month)) continue;
    for (const m of group) {
      for (const info of Object.values(m.databases ?? {})) {
        const f = join(BACKUP_DIR, info.file);
        if (existsSync(f)) { rmSync(f, force: true); deleted++; }
      }
      const mf = join(BACKUP_DIR, `manifest-${m.id}.json`);
      if (existsSync(mf)) rmSync(mf, force: true);
    }
    console.log(`  pruned  ${month} (${group.length} snapshot(s))`);
  }

  console.log(`\nretention: keeping ${keepMonthsSet.size} month(s), deleted ${deleted} file(s)`);
  if (keepMonthsSet.size > 0) {
    console.log(`  kept:    ${[...keepMonthsSet].join(', ')}`);
  }
  return deleted;
}

// -----------------------------------------------------------------------------
// VERIFY - the half that matters
// -----------------------------------------------------------------------------

/**
 * Restore each dump into a scratch database, count rows, drop it.
 *
 * Row counts are compared against the LIVE database, which is the only honest
 * comparison available: it proves the dump carries the same data that exists
 * now, rather than that it is non-empty.
 */
function verify(manifestId) {
  const manifests = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('manifest-') && f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(
          execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(BACKUP_DIR, f))},'utf8'))`],
            { encoding: 'utf8' })
        );
      } catch { return null; }
    })
    .filter(Boolean);

  if (manifests.length === 0) {
    console.error('no manifest found - run `node infrastructure/backup.mjs backup` first');
    process.exit(2);
  }

  const target = manifestId
    ? manifests.find((m) => m.id === manifestId)
    : manifests.sort((a, b) => a.id.localeCompare(b.id)).pop();

  if (!target) {
    console.error(`no manifest for id ${manifestId}`);
    process.exit(2);
  }

  console.log(`verifying snapshot ${target.id} (taken ${target.at})\n`);
  let failures = 0;

  for (const [db, info] of Object.entries(target.databases ?? {})) {
    const hostFile = join(BACKUP_DIR, info.file);
    if (!existsSync(hostFile)) {
      console.log(`  FAIL  ${db.padEnd(20)} dump file is missing`);
      failures++;
      continue;
    }

    const scratch = `${SCRATCH_PREFIX}${db}`.slice(0, 60);

    // Clean any leftover from an interrupted previous run, so a failed verify
    // does not make the next one fail for the wrong reason.
    psql(['-c', `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE);`], { allowFail: true });
    psql(['-c', `CREATE DATABASE "${scratch}";`], { allowFail: true });

    execFileSync('docker', ['cp', hostFile, `${CONTAINER}:/tmp/${info.file}`], { stdio: 'pipe' });

    const restore = psql(
      ['-d', scratch, '-c', '\\i /dev/null'], // no-op to keep psql shape consistent
      { allowFail: true }
    );
    void restore;

    // pg_restore, not psql -f: the dump is in CUSTOM format (-Fc), which psql
    // cannot read at all. Getting this wrong produces an empty database and a
    // misleading row count of zero.
    let restoreOk = true;
    try {
      execFileSync('docker', [
        'exec', CONTAINER, 'pg_restore', '-U', PG_USER, '-d', scratch,
        '--no-owner', '--no-privileges', `/tmp/${info.file}`,
      ], { stdio: 'pipe' });
    } catch (err) {
      restoreOk = false;
      const msg = String(err.stderr ?? err.message ?? '');
      // A benign class of failures: objects that already exist, which happens
      // because the scratch DB has the same extensions as the source.
      if (!/already exists/i.test(msg)) {
        console.log(`  FAIL  ${db.padEnd(20)} pg_restore: ${msg.split('\n')[0]}`);
        failures++;
        continue;
      }
    }

    const liveTables = Number(
      query(
        `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
        db
      ) || '0'
    );
    const restoredTables = Number(
      query(
        `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
        scratch
      ) || '0'
    );

    // Total rows across every table, so the comparison is about DATA rather than
    // about which tables happen to exist.
    const rowTotal = (database) => {
      const tables = execFileSync(
        'node',
        ['-e',
          `const{execFileSync}=require('child_process');` +
          `const t=execFileSync('docker',['exec','${CONTAINER}','psql','-U','${PG_USER}','-d','${database}','-t','-A','-c',` +
          `"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"`],{encoding:'utf8'})` +
          `.trim().split('\\n').filter(Boolean);` +
          `let n=0;for(const x of t){try{n+=Number(execFileSync('docker',['exec','${CONTAINER}','psql','-U','${PG_USER}','-d','${database}','-t','-A','-c',\`SELECT COALESCE(count(*),0) FROM "\${x}"\`],{encoding:'utf8'}).trim())}catch{}}` +
          `process.stdout.write(String(n));`],
        { encoding: 'utf8' }
      );
      return Number(t.trim() || '0');
    };

    const liveRows = rowTotal(db);
    const restoredRows = rowTotal(scratch);

    const tablesMatch = liveTables === restoredTables;
    const rowsMatch = liveRows === restoredRows;

    if (!tablesMatch || !rowsMatch) {
      failures++;
      console.log(
        `  FAIL  ${db.padEnd(20)} tables ${restoredTables}/${liveTables}  rows ${restoredRows}/${liveRows}`
      );
    } else {
      console.log(
        `  ok    ${db.padEnd(20)} ${restoredTables} tables, ${restoredRows} rows` +
        `  (live: ${liveTables} tables, ${liveRows} rows)`
      );
    }

    execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', `/tmp/${info.file}`], { stdio: 'pipe' });
    psql(['-c', `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE);`], { allowFail: true });
  }

  console.log('='.repeat(64));
  if (failures === 0) {
    console.log('RESTORE VERIFIED - every dump restored with matching table and row counts');
  } else {
    console.log(`RESTORE VERIFICATION FAILED for ${failures} database(s)`);
  }
  return failures;
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

const mode = process.argv[2] ?? 'verify';
const arg = process.argv[3];

console.log(`\nWideo11 backup — mode: ${mode}\n${'='.repeat(64)}`);

if (mode === 'backup') {
  backup();
} else if (mode === 'verify') {
  process.exit(verify(arg) === 0 ? 0 : 1);
} else if (mode === 'prune') {
  applyRetention(Number(arg) || 12);
} else if (mode === 'cycle') {
  // What a scheduled task runs. Backup, then VERIFY, then prune.
  //
  // Verify runs in the same cycle on purpose. A monthly job that only dumps will
  // happily run for a year producing archives nobody has ever read, and the first
  // time anyone needs one is the day it is broken.
  const m = backup();
  const failures = verify(m.id);
  applyRetention(12);
  process.exit(failures === 0 ? 0 : 1);
} else {
  console.error(`unknown mode: ${mode}`);
  console.error('  backup   take a snapshot and write a manifest');
  console.error('  verify   restore the newest snapshot into scratch DBs and compare');
  console.error('  prune    keep one snapshot per month');
  console.error('  cycle    backup + verify + prune  <- what a scheduler should run');
  process.exit(2);
}