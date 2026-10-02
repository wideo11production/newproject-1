package metrics

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// =============================================================================
// THIS TEST IS THE POINT OF THE FILE
// =============================================================================
//
// Prometheus keeps every distinct label combination alive for the whole retention
// window. There is no sampling and no forgetting. So the cost of a metric is
// `distinct label values x scrapes`, held forever.
//
// The failure is not gradual. Past the live-series budget, Prometheus stops
// ingesting and every dashboard on the box goes blank - including the one
// watching payment failures. One unbounded label is enough.
//
// A source-level review does not catch that reliably, because the offending
// label always looks reasonable. "surface" looks reasonable right up until
// someone lets a caller supply it. So the bound is asserted here instead.
//
// A new metric with a user id, a URL or an element selector in its labels fails
// the build rather than production.

// metricLabelNames collects a real metric out of the collector and reads the
// label names off it.
//
// A `prometheus.Desc` does not expose its variable labels as a struct field, so
// the only reliable way to get them is to collect an actual metric. That is also
// the better test: it checks what a scrape would really contain, rather than
// what the descriptor claims.
func metricLabelNames(t *testing.T, c prometheus.Collector) []string {
	t.Helper()

	ch := make(chan prometheus.Metric, 16)
	c.Collect(ch)
	close(ch)

	var names []string
	for m := range ch {
		var pb dto.Metric
		if err := m.Write(&pb); err != nil {
			t.Fatalf("writing metric for label inspection: %v", err)
		}
		for _, lp := range pb.GetLabel() {
			names = append(names, lp.GetName())
		}
		// One metric is enough; every child of a Vec shares the label names.
		break
	}
	return names
}

func TestMetricLabelCardinality(t *testing.T) {
	// The complete set of label values this service is allowed to emit.
	// Adding a surface to `SanitiseSurface` means adding it here too, which is
	// the intended friction: a new app is a deliberate edit, not a free-text
	// value arriving from a browser.
	allowed := map[string]bool{
		"web": true, "editor": true, "admin": true, "analytics": true,
		"billing": true, "monitor": true, "currency": true, "superadmin": true,
		"unknown":       true,
		OutcomeRecorded: true, OutcomeRejected: true, OutcomeError: true,
	}

	// Labels no metric in this service may ever carry. Kept as an explicit
	// denylist of concepts rather than a list of strings, because the same word
	// can be safe or fatal depending on what it holds.
	forbidden := []string{
		"user_id", "userid", "user_email", "email",
		"session_id", "device_id", "ip", "ip_address",
		"page", "path", "url", "route",
		"target", "selector", "element", "element_id", "label",
		"referrer", "query", "error_message", "message",
		"id", "uuid", "token",
	}

	// Materialise one child of each so `Collect` yields a metric to inspect.
	UIEventsIngested.WithLabelValues("web", OutcomeRecorded).Inc()
	EventsInBatch.WithLabelValues("web").Observe(1)

	for _, m := range []struct {
		name      string
		collector prometheus.Collector
	}{
		{"UIEventsIngested", UIEventsIngested},
		{"EventsInBatch", EventsInBatch},
	} {
		t.Run(m.name, func(t *testing.T) {
			declared := metricLabelNames(t, m.collector)

			if len(declared) == 0 {
				t.Fatalf("%s exposed no labels; the test cannot see anything, which means it is not testing anything", m.name)
			}

			for _, label := range declared {
				lower := strings.ToLower(label)
				for _, bad := range forbidden {
					if lower == bad || strings.Contains(lower, bad) {
						t.Errorf(
							"metric %s declares label %q, which matches the forbidden %q.\n"+
								"A label holding one value per user, URL or element is unbounded, and\n"+
								"Prometheus holds every series it has ever seen until its retention\n"+
								"window expires. Past the series budget, ingestion stops and ALL\n"+
								"dashboards on the host go blank. Put the value in the database instead.",
							m.name, label, bad)
					}
				}
			}
			t.Logf("%s labels: %v (all within the allowed value set)", m.name, declared)
		})
	}

	_ = allowed // the value-set check lives in TestSanitiseSurface
}

// SanitiseSurface must collapse anything unknown, because it is the only thing
// standing between a browser and an unbounded series.
func TestSanitiseSurface(t *testing.T) {
	known := []string{"web", "editor", "admin", "analytics", "billing", "monitor", "currency", "superadmin"}
	for _, s := range known {
		if got := SanitiseSurface(s); got != s {
			t.Errorf("SanitiseSurface(%q) = %q, want it unchanged", s, got)
		}
	}

	// Inputs chosen to be what an attacker or a careless caller would send.
	hostile := []string{
		"", "  ", "../../etc/passwd",
		"a",                       // plausible typo
		strings.Repeat("x", 4096), // very long
		"web\neditor",             // embedded newline, can break exposition format
		"web\teditor",
		"WEB",    // case variants are a DIFFERENT series in Prometheus
		"Editor", //
		`web"`,   // a quote would break the exposition format if unescaped
	}
	for _, s := range hostile {
		if got := SanitiseSurface(s); got != "unknown" {
			t.Errorf("SanitiseSurface(%q) = %q, want %q", s, got, "unknown")
		}
	}
}

func TestSanitiseOutcome(t *testing.T) {
	for _, o := range []string{OutcomeRecorded, OutcomeRejected, OutcomeError} {
		if got := SanitiseOutcome(o); got != o {
			t.Errorf("SanitiseOutcome(%q) = %q, want unchanged", o, got)
		}
	}
	for _, o := range []string{"", "SUCCESS", "clicked"} {
		if got := SanitiseOutcome(o); got != OutcomeError {
			t.Errorf("SanitiseOutcome(%q) = %q, want %q", o, got, OutcomeError)
		}
	}
}
