// Package migrations carries the SQL migration files as compiled-in assets.
//
// # WHY THIS FILE EXISTS
//
// The SQL chain in this directory used to be applied by hand, with
// `psql -f`, on whatever shape GORM's AutoMigrate happened to have left
// behind. That has three failure modes, all of which have actually happened in
// this repo:
//
//  1. A from-scratch deploy has no chain at all. AutoMigrate creates the GORM
//     models; migrations 001-020 are simply absent, so `channels`,
//     `user_settings`, `media_assets`, `user_services`, `privilege_registry`
//     and everything else a handler touches is missing at runtime. The service
//     starts healthy and 500s on first real use.
//  2. Files are applied out of order, or twice, or skipped, and nothing
//     records that. `tools/apply-sql.mjs` is a convenience, not a ledger.
//  3. The two mechanisms disagree. A file that assumes a column GORM has not
//     created fails halfway, leaving a transaction aborted and a half-applied
//     schema behind it.
//
// Embedding the files makes the chain part of the binary: the same artifact
// that serves traffic is the artifact that knows its schema, so "which
// migrations have run" stops being a question about a person's shell history.
//
// The runner that consumes this is `internal/database.RunMigrations`.
package migrations

import "embed"

// FS holds every .sql file in this directory.
//
// The `*.sql` pattern rather than `.` on purpose: embedding the whole directory
// would also embed this Go file's own package documentation as a non-SQL asset,
// and a migration runner that tries to execute a .go file produces a very
// confusing error.
//
//go:embed *.sql
var FS embed.FS

// Dir is the path inside FS that the files live at. Kept as a constant so the
// runner and the tests cannot disagree about it.
const Dir = "."