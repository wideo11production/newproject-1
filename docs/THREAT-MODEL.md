# Threat model — Wideo11

**What an attacker can do to this system, smallest to largest, and what stops each one.**

This is written for the person who has to decide what to fix first, so it is
ordered by damage, not by category. Every entry has the same four parts:

- **The trap.** What the attack actually is, in plain terms.
- **Why it worked here.** The specific thing in *this* codebase that made it possible.
- **What it costs you.** The real-world consequence, not the theoretical one.
- **The defence.** What is in place now, and what is left to do.

---

## The one-paragraph version

Everything in this document comes from five mistakes, and they are the same five
mistakes over and over:

1. **A value that is committed to the repository is a published value.** A JWT
   signing key, a bcrypt hash, a fallback secret. All three were here. All three
   meant "there is no authentication" rather than "authentication is weak".
2. **A route prefix is an open grant to every route that exists later.** `'/api'`
   on the monitor app meant whatever the next developer added was public too, and
   nobody would ever have written that decision down.
3. **A comment explaining a security property is not the property.** We wrote a
   test asserting the passkey login issued a session. It passed — because a
   *comment* in the function mentioned the function it should have called. We
   found this by deliberately breaking the code and re-running the test.
4. **An error that renders as "no data" is more dangerous than a crash.** The click
   ledger panel showed an empty table while the table was full, because it read
   `d.events` where the service returns `d.clicks`.
5. **A public write endpoint with no limit is a free service.** `/api/audit` is
   deliberately unauthenticated so signed-out visitors can be tracked. With no rate
   limit that is a data-generation service for anyone who finds the port.

Read the rest as detail on those five.

---

## Tier 0 — "I already own everything"

These require no exploit at all. They are the reason to read the top of this list
first.

### 0.1 — The JWT signing key was published in this repository

**The trap.** `JWT_SECRET_KEY` had a default of `your-secret-key-change-in-production`
in `internal/config/config.go` and `dev-only-insecure-secret-change-me` in
`docker-compose.yml`. Both strings are in the git history.

**Why it worked here.** If the env var is unset, viper yields the default, the
service starts, signs tokens with it, logs no warning, passes every health check,
and passes every test. Then:

```
payload = {"user_id": "<any uuid>", "role": "superadmin",
           "aud": "wideo11-api", "exp": <future>}
token   = b64url(header) + "." + b64url(payload) + "." + HMAC_SHA256(payload, default)
```

Every app's gate uses `jose` against the same key. The signature verifies, the
audience matches, the expiry has not passed. The request is served as a superadmin.
There is no race to win and no bug to find — the key *is* the authentication
system, and it was printed in the source.

**What it costs you.** Every account, every click, every rupee of revenue data. And
it is undetectable from the logs, because from the server's point of view it is a
perfectly valid session.

**The defence.** Done, in three independent places so one removal is not enough:

- `config.go` registers the key with an **empty** default. `Validate()` refuses to
  return a config with no key, a published key, or one under 32 characters, and
  `main` fatals before binding a port.
- `docker-compose.yml` uses `${JWT_SECRET_KEY:?...}`, so `docker compose up` refuses
  to create a container at all.
- `KnownWeakJWTSecrets` lists both historical values by name, so somebody copying an
  old `.env.example` is caught too.

**Still to do.** Rotate the key. The old values are in git history forever; the
list stops *new* deployments from using them, not an attacker who already has them.
Rotating invalidates existing sessions, which is the point — do it in a maintenance
window and say so.

### 0.2 — The master root password hash was committed to the repository

**The trap.** `DefaultSuperadminPasswordHash` was a literal
`$2a$12$dxQxGmx/hnsusyk6jliqLO0xEX9grzBnNdPNn23X6O/Ay36WCDQJ2` in
`internal/bootstrap/superadmin.go`. The old comment said "ye plaintext nahi hai,
sirf hash hai" — true, and not the point.

**Why it worked here.** The protected account is the one that can grant itself
anything. bcrypt cost 12 makes each guess expensive; it does not make guessing
impossible, and it does nothing at all to somebody with the repository and unlimited
time — which is exactly what a published repository is.

**What it costs you.** Superadmin. That is the whole account.

**The defence.** Done. There is no built-in default any more:

- `SECURITY_SUPERADMIN_PASSWORD` is **required** outside development. Not a warning
  — `LoadConfig` returns an error and the service does not start.
- In development, a random 32-byte password is generated **per boot** and printed
  once. Nobody knew it in advance, it is not stored anywhere, and it changes on
  every restart, so "the default password" stops being a thing that exists.
- The rotation guard that used to compare against the removed constant was rewritten.
  Left as-is it would have compared `storedHash == ""`, matched nothing, and made
  `SECURITY_SUPERADMIN_PASSWORD` a no-op on existing accounts — which is the exact
  bug that guard was written to fix, reappearing in a new shape. The rule is now
  simply "the env var is the password", and it logs loudly when it overwrites a
  different hash.

**Still to do.** Set `SECURITY_SUPERADMIN_PASSWORD` in production. Rotate the
current one.

---

## Tier 1 — "One bad decision away from account takeover"

### 1.1 — A JWT in a text box on the most powerful dashboard

**The trap.** `apps/superadmin` rendered `<input type="password" placeholder="eyJhbGciOi...">`
and asked for a bearer token to paste, while `middleware.ts` in the same directory
*also* required a real session. The app demanded two credentials at once and the
token half undid the cookie half.

**Why it worked here.** The middleware's own comment said so: "This file makes the
pages require a real session. It does NOT remove the 'paste a bearer token' UI."
Three ways that hurt:

1. Using the dashboard required copying a JWT out of a `curl` response — so handling
   a bearer credential in a text box was the *normal* path, in screen shares and
   screenshots and support tickets.
2. The token lived in React state and was attached manually to every request. Any
   script on the page could read it. `httpOnly` exists precisely to make a session
   unreadable from JavaScript, and this opted out deliberately.
3. **"Sign out" was `setToken('')`** — a React state change. No server call, no
   revocation. A button labelled "Sign out" that does not sign out is worse than no
   button, because it is a claim the product makes and does not honour.

**What it costs you.** Full superadmin access from any script on the page, and
sessions that survive a sign-out.

**The defence.** Done. The token field, the `Authorization` header construction and
the fake sign-out are all gone. The dashboard now:

- reads the same `httpOnly` `wideo11_session` cookie the middleware validates;
- asks `/api/session` whether it is signed in — which **verifies** the signature via
  auth-service and reads the role from the *profile*, not from the token's own
  claim. An unverified base64 decode reads whatever the bytes claim, so anyone
  pasting any string into a cookie jar would be a superadmin;
- has a real `POST /api/logout` that revokes server-side and clears the cookie with
  matching attributes;
- clears what is on screen the moment you sign out, rather than leaving the previous
  user's rows up until revocation completes.

### 1.2 — Tokens in `localStorage`

**The trap.** `packages/auth` persisted the **access token and the refresh token**
to `localStorage` under `w11-auth`. One XSS, one malicious extension, one compromised
CDN script, and an attacker has a complete live session — including the refresh
token, so it does not expire.

**Why it worked here.** `apps/analytics` imported `useAccessToken` from it. That was
the *only* app in the repository doing this; every other app reads the cookie
server-side. One app out of eight is enough.

**What it costs you.** Account takeover, no persistence required.

**The defence.** Done. `apps/analytics/app/api/analytics/route.ts` now reads the
httpOnly cookie with `cookies()` and builds the `Authorization` header server-side,
so the token never enters JavaScript. `packages/auth` is **deleted**, and the
references are removed from `tsconfig.json`, the ArgoCD application set and
`docs/README.md` — with a note in each explaining why it must not come back.

### 1.3 — Revoked sessions kept working on four route groups

**The trap.** "Revoke this session" did not revoke it.

**Why it worked here.** Two different claims get confused:

| Check | What it proves |
|---|---|
| `AuthMiddleware` | the JWT's signature is valid and `exp` has not passed |
| `CheckRevoked` | this session id is not on the Redis denylist |

A token revoked at logout still has a **valid signature** and a **future `exp`**. It
passes `AuthMiddleware` completely. Only the denylist rejects it — and `CheckRevoked`
was attached to one group out of five.

What stayed open:

| Group | What it exposes |
|---|---|
| `/admin/*` | every user's security events, session history, device lock, account purging |
| `/security/*` | PIN, security questions, biometric enrolment |
| `/webauthn/*` | enrol a new passkey, list credentials |
| awareness | per-user activity across the system |

`/admin/*` is the worst: **revoking a superadmin session is the documented
incident-response action, and on that group it did nothing.**

**What it costs you.** Every logged-out device stayed fully authenticated until its
access token expired on its own. On `/security/*`, that meant a logged-out session
could reconfigure the PIN and security questions — the credentials account recovery
depends on.

**The defence.** Done. `CheckRevoked` on all four groups, applied unconditionally
because `CheckRevoked(nil)` already passes through (`revocation.go:145`), so the
conditional version only made the guard read as optional.

`cmd/auth-service/revocation_coverage_test.go` pins it per group and **fails if a
guard is removed**. It was verified by removing the guards and confirming the tests
go red. It also asserts the *negative* case — public groups must **not** check
revocation, because a request that has not authenticated has no session id to look
up and the guard would reject every login.

### 1.4 — The passkey login was a dead end

**The trap.** WebAuthn — the strongest authentication this product supports, and
phishing-resistant — verified a real signature and then returned
`{"verified": true}` with no token, no session, no cookie. There was no possible
next step. **A password was the only way to get in.**

**Why it worked here.** `POST /login/finish` returned 200. The tests passed. The
function's comment said the flow was "more secure than a password". A grep for
"verified" finds it on the success path. This is the same shape as the resize test
that was asserting its own bug: every signal said it worked.

**What it costs you.** Not a direct exploit — a *weakened* system. The strongest
factor was decorative, so the only usable one was a password.

**The defence.** Done.

- `AuthService.LoginWithWebAuthn` issues a real session. It shares
  `issueSession()` with the password path rather than reimplementing it, because two
  copies of session creation is how one path ends up with revocation and the other
  without.
- It re-checks `IsActive` and `IsVerified` at **issuance** time. A passkey enrolled
  before an account was deactivated must not mint a session now.
- It applies the same mandatory PIN/questions/biometric gate, so a passkey cannot be
  used to skip it.
- `cmd/auth-service/passkey_login_test.go` pins it. **Comments are stripped before
  the assertions** — the first version passed with the call deleted, because a
  comment in the function mentioned `LoginWithWebAuthn`. That is lesson 3 from the
  summary, caught by deliberately breaking the code.

**Note on what this is not.** This issues a session on a passkey *alone*. True 2FA
(password **and** passkey) is stronger against a stolen passkey and is the right
design for most products. It is not right here, because this product *already*
requires a passkey for everyone whose device has a platform authenticator, so
requiring a second factor would lock those users out rather than protect them. True
2FA belongs in the step-up work in `SYSTEM-PLAN.md` phase 0.

---

## Tier 2 — "I can read your data, or make you lie about your data"

### 2.1 — `/api/health-check` published your internal network map

**The trap.** An unauthenticated route on both `apps/web` and `apps/admin` answered
with a server-side fan-out over internal services. Unauthenticated, it returned:

- internal service **names** — "Recommendation Service", "Bot Service"
- their internal **URLs** — twice, once as configured and again inside
  `error.message` when the fetch failed
- the **port map** of the whole box (8082, 8080), paired with those names
- and a free up/down oracle for services the caller has no right to know about

**Why it worked here.** It was listed in `publicApiPrefixes` on the belief that it
"returns liveness only" — which was false, and was the exact claim the old comment
made. It survived review because it is named `health-check`, and a thing called a
health check is assumed harmless by definition. **The name is what it does, not what
it discloses.**

Two of the services it checked (`Recommendation Service`, `Bot Service`) do not exist
in this compose file at all, so it was permanently reporting `DEGRADED`.

**What it costs you.** A working scan list for anyone who can reach the port, and the
internal DNS map of a system that is otherwise opaque.

**The defence.** Done. `@wideo11/ui/health-handler` is one shared implementation
(the two copies were byte-identical, and copy-paste across a monorepo guarantees
drift). It has a closed, server-side list of service names; a closed set of error
**codes** instead of raw `error.message`; `redirect: 'manual'` so it cannot be turned
into an open proxy; and it is session-gated in both apps. `/api/live` stays public and
returns `{"status":"ok"}` — nothing that can change.

It also always returns **200**, even when degraded. A health check that answers 503
when a dependency is down is a liveness check wearing readiness clothes: any
orchestrator that restarts on non-200 restarts the app forever over someone else's
outage, and restarting does not fix a database that is down.

### 2.2 — Five Docker healthchecks probed a gated path

**The trap.** `superadmin`, `billing`, `analytics`, `currency` and `admin` had
`HEALTHCHECK ... http://127.0.0.1:PORT/`. On all five, `/` is gated behind a session.
A container with no session answers 401, the probe reads that as unhealthy, and
Docker restarts a healthy process — then the probe fails again, forever.

**Why it worked here.** It was already recorded in `updatedtodo.md`: six healthy
containers in a restart loop while serving traffic correctly. The fix had been
applied in `docker-compose.yml` and never in the Dockerfiles, so the two copies of
the same decision disagreed.

**What it costs you.** Not a breach. An outage that looks like a product failure and
sends you looking for one. On a machine under memory pressure, repeated restarts of
six Next.js apps are also a genuine way to run the box out of memory.

**The defence.** Done. All five probe `/api/live`. `monitor` and `web` keep `/`,
which is genuinely public on those two — the correct outcome, not an oversight.

**The general rule this illustrates:** a liveness probe answers exactly one question —
*can this process still respond?* — and must not consult anything that can change
for an unrelated reason.

### 2.3 — The click ledger could be forged, and nothing could tell

**The trap.** `POST /api/audit` is deliberately **public**, so signed-out visitors
get tracked. That is correct and necessary. But identity came from
`jwtPayload()` — an **unverified** base64 decode — and was forwarded as
`X-Internal-User-Email`. Anyone could POST a hand-made cookie and have a click
recorded against a victim.

**Why it worked here.** The old `jwt-payload.ts` was careful: its own header said the
decode is "a label, not a permission decision" and must never be used to authorise.
It was correct about authorisation and wrong about **attribution** — "who clicked" is
the one field in that table a person might be harmed by.

On top of that, the route had **no rate limit**, so `POST /api/audit` unlimited was a
free data-generation service: flood `ui_click_events`, fill the disk, and drown the
real signal until "how many users pressed export" stops being answerable.

**What it costs you.** Analytics you cannot rely on, and a cheap denial-of-service.

**The defence.** Done. The rule is now: **the browser may say what it clicked and
where on screen. It may not say who it is, which app it is, or when.**

| Field | Was | Now |
|---|---|---|
| `identity` | unverified decode of a client cookie | `jose` signature check against the real key |
| `surface` | whatever the client sent | the server's own `SERVER_SURFACE` build value |
| `timestamp` | whatever the client sent | the server's clock, at arrival |

Every row now records **how** it was attributed, in a new `attribution` column:

- `verified` — signature checked. Trust it.
- `anonymous` — no cookie. A signed-out visitor. Normal, and on a landing site the
  majority. **Not evidence of anything.**
- `forged` — a cookie *was* presented and it failed verification. The cookie is
  `httpOnly`, so JavaScript cannot rewrite it; the only way to send a bad one is to
  build the request by hand.

`forged` is what makes click fraud *visible*. `WHERE attribution = 'forged'`
isolates every attempt, and counting only `verified` rows gives a number that means
something. Also added: fixed-window rate limiting (120 req/min, 3000 rows/min per
IP, 200-row batch cap), control-character stripping, field length caps, and no
`error.message` in any response.

**The cost, stated honestly.** The `surge` payload a client can forge is now smaller:
it cannot choose its own surface or timestamp. Anyone can still *send* events, because
that has to be possible for anonymous tracking. `attribution` is how you tell the
difference, and the superadmin dashboard has a `FORGED` filter for it.

### 2.4 — The click dashboard showed nothing, forever

**The trap.** The Click History panel never rendered. It read `d.events` where the
service returns `d.clicks`, and `c.timestamp` where the service emits `occurred_at`.
The array was always empty, so the Empty state was all anyone ever saw.

**Why it worked here.** It is the most expensive class of bug in this codebase and it
appears four times in its own history: a thing that should show data shows nothing,
and **nothing looks exactly like "there is no data"**. Every non-auth fetch was also
`.ok`-guarded and silently dropped, so a 500 and an empty table rendered identically.

The same bug, twice more: `apps/analytics` read the *pre-migration*
`auth_service.click_events` table while the superadmin dashboard read the real
`analytics_service.ui_click_events` — two dashboards, same name, different tables. And
`/ui-clicks/targets` had been implemented, registered, bounded and aggregated in
`analytics-service` since the move, with **zero callers**.

**What it costs you.** You cannot tell whether your users are clicking. On a product
whose dashboard exists to answer that, a permanently-empty table is worse than a
crash.

**The defence.** Done, and structurally so it cannot recur quietly:

- Field names match the Go model, and `tools/check-click-ledger.mjs` asserts them
  against the service rather than trusting them to be right.
- Per-panel error state, so a failed panel renders `PanelError` — which says in the
  UI that a failure is **not** the same as there being no data. A dashboard whose
  purpose is "did anything happen" must never show a failure as a quiet day.
- `apps/analytics` reads the service that owns the ledger, via `clicks` not `events`,
  and reports `clickSource` so the UI can name where the numbers came from.
- The unused `/ui-clicks/targets` endpoint has its missing caller: a **Most-pressed
  controls** panel.
- `/api/ledger` no longer fetches twice in one `Promise.all`.

### 2.5 — Clicks were written twice, and the wrong app's name was on them

**The trap.** Every click on `/auth/login`, `/auth/register` and
`/auth/security-setup` was recorded **twice**. And the local tracker omitted
`surface` and `element_id` — both non-optional in `ClickEventInput` — so the duplicate
rows landed with a null surface.

**Why it worked here.** `GlobalActivityTracker` is mounted in `app/layout.tsx`, and
`useClickTracking` attached a **third** capture-phase listener in those three pages.
Both fired, both filled the queue, both POSTed. The ledger looked *healthier* because
of it: more rows, a lively dashboard, no failing test. Only `COUNT(*)` was wrong — and
`COUNT(*)` is the number product decisions get made on.

The second half is the one that matters long-term. The copies disagreed, and the copy
people trusted was the broken one. That is why the shared handler now takes `surface`
from the server: a value the client cannot choose cannot be a value that drifts.

**The defence.** Done. The three `useClickTracking` call sites are gone; one mount
point (the layout) is the only one. And `@wideo11/ui/audit-handler` ignores the
client's `surface` entirely in favour of `SERVER_SURFACE`, set per app in compose, so
a caller cannot relabel editor traffic as admin traffic in the breakdown.

### 2.6 — PII was never deleted, not even on account deletion

**The trap.** `SYSTEM-PLAN.md` §3.3 specifies 30-day retention. Nothing implemented
it for auth-side data. Six tables accumulate PII forever:

```
sessions          ip_address, user_agent
refresh_tokens    user_id, expires_at
user_sessions     ip_address, user_agent, duration_seconds
security_events   email, ip_address, user_agent, detail
webauthn_sessions challenge bytes
verification_tokens
```

`SessionRepository.DeleteExpired` and `RefreshTokenRepository.DeleteExpired` were
written, with correct SQL, and had **zero call sites**. Nobody noticed, because a line
that never executes and a line that executes correctly look the same.

**Why it matters more than disk space.** Two consequences:

1. Anyone who takes a DB backup has every user's historical IPs and exact
   user-agents — "who logged in when, from which machine", permanently. That widens a
   breach notification and defeats a data-subject erasure request.
2. Deleting an account left these rows behind. Migration 012 fixed the FK rules so
   `DELETE FROM users` would succeed — but with no sweeper, an erasure could produce
   "the user row is gone, their IP history is not".

**The defence.** Done. `internal/purge/retention.go`, running hourly plus **once
synchronously at startup** so a fresh deployment does not carry a backlog for its
first hour.

Design rules, each with a reason:

1. **Hard delete** (`Unscoped()`). GORM's default `Delete` is a soft delete — it
   becomes `UPDATE deleted_at = now()`. The row vanishes from every query, the log
   says "deleted 4000", and the IP address is still on disk. A privacy claim and a
   storage claim that are both false.
2. **Batched**, with a yield between batches, so a large backlog does not hold row
   locks and monopolise the connection pool.
3. **Fail-soft per table.** One stuck table must not silently disable the other five —
   which is what "stop the whole sweep on first error" would do.
4. **`security_events` has its own, longer window** (400 days) keyed on `timestamp`,
   not expiry. It is an audit trail, not a credential. Shorter, and you cannot answer
   "was this account being brute-forced before they complained".
5. **Counts are logged, including zero.** "Deleted 0" is a useful line: it proves the
   worker is running. Silence is indistinguishable from "nothing to do".

Six tests run against a **real PostgreSQL**, because the failure mode here is
invisible to a mock: they count with raw SQL, so a soft-delete regression fails them,
and they assert expired rows go **and** live rows stay, so a "delete everything"
sweeper cannot pass.

**Writing those tests found three real bugs in my own code**, which is the argument
for writing them at all:

- the `user_sessions` condition had **two** `?` placeholders and **one** bind
  argument, so that table was never swept while the other five reported success;
- `Total()` summed a `-1` "unknown" sentinel, producing a negative total in the log;
- `RunOnce` checked the disabled flag only in `Start`, so `main`'s startup sweep ran
  even with retention switched off — a kill switch that misses one path.

---

## Tier 3 — "You have made a mistake and you cannot see it"

Not exploits. These are the ones that waste your time, because the system reports
success while lying.

### 3.1 — A test that a comment satisfied

**The trap.** `TestFinishAuthenticationIssuesASession` asserted that the passkey login
function called `LoginWithWebAuthn`. It passed — with the call **deleted** — because
the line above the deleted call read `// LoginWithWebAuthn re-checks IsActive and
IsVerified.`

We only found this by deliberately breaking the code and re-running the test. That
check is now part of how every source-assertion test in this repo is written:
**strip comments before asserting.**

This is the fifth recorded instance in this repository of the same mistake. The
others: `ticket.upload_url` (a comment-level drift between two copies);
`ALTER COLUMN ... TYPE` (a comment saying "TYPE added", statement had none); a
`# security_profile` comment justifying an omitted `COMMENT ON`; `prometheusUrl` (a
comment explaining why it must not be sent, directly above the statement sending it).

**The rule.** A comment explaining a security property is not the property. The only
evidence is a check that fails when the property stops holding.

### 3.2 — `NEXT_PUBLIC_*` set at runtime is set nowhere

**The trap.** `NEXT_PUBLIC_*` is inlined by `next build`. Compose's `environment:`
block sets variables at **runtime** — long after the bundle exists. Every
`NEXT_PUBLIC_` var set there is `undefined` in the browser.

**Why it worked here.** Every read site has a hardcoded `??` fallback, and the
fallback is usually *correct in local dev*. So the bug is invisible until deployment:

| Var | Read by | Symptom |
|---|---|---|
| `NEXT_PUBLIC_LOGIN_URL` / `_REGISTER_` / `_DASHBOARD_` | editor's `auth-nav.tsx`, `access-gate.tsx` | sign-in buttons pointed at web's port regardless of configuration |
| `NEXT_PUBLIC_APP_URL` (monitor) | `layout.tsx` → `packages/config` | monitor built absolute links to **web's** origin — wrong app, everywhere |
| `NEXT_PUBLIC_AUTH_INTERNAL_URL` | nothing | a `NEXT_PUBLIC_` var holding a compose-internal hostname, which a browser cannot resolve |

Four apps also set `NEXT_PUBLIC_API_URL: http://dashboard-service:8080` — a
Docker-internal name the browser cannot resolve — and the only reader in the repo is
`packages/api-client`, which no app imports.

**The defence.** Partly done. The three editor URLs are now `args:`; monitor's
`NEXT_PUBLIC_APP_URL` is an `ARG`; the unread `NEXT_PUBLIC_AUTH_INTERNAL_URL` is
deleted rather than left as a trap.

**Still to do — this is worth a lint rule.** Add a check that fails when a
`NEXT_PUBLIC_*` var appears in a compose `environment:` block. It is a two-line grep
and it is the same class of bug as the "comment explains the property" family: the
configuration says one thing and the code does another. `tools/check-app-gates.mjs`
already exists for the middleware equivalent.

### 3.3 — Markers were never saved, and the help text agreed with the bug

**The trap.** Adding or deleting a timeline marker did not persist. A refresh lost it.

**Why it worked here.** Not the bug you would guess. Markers have **always** been part
of the project document — `ProjectDoc.markers`, included in `docSnapshot()`, written
by `project-store.ts`. What was missing was `setDirty(true)` on the marker mutations.
Autosave is gated entirely on `dirty` (a 30s interval and an 8s debounce, both
returning early if `!dirty`), so the effect's dependency list already contained
`markers` and the guard discarded every trigger.

Explicit Ctrl+S worked. That is why it looked intermittent rather than broken.

Then `help-registry.ts` said: *"Markers are not saved with the project yet — a refresh
loses them, which is the one thing a note is for."* Which made it worse: **the
documentation agreed with the observed behaviour**, so anyone investigating concluded
the feature was unfinished and stopped looking. A user-facing string asserting a
data-loss bug is not a disclaimer — it is a bug report written in the voice of the
product.

**The defence.** Done. `setDirty(true)` on `addMarker`, `removeMarker` and
"clear all markers". The help text now says what is actually true: markers save with
the project, and a marker is a position you can find again rather than a description
of what you saw.

### 3.4 — One field, three numbers

`video-editor.tsx` wrote `version: 3`, `project-panel.tsx` wrote `version: 2`, and
`engine/types.ts` exported `PROJECT_VERSION = 2`. `normaliseProject` overwrites
`version` on load, so every document saved as 3 came back as 2 on the very next read.
Any migration keyed on `version` had no correct input to key on. All three now
reference the constant.

### 3.5 — Five Dockerfiles, one shared handler, three drifted copies

`/api/health-check` existed twice and was byte-identical; `/api/audit` existed in all
seven apps and had already drifted into three variants. The plan file's own summary is
the general rule: **"a bug fixed in one place but not the other six is a bug that is
still in production."**

The pattern now in place is one implementation plus a three-line re-export per app
(`@wideo11/ui/audit-handler`, `@wideo11/ui/health-handler`), with `SERVER_SURFACE` in
compose as the single authoritative surface value. A fix lands in all of them or
none.

---

## Tier 4 — "Later, when there is traffic"

Not exploitable today. Listed because they are the ones that turn a working system
into an unusable one, and because each has a cheap fix now and an expensive one later.

| # | Issue | Why it matters | Fix |
|---|---|---|---|
| 4.1 | `video-editor` has no server-side middleware | By design — the client `access-gate.tsx` renders the sign-in UI, and its only API routes are `/api/session` (probes its own cookie), `/api/audit`, `/api/health`. None serve user data. But it is the app where the actual work happens, and it is the one app with no server gate. | Add a server gate the moment any route serves user data. |
| 4.2 | `requirePermission` / `requireService` are defined and unwired | The RBAC layer exists and never ran. Every app gate checks *role*; nothing checks *which service this role may use*. | Wire them, or delete them. A defined-but-unused permission layer is a claim of defence that does not exist. |
| 4.3 | Rate limits are in-process where Redis was meant | `/api/audit`'s limiter is a bounded in-memory Map. Fine for one instance; with N replicas an attacker gets N× the budget. | Move to Redis when there is more than one instance. The interface is already a single function. |
| 4.4 | Live view polls at 5s | 12 requests/min/dashboard. With 20 operators watching, 240 req/min against the ledger. | NATS already exists in this stack for exactly this. Note the publisher has no consumer today. |
| 4.5 | No backup service | Phase D3, not started. | Back up Postgres **and** MinIO, and **test the restore**. An untested backup is a rumour. |
| 4.6 | Secrets in git history | The Gmail/OpenAI/Stripe keys and the two JWT defaults. | Rotate all of them. History is forever; the `KnownWeakJWTSecrets` list stops new misuse, not an attacker who already has them. |

---

## What is genuinely solid

Worth stating, so the list above is not read as "everything is broken":

- **`monitor` and `web` are deliberately unauthenticated**, and their open surfaces are
  now **enumerated** rather than prefixed. `publicApiPrefixes: ['/api']` meant every
  route added later was public too, and nobody would have written that decision down.
- **The click ledger writes are server-authoritative** on the three fields a client
  cannot be trusted with, and every row records how it was attributed.
- **Passkey login issues a real session** through code shared with the password path,
  and re-checks account state at issuance.
- **Retention actually deletes**, verified against a real database with raw SQL counts.
- **The 8-second, 30-second and 24-hour regression batteries** exist and run, which is
  why most of the above was caught at all.
- **NATS failures never affect authentication** — audit only. That failure policy is
  documented and deliberate.

---

## The five rules, restated

1. **A committed value is a published value.** No default in a repository may be a
   credential.
2. **Allowlists are enumerated, never prefixes.** A prefix is an open grant to the
   future that nobody has to notice they are making.
3. **A comment is not a control.** If the check cannot fail, it is decoration.
4. **Failure must never render as emptiness.** On a dashboard, that is the most
   expensive kind of lie there is, because it is believed.
5. **Public means unauthenticated, so public means limited.** Anything writable by
   anyone is a rate limit and a validation layer, not a convenience.
