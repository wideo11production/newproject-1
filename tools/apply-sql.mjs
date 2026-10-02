import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = process.argv[2];
if (!file) {
  console.error('usage: node apply-sql.mjs <migration.sql> [db]');
  process.exit(2);
}

const db = process.argv[3] ?? 'auth_service';
const sql = fs.readFileSync(file, 'utf8');

// Piped on stdin rather than copied into the container, so the file does not
// need to exist inside the image.
const out = execFileSync(
  'docker',
  ['exec', '-i', 'wideo11-postgres', 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-f', '-'],
  { input: sql, encoding: 'utf8' }
);
console.log(out.trim() || '(applied, no output)');