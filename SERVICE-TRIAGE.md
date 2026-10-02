# Service triage — what actually exists vs. what the plan said to build

> Written 2026-10-01, during Phase 1.
> Data produced by `node tools/triage-services.mjs` (re-runnable).

## The headline

`services/` contains **38 directories**. Compose runs **9** of them.

The other **29 are complete, compiling Go services that have never run** —
**29,728 lines** between them.

**Not one of the 29 has any authentication.**

| | count |
|---|---|
| undeployed, compiling | 28 |
| undeployed, not compiling (`cdn-service`) | 1 |
| undeployed, with **zero** auth middleware | **29** |
| undeployed, with no HTTP surface at all | 6 |

## Why this is a security finding, not a tidiness one

`wallet-service` (1,484 lines, 20 routes), `withdrawal-service` (1,780 lines,
24 routes), `ledger-service`, `accounting-service`, `royalty-service` — deployed
as they stand, these are **unauthenticated money APIs**. Any container that can
reach them on the compose network can credit, debit and withdraw.

The pattern is uniform: `gin.Logger()`, `gin.Recovery()`, then straight to
`h.RegisterRoutes(r)`. There is no auth middleware anywhere in the pile.

**Therefore: nothing from this pile gets deployed until it has an auth gate.**
This is now Phase 1's first task, because Phase 1 adopts one of them.

## What the plan gets wrong because of this

`SYSTEM-PLAN.md` originally scoped three phases as "build". They are not:

| Phase | Plan said | Reality |
|---|---|---|
| 1 — telemetry | "build a telemetry service" | `analytics-service` exists (2,238 lines) **with a click log already** |
| 3 — upload engine | "build" | `upload-service` exists (701 lines, 6 routes) |
| 7 — ads manager | "build" | `ads-service` (1,478 lines, 19 routes) **and** `campaign-service` (1,240 lines, 20 routes) exist, with ads, placements, slots, campaigns and stats |
| 8 — payouts | "build" | `wallet-service`, `ledger-service`, `accounting-service`, `royalty-service`, `withdrawal-service` — ~6,600 lines exist |

Adopting them is not free. They compile, which is not the same as correct: they
have never been started, so their DB assumptions, migrations and error handling
are unverified. But writing a second ads manager beside an existing one would be
the worse outcome by a wide margin.

## Two things about `analytics-service` specifically

**1. It is the right home for the click ledger, but not the same data.**

Its existing `ClickLog` model is **ad and content engagement**:

```go
AdID *uint; CampaignID *uint; ContentID string; VideoID *uint
```

The UI ledger in `auth_service` is **interface interaction**:

```
page, target, label, surface, element_id, x, y, referrer
```

Same word "click", two different domains, different lifecycles and different
retention. They belong in one service as **two tables**, not merged into one.
Merging them would mean a UI click could carry an `AdID`, which is meaningless.

**2. Its route surface is larger than this project needs.** views, clicks,
conversions, reach, revenue, campaign analytics, plus an AI `content/categorize`
endpoint. Phase 1 adopts it for the click ledger and leaves the rest alone
rather than pretending the whole service is verified.

## Why they were never deployed — found while adopting one

I adopted `analytics-service` (phase 1). Two things in it had never run:

**1. A Dockerfile that could not start.**

```
ENTRYPOINT ["/analytics-service"]        <- absolute
COPY --from=builder ... ./               <- /app/analytics-service
```

`exec: "/analytics-service": stat ...: no such file or directory`. The binary
was copied into `/app` but the entrypoint pointed at the root. A Dockerfile that
has never been built hides this completely.

**2. Every service's environment variables were silently ignored.**

This is the one that matters, and it is present in **25 of the 28** services that
use viper:

```go
viper.AutomaticEnv()
```

Viper maps a config key to an env var by upper-casing it and replacing the
**separator** — but only if `SetEnvKeyReplacer` says what the separator is.
Without that line:

| key in code | env var it looks for | what compose sets |
|---|---|---|
| `security.internal_token` | `SECURITY.INTERNAL_TOKEN` | `SECURITY_INTERNAL_TOKEN` |

Nothing errors. Nothing warns. The process starts, and every value arrives as
its **zero value**.

Measured on `ads-service` before the fix, with `DATABASE_DBNAME` explicitly set:

```
DATABASE_DBNAME=ads_service_from_env   ->  config returns "ads_service"   (the YAML default)
DATABASE_HOST=postgres-from-env         ->  config returns "localhost"
SERVER_PORT=9111                        ->  config returns "8083"
```

**This is the single most likely reason none of them were deployed.** They could
not be configured into working. `analytics-service` had it too — and would have
started with **no authentication**, except that a fail-closed startup check
refused to run, which is the best possible outcome.

### Fixed

`viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))` added to 25 services by
`tools/fix-env-replacer.mjs`, which then proves **every patched service still
compiles**.

Compile is not behaviour, so the binding is asserted too:
`services/ads-service/src/config/config_env_test.go`. That test was validated by
removing the fix and watching all three assertions fail against the original
state — a regression test that has never been seen to fail is not evidence.

## Phase 1 landed: `analytics-service` is adopted and deployed

Live on `:8091`, owning the ledger as `analytics_service.ui_click_events`,
publishing a realtime firehose to NATS JetStream, and exposing metrics that
Prometheus scrapes. The auth-service table is dropped and its dead code removed.

### NATS: three failed config attempts, then a rethink

The stream was meant to be declared in `docker/nats/nats.conf`. Three spellings
each took the server down with `unknown field ...`:

| attempt | error |
|---|---|
| `monitor { port: 8222 }` | `unknown field "monitor"` — that block does not exist; it is `http: 8222` |
| `streams { }` at the top level | `unknown field "streams"` |
| `streams { }` inside `accounts { HUB { } }` | `unknown field "streams"` |

The config file was abandoned for the **stream** rather than guessing a fourth
time, because a NATS config that fails to parse takes the whole container down and
the whole point was to have a working firehose.

Two things survived and justify the file: `store_dir` on the mounted volume, and
explicit `max_memory_store` / `max_file_store` caps — this container shares a
volume with the host, so a JetStream that fills the disk takes Postgres with it.

**A correction to an assumption of mine.** The reason for wanting a
config-declared stream was "it should exist even when the publisher is down".
That was wrong: **JetStream persists stream definitions in its own `store_dir`**,
so an API-created stream survives restarts identically. The publisher bootstraps
it and nothing is lost.

**NATS auth is deliberately not set, and recorded rather than skipped.** An
`accounts {}` block was tried five ways, including the `$G` alias that is
supposed to preserve anonymous clients, and none parsed. A crash loop is worse
than a missing feature, so the block was removed and the follow-up written down —
including the three steps it needs, and the reason it matters (`nats-exporter`
connects without credentials and logs `authentication error - User ""` the moment
an accounts block exists).

---

## Decisions

| decision | reason |
|---|---|
| **Adopt `analytics-service`** for the UI click ledger | it is the analytics service, it already models clicks, and it already has views/conversions — the natural neighbour. Deploying it beats inventing a 30th service. |
| **Auth first, always** | no service ships without it. Adopted code that has never run is exactly the code that has never had its auth tested. |
| **Defer the other 28 to their own phases** | triaging 29,728 lines properly is its own piece of work, and doing it now means doing it badly. Each gets triaged when its phase arrives, with this table as the starting evidence. |
| **Delete nothing yet** | deletion is irreversible and the user may want several. Recommend, do not act. |
| **Adopt per phase, not wholesale** | one service adopted and verified beats nine adopted and none working. |

## Candidates that overlap the LIVE services — flag, do not delete

`user`, `user-service`, `profile`, `profile-service`, `settings`, `email`,
`auth` sit next to the deployed `auth-service`. If they duplicate it, that is
~3,000 lines of a second answer to "where does a user live", which is the same
one-owner-per-domain rule the rest of this document is built on. Worth a
decision, but not during Phase 1.

## The rule this produced

> No new service in this build without first writing one line saying which of
> the 29 existing ones could not do the job. The default answer is "reuse one of
> those".

Added to `SYSTEM-PLAN.md` as R11.