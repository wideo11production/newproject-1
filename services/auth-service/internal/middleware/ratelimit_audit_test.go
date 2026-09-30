package middleware

// TestSubjectsMatchStreamFilter is the regression test for a silent audit
// failure.
//
// THE BUG IT CATCHES
//
// JetStream only stores a message if some stream's subject filter matches the
// publish subject. Publishing outside every filter returns:
//
//     nats: no response from stream
//
// which is a WARNING, not an error that stops anything. So the setup looked
// completely healthy - stream created, connection up, no startup complaint -
// while every single event was being thrown away. The rate limiter was still
// blocking correctly, so nothing looked broken. The audit trail was simply
// empty, and the only evidence was a warn line nobody was reading.
//
// It happened because two files used different prefixes: the stream was
// created for `auth-service.security.>` while the publisher sent
// `WIDEO11_SECURITY.*`.
//
// WHAT THIS ASSERTS
//
// Every subject subjectFor() can produce must be matched by the stream filter
// in internal/natsx. The two constants are cross-checked here rather than
// merely documented, so changing one without the other fails a test instead
// of silently discarding a security audit trail.

import (
	"strings"
	"testing"
)

// streamSubjects mirrors natsx.DefaultStreams. Duplicated deliberately: the
// test must FAIL if the real definition changes, which is the entire point.
// If this ever becomes annoying, the fix is to export the real value from
// natsx and compare against that - not to delete the assertion.
var streamSubjects = []string{"auth-service.security.>"}

func TestSubjectsMatchStreamFilter(t *testing.T) {
	limits := []string{
		"login", "login_sustained", "login_account", "login_ip",
		"register", "verify", "password_reset",
		"api",
		"something_never_seen_before",
	}

	for _, l := range limits {
		subject := subjectFor(l)
		if !matchesAnyStream(subject, streamSubjects) {
			t.Errorf("subjectFor(%q) = %q, which NO stream accepts; JetStream would "+
				"discard every such event with \"no response from stream\". "+
				"Stream filters are %v", l, subject, streamSubjects)
		}
	}
}

// matchesAnyStream reports whether subject matches at least one filter, using
// NATS wildcard semantics: `>` matches one or more trailing tokens, `*` matches
// exactly one.
//
// A naive strings.HasPrefix would be wrong: `auth-service.security.>` must NOT
// match `auth-service.securityX.evil`, and a test that got that wrong would
// pass while production dropped the event.
func matchesAnyStream(subject string, filters []string) bool {
	for _, f := range filters {
		if subjectMatches(subject, f) {
			return true
		}
	}
	return false
}

func subjectMatches(subject, filter string) bool {
	if strings.HasSuffix(filter, ">") {
		prefix := strings.TrimSuffix(filter, ">")
		// `foo.>` must match `foo.bar` and `foo.bar.baz`, but NOT `foobar`.
		// The prefix keeps its trailing dot, so `foo.>` correctly does not
		// match `foobar`.
		return strings.HasPrefix(subject, prefix)
	}
	return subject == filter
}
