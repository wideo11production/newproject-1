package purge

// Retention: PII ke rows ko DELETE karta hai, on a schedule.
//
// ----------------------------------------------------------------------------
// YE FILE KIS BAAT KA HAI
// ----------------------------------------------------------------------------
//
// `SYSTEM-PLAN.md` §3.3 30-day retention specify karta hai. Kuch bhi delete nahi
// karta tha. Ye gap `updatedtodo.md` ki "PII in telemetry, no retention policy"
// row me likha tha, aur wo row 2026-10-01 tak galat thi - `ui_click_events` ka
// purge `analytics-service` me chalta hai. Ye file US gap ko close karti hai:
// auth-side PII.
//
// ----------------------------------------------------------------------------
// YE DEAD CODE KO LIVE KIYE, NA KIYE TO
// ----------------------------------------------------------------------------
//
// `SessionRepository.DeleteExpired` aur `RefreshTokenRepository.DeleteExpired`
// dono likhe hue the, sahi SQL bhi, aur dono ke ZERO call sites the. Koi unhe
// call nahi karta tha, isliye wo kabhi kuch nahi mitaate - aur "koi line execute
// nahi hota" aur "line execute hoti hai" dono ek jaise dikhte hain.
//
// Ye worker unhe CALL karta hai. Doosri taraf se likhne ki jagah, isliye ki
// unka SQL ek jagah aur ek hi baar hota hai.
//
// ----------------------------------------------------------------------------
// KYUN YE ZAROORI HAI - EK STRAIGHT-UP DATA LEAK
// ----------------------------------------------------------------------------
//
// Ye tables har row me PII rakhti hain:
//
//	sessions          ip_address, user_agent
//	refresh_tokens    user_id, expires_at
//	user_sessions     ip_address, user_agent, duration_seconds
//	security_events   email, ip_address, user_agent, detail
//	webauthn_sessions challenge bytes
//
// Aur ye kabhi delete nahi hote the. Matlab:
//
//   - Koi jo DB backup chura le uske paas SAARE users ke historical IPs aur
//     exact user agents hain - jo "kaun kab kis machine se login tha" ka poora
//     record hai. Ye breach notification scope aur GDPR-style data-subject
//     erasure dono ko directly affect karta hai.
//   - Account delete karne par ye rows ZALTI REH JAATI THI. Migration 012 ne
//     FK rules theek kiye taaki `DELETE FROM users` chale - par ye worker nahi
//     tha, isliye ek erase request "user row gaya, lekin uski IP history nahi"
//     ka result de sakta tha.
//
// Retention sirf disk space nahi hai. Ye ek erasure guarantee hai.
//
// ----------------------------------------------------------------------------
// DESIGN RULES, AUR HAR EK KA EK REASON HAI
// ----------------------------------------------------------------------------
//
//  1. HARD DELETE (`Unscoped`). GORM ka default soft delete hota hai, jo DELETE
//     ko `UPDATE deleted_at = now()` bana deta hai. Row DIKHATI hat jaati hai
//     par bytes wahi rehte hain. Iska matlab privacy ka claim aur storage ka
//     claim dono jhoothe hote. Purge ka kaam hai bytes hatana.
//
//  2. BATCHED. Ek `DELETE WHERE expires_at < now()` bina LIMIT ke ek bade table
//     par row lock le kar baith sakta hai, aur har row lock hold karne ke liye
//     dead space chhodti hai. Batch loop se lock chhoti hoti hai aur process
//     restart-survivable rehta hai.
//
//  3. FAIL-SOFT PER TABLE. Ek table ka delete fail hua to baaki tables CHALTE
//     rahenge. Agar pehla failure poora cycle rok deta, to ek stuck table
//     hone se baaki chaaron PII tables bhi forever bharti rahti - yaani ek bug
//     poora feature disable kar deta, silently.
//
//  4. `security_events` KI ALAG, LONGER WINDOW. Ye audit trail hai, session
//     record nahi. Login-failure patterns ko dekhna 90 din baad bhi zaroori
//     hai. Isliye iska apna window hai (default 400 din) aur ye `Expired()` se
//     delete NAHI hota - ye `timestamp` se hota hai. Credential rows expire karte
//     hain; audit records expire nahi karte, sirf apni window poori hone par.
//
//  5. COUNTS LOGGED, INCLUDING ZERO. "Deleted 0" ek useful line hai: wo prove
//     karti hai ki worker CHAL raha hai. Silent success aur "kuch nahi hua"
//     bilkul alag hain, aur doosra tabhi interpret hota hai jab kuch hua ho.

import (
	"context"
	"fmt"
	"log"
	"time"

	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// RetentionWindows config-driven, so nothing here is a magic number in a
// comment that the code never reads.
//
// Defaults are stated in the constructor, not here, so an unset value is a
// visible no-op rather than a zero-duration purge of everything.
type RetentionWindows struct {
	// How often the sweep runs.
	Interval time.Duration

	// Batch size per DELETE, per table. Bounds the lock and the WAL burst.
	BatchSize int

	// Expired credential material. Keyed on the row's own `expires_at`, so these
	// go the moment they stop working - there is no reason to keep a dead token.
	Sessions          time.Duration
	RefreshTokens     time.Duration
	UserSessions      time.Duration
	WebAuthnSessions  time.Duration
	VerificationToken time.Duration

	// Audit trail. Much longer, and keyed on `timestamp` rather than expiry.
	//
	// 400 days is not arbitrary: it spans a full year, which is the shortest
	// window most breach-notification regimes expect an investigation to be able
	// to reach back into. Shorter and you cannot answer "was this account being
	// brute-forced before they complained".
	SecurityEvents time.Duration

	// Master switch. When false the worker starts and says so, then does nothing.
	// An operator needs a way to turn this OFF without editing code, and it needs
	// to be visible that it is off - silence would read as "running".
	Enabled bool
}

// defaultRetentionWindows returns the shipped defaults.
//
// Exported for the tests, so the assertions and the values cannot disagree.
func defaultRetentionWindows() RetentionWindows {
	return RetentionWindows{
		Interval:         1 * time.Hour,
		BatchSize:        1000,
		Sessions:         0,             // no grace: expiry is the whole rule
		RefreshTokens:    0,             //
		UserSessions:     90 * 24 * time.Hour, // online-time history is a product feature
		WebAuthnSessions: 0,             // challenges are minutes old at most
		VerificationToken: 7 * 24 * time.Hour, // past the 30-min TTL, plus a grace
		SecurityEvents:   400 * 24 * time.Hour,
		Enabled:          true,
	}
}

// RetentionWorker sweeps PII rows on a ticker.
//
// Deliberately NOT part of the unverified-account `Worker` in `purge.go`. That one
// is a product rule with a user-visible email; this one is a data-lifecycle rule
// with no user-visible effect. Merging them would mean a config flag for one
// silently controls the other, and the failure mode of that is a compliance
// window quietly becoming infinite.
type RetentionWorker struct {
	db      *gorm.DB
	windows RetentionWindows
	stopCh  chan struct{}
}

// NewRetentionWorker builds the sweeper, applying defaults for any zero window.
func NewRetentionWorker(db *gorm.DB, override *RetentionWindows) *RetentionWorker {
	w := defaultRetentionWindows()

	if override != nil {
		if override.Interval > 0 {
			w.Interval = override.Interval
		}
		if override.BatchSize > 0 {
			w.BatchSize = override.BatchSize
		}
		if override.Sessions > 0 {
			w.Sessions = override.Sessions
		}
		if override.RefreshTokens > 0 {
			w.RefreshTokens = override.RefreshTokens
		}
		if override.UserSessions > 0 {
			w.UserSessions = override.UserSessions
		}
		if override.WebAuthnSessions > 0 {
			w.WebAuthnSessions = override.WebAuthnSessions
		}
		if override.VerificationToken > 0 {
			w.VerificationToken = override.VerificationToken
		}
		if override.SecurityEvents > 0 {
			w.SecurityEvents = override.SecurityEvents
		}
		// Enabled is deliberately NOT defaulted from the override. `false` is the
		// zero value, so "the caller passed a struct with only Interval set" would
		// otherwise disable the whole sweeper - which is the opposite of what a
		// caller overriding one field intends.
		w.Enabled = override.Enabled
	}

	return &RetentionWorker{db: db, windows: w, stopCh: make(chan struct{})}
}

// Windows exposes the effective configuration, so Start can log the real numbers
// instead of a claim that can drift from them.
func (w *RetentionWorker) Windows() RetentionWindows { return w.windows }

// Start runs the sweep loop in the background.
func (w *RetentionWorker) Start(ctx context.Context) {
	if !w.windows.Enabled {
		log.Println("[RETENTION] disabled - no PII rows will be deleted")
		return
	}

	go w.loop(ctx)
	log.Printf(
		"[RETENTION] started | every=%v batch=%d | sessions=%v refresh=%v user_sessions=%v "+
			"webauthn_sessions=%v verification=%v security_events=%v",
		w.windows.Interval, w.windows.BatchSize,
		w.windows.Sessions, w.windows.RefreshTokens, w.windows.UserSessions,
		w.windows.WebAuthnSessions, w.windows.VerificationToken, w.windows.SecurityEvents,
	)
}

// Stop halts the loop.
func (w *RetentionWorker) Stop() {
	select {
	case <-w.stopCh:
		// Already closed. `Stop` is called from both a defer and a signal
		// handler in some paths, and closing twice panics.
	default:
		close(w.stopCh)
	}
}

func (w *RetentionWorker) loop(ctx context.Context) {
	ticker := time.NewTicker(w.windows.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[RETENTION] stopping (context cancelled)")
			return
		case <-w.stopCh:
			log.Println("[RETENTION] stopping (Stop called)")
			return
		case <-ticker.C:
			w.RunOnce(ctx)
		}
	}
}

// RetentionResult is what one sweep did, per table.
//
// Returned (and asserted on) rather than only logged, so the behaviour is
// testable and so "deleted 0 rows" is a value somebody can check instead of a
// line in a log nobody greps.
type RetentionResult struct {
	Sessions          int64
	RefreshTokens     int64
	UserSessions      int64
	WebAuthnSessions  int64
	VerificationToken int64
	SecurityEvents    int64

	// Failures names tables that could not be swept at all.
	//
	// A separate field rather than a -1 inside a count, for one reason: `Total()`
	// summing a -1 produces a negative total, so "3 rows deleted" and "one table
	// was unreachable and 4 rows deleted" both print as nonsense. A count column
	// that can be negative is a count column nobody can read.
	Failures []string
}

// Failed reports whether any table could not be swept.
func (r RetentionResult) Failed() bool { return len(r.Failures) > 0 }

// Total is every row removed this cycle. Counts only; a failed table contributes
// zero, not a negative.
func (r RetentionResult) Total() int64 {
	total := r.Sessions + r.RefreshTokens + r.UserSessions +
		r.WebAuthnSessions + r.VerificationToken + r.SecurityEvents
	if total < 0 {
		return 0
	}
	return total
}

// RunOnce performs one full sweep.
//
// Exported so a test can drive it deterministically instead of waiting an hour.
// Every table is attempted even if an earlier one failed.
func (w *RetentionWorker) RunOnce(ctx context.Context) RetentionResult {
	// Defence in depth: the flag is checked in `Start`, and it is checked HERE as
	// well.
	//
	// `main.go` calls `RunOnce` directly for the startup sweep before the ticker
	// exists, so a single check in `Start` would leave that one path unguarded -
	// turning the switch off would stop the hourly sweep and not the startup one.
	// A kill switch that misses one path is not a kill switch.
	if !w.windows.Enabled {
		log.Println("[RETENTION] disabled - refusing to sweep")
		return RetentionResult{}
	}

	if w.db == nil {
		log.Println("[RETENTION] no database handle - skipping sweep")
		return RetentionResult{}
	}

	now := time.Now()
	res := RetentionResult{}

	// Each step is independent. A failure is logged with its table name, recorded
	// in `Failures`, and the sweep continues - see design rule 3.
	//
	// `record` assigns the count AND notes a failure, so a caller cannot record
	// one without the other. The first version had a `sweep(name, fn)` helper
	// that ran the delete and only checked the sign - dropping the positive value
	// on the floor. Every DELETE worked, every table was correctly emptied, and
	// `RunOnce` reported `sessions=0 refresh_tokens=0 ...` for all six. The logs
	// looked healthy and the tests caught it; a monitoring dashboard reading
	// those counts would have concluded retention was never running.
	record := func(name string, fn func() int64) int64 {
		got := fn()
		if got < 0 {
			res.Failures = append(res.Failures, name)
			return 0
		}
		return got
	}

	res.Sessions = record("sessions", func() int64 {
		return w.deleteExpired(ctx, "sessions", &model.Session{}, "expires_at < ?",
			w.windows.BatchSize, now.Add(-w.windows.Sessions))
	})

	res.RefreshTokens = record("refresh_tokens", func() int64 {
		return w.deleteExpired(ctx, "refresh_tokens", &model.RefreshToken{}, "expires_at < ?",
			w.windows.BatchSize, now.Add(-w.windows.RefreshTokens))
	})

	res.WebAuthnSessions = record("webauthn_sessions", func() int64 {
		return w.deleteExpired(ctx, "webauthn_sessions", &model.WebAuthnSession{}, "expires_at < ?",
			w.windows.BatchSize, now.Add(-w.windows.WebAuthnSessions))
	})

	res.VerificationToken = record("verification_tokens", func() int64 {
		return w.deleteExpired(ctx, "verification_tokens", &model.VerificationToken{}, "created_at < ?",
			w.windows.BatchSize, now.Add(-w.windows.VerificationToken))
	})

	// `user_sessions` has no `expires_at`; it is closed by `ended_at`. A session
	// that never ended (a crash, a closed laptop lid) would otherwise sit forever
	// and still be rendered as "online".
	//
	// Both clauses matter, and they need TWO bind parameters - which is exactly
	// why the condition is written out here rather than passed as a bare string
	// somewhere else. A version with one `?` and two arguments fails at runtime
	// with `syntax error at or near ")"`, and `user_sessions` silently stopped
	// being swept while every other table kept working.
	//
	// `ended_at IS NOT NULL AND ...` rather than `ended_at < ...`: SQL's three-
	// valued logic means `NULL < x` is NULL, not true, so the bare form already
	// skips open sessions - but writing the guard makes the intent explicit and
	// stops anyone "simplifying" it back into a clause that looks equivalent and
	// is not.
	res.UserSessions = record("user_sessions", func() int64 {
		return w.deleteExpired(ctx, "user_sessions", &model.UserSession{},
			"(ended_at IS NOT NULL AND ended_at < ?) OR last_seen_at < ?",
			w.windows.BatchSize, now.Add(-w.windows.UserSessions), now.Add(-w.windows.UserSessions))
	})

	// `security_events` is keyed on `timestamp`, NOT on any expiry - see design
	// rule 4. This is the audit trail, not a credential.
	res.SecurityEvents = record("security_events", func() int64 {
		return w.deleteExpired(ctx, "security_events", &model.SecurityEvent{}, "timestamp < ?",
			w.windows.BatchSize, now.Add(-w.windows.SecurityEvents))
	})

	log.Printf("[RETENTION] swept %d row(s): sessions=%d refresh_tokens=%d user_sessions=%d "+
		"webauthn_sessions=%d verification_tokens=%d security_events=%d",
		res.Total(), res.Sessions, res.RefreshTokens, res.UserSessions,
		res.WebAuthnSessions, res.VerificationToken, res.SecurityEvents)

	if res.Failed() {
		// Loudly, and naming the tables. A sweeper that quietly gives up on one
		// table is how a compliance window becomes infinite without anyone
		// deciding that.
		log.Printf("[RETENTION] INCOMPLETE - could not sweep: %v", res.Failures)
	}

	return res
}

// deleteExpired removes up to `batch` rows per iteration until none remain.
//
// Returns the total removed, or -1 if the table could not be swept at all, which
// is how the caller tells "nothing to delete" from "could not look" without
// either one being silently zero.
//
// `args` is variadic rather than a single cutoff because conditions differ:
// one-column comparisons take one bind parameter and `user_sessions` takes two.
// A single-argument signature makes that impossible to express, and the
// alternative - one code path per shape - is the duplication that let the
// mismatch ship.
func (w *RetentionWorker) deleteExpired(
	ctx context.Context,
	table string,
	row any,
	condition string,
	batch int,
	args ...any,
) int64 {
	var total int64

	for {
		// `Unscoped()` is the whole point - see design rule 1. Without it GORM
		// soft-deletes and the PII stays in the table it claims to have removed.
		res := w.db.WithContext(ctx).
			Unscoped().
			Where(condition, args...).
			Limit(batch).
			Delete(row)

		if res.Error != nil {
			// First iteration only: a later failure is a mid-sweep error, and
			// logging it identically would read as "the table is unreachable"
			// when it is in fact "we removed 900 rows and then hit a lock".
			if total == 0 {
				log.Printf("[RETENTION] FAILED to sweep %s: %v", table, res.Error)
			} else {
				log.Printf("[RETENTION] %s: swept %d rows then failed: %v", table, total, res.Error)
			}
			// -1: "unknown", not "nothing". See this func's doc.
			return -1
		}

		total += res.RowsAffected

		// A short batch means the table is exhausted. Comparing against the limit
		// rather than looping until RowsAffected == 0 avoids one wasted round trip
		// per table per sweep.
		if res.RowsAffected < int64(batch) {
			break
		}

		// Yield between batches so a large backlog does not monopolise the
		// connection pool while every request in the service waits on it.
		select {
		case <-ctx.Done():
			log.Printf("[RETENTION] %s: interrupted after %d rows", table, total)
			return total
		case <-time.After(25 * time.Millisecond):
		}
	}

	if total == 0 {
		log.Printf("[RETENTION] %s: nothing past its window (healthy)", table)
	}
	return total
}

// RetentionWindowsFromEnv reads the retention config from viper's already-loaded
// config map, using env names an operator can actually type.
//
// Kept here rather than in `config.go` so the window names are documented next to
// the DELETE that honours them - a config field three files from the SQL it
// controls is a config field nobody sets.
func RetentionWindowsFromEnv(get func(string) (string, bool)) RetentionWindows {
	w := defaultRetentionWindows()
	if get == nil {
		return w
	}

	if v, ok := get("RETENTION_ENABLED"); ok {
		w.Enabled = v != "false" && v != "0"
	}
	if v, ok := get("RETENTION_INTERVAL_MINUTES"); ok {
		if d, err := time.ParseDuration(v + "m"); err == nil && d > 0 {
			w.Interval = d
		}
	}
	if v, ok := get("RETENTION_BATCH_SIZE"); ok {
		if n := atoiSafe(v); n > 0 {
			w.BatchSize = n
		}
	}
	if v, ok := get("RETENTION_USER_SESSIONS_DAYS"); ok {
		if n := atoiSafe(v); n > 0 {
			w.UserSessions = time.Duration(n) * 24 * time.Hour
		}
	}
	if v, ok := get("RETENTION_SECURITY_EVENTS_DAYS"); ok {
		if n := atoiSafe(v); n > 0 {
			w.SecurityEvents = time.Duration(n) * 24 * time.Hour
		}
	}
	if v, ok := get("RETENTION_VERIFICATION_TOKENS_DAYS"); ok {
		if n := atoiSafe(v); n > 0 {
			w.VerificationToken = time.Duration(n) * 24 * time.Hour
		}
	}
	return w
}

func atoiSafe(s string) int {
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0
	}
	return n
}
