# Database wipe — 2026-10-03 03:59:42

Full logical dump of all seven application databases, taken **before** a complete
wipe. This directory is what makes the wipe reversible.

## What was in the backup

| Database | Size | Catalog entries | Contents |
|---|---|---|---|
| `auth_service` | 149.6 KB | 276 | 8 users, 26 sessions, 26 refresh tokens, 31 security events, `superadmin_accounts`, RBAC, service registry |
| `analytics_service` | 68.0 KB | 151 | `ui_click_events` — the click ledger, 1,665+ rows and counting |
| `billing_service` | 29.7 KB | 95 | payouts, device revenue, invoices |
| `currency_service` | 7.2 KB | 33 | FX rates, conversions |
| `dashboard` | 9.6 KB | 40 | dashboard-service state |
| `webhook_receiver` | 8.3 KB | 31 | webhook delivery log |
| `wideo11` | 0.8 KB | 15 | shared app data |

Total: 0.3 MB across 7 custom-format dumps. **Each was verified with `pg_restore -l`
before the wipe** — a backup that has never been read is a rumour, not a backup.

Format is `pg_dump -Fc` (custom), which is compressed and lets `pg_restore` select
individual objects.

## How to restore

Full restore of one database — it must not currently exist:

```bash
docker cp infrastructure/backups/auth_service-20261003-035942.dump wideo11-postgres:/tmp/
docker exec wideo11-postgres pg_restore -U postgres -d auth_service /tmp/auth_service-20261003-035942.dump
```

Restore all seven:

```bash
STAMP=20261003-035942
for db in auth_service analytics_service billing_service currency_service \
          dashboard webhook_receiver wideo11; do
  docker cp "infrastructure/backups/${db}-${STAMP}.dump" wideo11-postgres:/tmp/
  docker exec wideo11-postgres pg_restore -U postgres -d "$db" "/tmp/${db}-${STAMP}.dump"
done
```

To restore into a *different* database name, create it first and pass `-d`:

```bash
docker exec wideo11-postgres createdb -U postgres auth_service_restored
docker exec wideo11-postgres pg_restore -U postgres -d auth_service_restored /tmp/auth_service-20261003-035942.dump
```

## What the wipe does NOT need restoring, and why

**The master root superadmin account.** `bootstrap.EnsureSuperadmin` runs on every
auth-service start (`cmd/auth-service/main.go:78`) and is called immediately after
`database.Migrate` (line 69). It looks the account up by email and, not finding one,
creates it with `SECURITY_SUPERADMIN_PASSWORD` from `.env`, then registers it in
`superadmin_accounts` at slot 0.

So `advchashampalup@gmail.com` reappears by itself with the same password. This is
also why deleting that one account by hand would not have worked: it comes back at
the next restart.

**The schema.** `database.Migrate` (auth) and `database.AutoMigrate` (analytics,
billing, currency) rebuild every table on boot.

## This is a development-environment backup

Single-node PostgreSQL, `pg_dump` to a local directory, no retention policy, no
off-site copy. It protects against "I deleted the wrong row" and nothing else. It
does not protect against losing the disk this directory sits on.

The backup **service** — scheduled, verified, off-site — is still not built. It is
tracked as R4 in `updatedtodo.md` and Phase D3 in `SYSTEM-PLAN.md`. An untested
backup is a rumour; a backup that lives next to what it protects is a rumour with
extra steps.
