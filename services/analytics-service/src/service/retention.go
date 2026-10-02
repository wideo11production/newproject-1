// Retention: the ledger is not a permanent record.
//
// =============================================================================
// WHY THIS IS A JOB AND NOT A SHELL SCRIPT
// =============================================================================
//
// A cron inside the service shares the binary, the connection pool and the log
// stream with the thing it is retaining. A separate script is a second thing to
// deploy, a second thing to alert on, and it fails silently in a way nothing
// notices - a retention job that quietly stops running looks exactly like a
// product nobody uses.
//
// The other reason is honest auditing: this is the only operation in the service
// that deletes anything, and it should be greppable from the code that owns the
// table.
//
// =============================================================================
// THE METRICS THIS EXPORTS, AND WHY EACH ONE IS NOT OBVIOUS
// =============================================================================
//
// A sweep publishes three values:
//
//   last_sweep_timestamp  - a HEARTBEAT. This is the one that answers "is the
//                           sweeper still alive".
//   rows_pending_purge    - the backlog between sweeps.
//   sweep_failures        - a counter, because a sweeper that is running but
//                           erroring looks identical to one that is dead if you
//                           only have the heartbeat.
//
// The obvious design - "alert when nothing was purged in 6 hours" - does not
// work, for two separate reasons:
//
//   1. A counter that has never been incremented is not ABSENT. It is registered
//      at process start with value 0, so `absent_over_time` on it returns empty
//      forever. The rule would be valid YAML that can never fire, which is worse
//      than no rule because it looks like coverage.
//
//   2. On a quiet night, purging nothing is the CORRECT outcome. Alerting on it
//      trains people to dismiss a real alert.
//
// The heartbeat sidesteps both: it is a wall-clock timestamp, so staleness is
// computable, and it is independent of traffic.

package service

import (
	"context"
	"log"
	"time"

	"newproject/services/analytics-service/src/metrics"
	"newproject/services/analytics-service/src/repository"
)

// RetentionJob deletes ledger rows older than the window.
//
// 90 days is the plan's number (`RETENTION_CLICK_EVENTS`). It is long enough to
// investigate a funnel and short enough to answer a deletion request without
// arguing about it.
type RetentionJob struct {
	repo   *repository.UIClickRepository
	window time.Duration

	// interval is how often the sweep runs. A field rather than a constant so
	// tests can drive the loop instead of sleeping through it.
	interval time.Duration

	// now is injectable for the same reason - a retention test that has to wait
	// six hours to observe a purge is a retention test that never runs.
	now func() time.Time
}

// DefaultRetentionDays is the window. Exported so tests and ops agree on it.
const DefaultRetentionDays = 90

// DefaultSweepInterval is how often the sweeper runs.
//
// Six hours: coarse enough that the DELETE does not contend with ingest, and
// fine enough that the backlog stays small. The alert threshold is set relative to
// this number rather than hardcoded, so changing one does not silently leave the
// other wrong.
const DefaultSweepInterval = 6 * time.Hour

func NewRetentionJob(repo *repository.UIClickRepository, window time.Duration) *RetentionJob {
	if window <= 0 {
		window = DefaultRetentionDays * 24 * time.Hour
	}
	return &RetentionJob{
		repo:     repo,
		window:   window,
		interval: DefaultSweepInterval,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// Run sweeps once, immediately, and then on the interval until ctx ends.
//
// The immediate first sweep is deliberate. A process that only sweeps after six
// hours means a freshly deployed service keeps a growing pile for six hours, and
// "we will get to it" is how a table outgrows a volume.
func (j *RetentionJob) Run(ctx context.Context) {
	j.sweep(ctx)

	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[RETENTION] stopping")
			return
		case <-ticker.C:
			j.sweep(ctx)
		}
	}
}

func (j *RetentionJob) sweep(ctx context.Context) {
	now := j.now()
	cutoff := now.Add(-j.window)

	deleted, err := j.repo.PurgeOlderThan(ctx, cutoff)
	if err != nil {
		// A failed purge must be loud. This is the operation nobody notices has
		// stopped, which is exactly why it cannot be a debug-level line - and
		// why the heartbeat below is only advanced on SUCCESS.
		metrics.RetentionSweepFailed.Inc()
		log.Printf("[RETENTION] purge FAILED: %v", err)
		return
	}

	if deleted > 0 {
		metrics.RetentionDeleted.Add(float64(deleted))
		log.Printf("[RETENTION] purged %d UI click event(s) older than %s", deleted, cutoff.Format(time.RFC3339))
	}

	// The backlog AFTER the sweep, so the gauge answers "how far behind is the
	// sweeper" rather than "how much was behind when it ran".
	pending, err := j.repo.CountOlderThan(ctx, cutoff)
	if err != nil {
		metrics.RetentionSweepFailed.Inc()
		log.Printf("[RETENTION] backlog count FAILED: %v", err)
		return
	}
	metrics.RetentionPendingPurge.Set(float64(pending))

	remaining, err := j.repo.CountSince(ctx, cutoff)
	if err != nil {
		metrics.RetentionSweepFailed.Inc()
		log.Printf("[RETENTION] post-purge count FAILED: %v", err)
		return
	}

	// Heartbeat LAST, and only on a fully successful sweep. Publishing it earlier
	// would tell the alert "I am alive" while the job is in fact erroring, which
	// is the one thing the heartbeat exists to distinguish.
	metrics.RetentionLastSweep.Set(float64(now.Unix()))

	log.Printf("[RETENTION] %d event(s) in the %d-day window, %d pending purge",
		remaining, int(j.window.Hours()/24), pending)
}
