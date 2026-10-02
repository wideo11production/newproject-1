// Prometheus metrics for this service.
//
// =============================================================================
// READ THIS BEFORE ADDING A METRIC. THE CARDINALITY RULE IS NOT OPTIONAL.
// =============================================================================
//
// Prometheus keeps every distinct label combination of every metric alive until
// its retention window expires. It does not sample-then-forget; it remembers
// every series it has seen. So the cost of a metric is:
//
//     number of distinct label VALUES, multiplied by number of scrapes, retained
//
// The failure mode is not gradual. Once the live-series count passes the budget,
// Prometheus stops ingesting, stops recording, and every dashboard on the box
// goes blank - including the ones monitoring payment failures. One unbounded
// label can take down alerting for the entire system.
//
// =============================================================================
// THE THREE RULES
// =============================================================================
//
// 1. NEVER a label that can grow with traffic or with input.
//
//    FORBIDDEN as label values:
//      - a user id, email, session id, device id
//      - a raw URL or path (`/dashboard/settings/9f3a...` is unbounded)
//      - an element selector (`button.flex.h-7.w-7` - one per class combination)
//      - a free-text label, a referrer, a query string
//
//    ALLOWED, because each is drawn from a set the system defines:
//      - `surface`   - web / editor / admin / ... (8 values, fixed by compose)
//      - `outcome`   - recorded / rejected / error (3 values, this file's enum)
//      - `method`    - POST / GET
//
// 2. Raw values belong in the DATABASE, not in a label.
//
//    The click ledger stores every distinct `target` and `page`. Prometheus gets
//    a count. That split is the whole design: the database answers "what exactly
//    did they click", Prometheus answers "are we clicking more or less".
//
// 3. A label with more than a few dozen values is a bug, and the test says so.
//
//    `TestMetricLabelCardinality` fails the build if a new high-cardinality
//    label appears, which is cheaper than finding out in production.

package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Outcome values. Deliberately a closed enum, so the label cannot drift.
const (
	OutcomeRecorded = "recorded"
	OutcomeRejected = "rejected"
	OutcomeError    = "error"
)

var (
	// UIEventsIngested counts UI click events written to the ledger.
	//
	// Labelled by `surface` and `outcome` only. The number of series this can
	// produce is 8 surfaces x 3 outcomes = 24, for the lifetime of the process.
	UIEventsIngested = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "wideo11_ui_click_events_total",
			Help: "UI click events received, by app surface and outcome.",
		},
		[]string{"surface", "outcome"},
	)

	// EventsInBatch is a histogram, not a counter, because the interesting
	// question is the shape of the batch the tracker sends - and it is a
	// distribution, so a counter would only be usable as a rate.
	//
	// The buckets are fixed. An adaptive or unbounded bucket set is a way of
	// creating cardinality by accident.
	EventsInBatch = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "wideo11_ui_click_batch_size",
			Help:    "How many events arrived per ingest request.",
			Buckets: []float64{1, 5, 10, 25, 50, 100, 200},
		},
		[]string{"surface"},
	)

	// RetentionDeleted counts rows removed by the retention job.
	//
	// Unlabelled on purpose: one series. If this ever needs a label to be
	// useful, that is a sign the purge should be per-table in code instead of
	// one job that grows a label per table.
	RetentionDeleted = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "wideo11_telemetry_rows_purged_total",
			Help: "Rows removed by the telemetry retention job.",
		},
	)

	// ---- Retention heartbeats ----
	//
	// ---- WHY A HEARTBEAT AND NOT "DID IT DELETE ANYTHING" ----
	//
	// The obvious rule is "alert when nothing was purged in N hours". It cannot
	// work, for two independent reasons, and both are worth stating because the
	// rule looks entirely reasonable:
	//
	//  1. A counter that has never been incremented is NOT absent. `promauto`
	//     registers it at process start with value 0, so it exists and
	//     `absent_over_time(...)` on it returns an empty vector forever. The rule
	//     would be valid YAML that can never fire - worse than no rule, because
	//     it looks like coverage.
	//
	//  2. On a quiet night, purging nothing is the CORRECT outcome. Alerting on
	//     it trains people to dismiss alerts.
	//
	// A wall-clock timestamp sidesteps both: staleness is computable, and it does
	// not depend on there being any traffic at all.
	RetentionLastSweep = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "wideo11_telemetry_retention_last_sweep_timestamp_seconds",
			Help: "Unix time of the last SUCCESSFUL retention sweep. Compare against time() to determine whether the sweeper is alive; a 'did it purge anything' counter cannot answer that.",
		},
	)

	RetentionPendingPurge = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "wideo11_telemetry_rows_pending_purge",
			Help: "Rows older than the retention window waiting for the next sweep. Non-zero between sweeps is normal; sustained means the sweeper is stuck.",
		},
	)

	RetentionSweepFailed = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "wideo11_telemetry_retention_sweep_failures_total",
			Help: "Failed retention sweeps since start. Rising with a stale last-sweep time means the sweeper is up but erroring.",
		},
	)
)

// SanitiseSurface bounds an untrusted value into the closed label set.
//
// The surface arrives from a browser, so it is attacker-controlled. Used
// verbatim it would be a perfect cardinality bomb: one new Prometheus series
// per request, forever.
//
// Anything unrecognised collapses to `unknown` rather than being passed through.
// That loses the ability to spot a genuinely new app, which is the right trade:
// a new app should be added here deliberately, and an unexpected value is far
// more likely to be junk than a new deployment.
func SanitiseSurface(surface string) string {
	switch surface {
	case "web", "editor", "admin", "analytics", "billing", "monitor", "currency", "superadmin":
		return surface
	default:
		return "unknown"
	}
}

// SanitiseOutcome does the same for the outcome label, for the same reason - it
// is one of only three legal values and everything else is a bug elsewhere.
func SanitiseOutcome(outcome string) string {
	switch outcome {
	case OutcomeRecorded, OutcomeRejected, OutcomeError:
		return outcome
	default:
		return OutcomeError
	}
}
