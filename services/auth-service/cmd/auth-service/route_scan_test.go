package main

import (
	"regexp"
	"strings"
)

// Helpers for routes_test.go. Kept separate so the test file reads as intent
// rather than string munging.

// splitLines is strings.Split with a clearer name at the call site.
func splitLines(s string) []string { return strings.Split(s, "\n") }

// routeLiteral matches a gin's `group.METHOD("/path"` call.
var routeLiteral = regexp.MustCompile(
	`^\s*(\w+)\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(\s*"([^"]+)"`,
)

// groupDecl matches `name := parent.Group("/prefix")` and the chained form
// `name := parent.Group("").Group("/more")`.
//
// Chaining is why a single-regex approach fails: `auth.Group("")` adds nothing,
// but `auth.Group("/security")` does, and the resolved path depends on the
// whole chain. Capturing the whole prefix list and concatenating handles both
// without special cases.
var groupDecl = regexp.MustCompile(
	`^\s*(\w+)\s*:=\s*([\w.]+)\.Group\((.*)\)`,
)

// groupPrefixInChain pulls every string literal out of a Group() argument
// chain. `auth.Group("").Group("/security")` yields ["", "/security"].
var strLiteral = regexp.MustCompile(`"([^"]*)"`)

// parseRouteLiteral extracts the group, method and path prefix from a source
// line. Returns ok=false for any line that is not a route registration or a
// group declaration.
func parseRouteLiteral(line string) (group, method, path string, ok bool) {
	trimmed := strings.TrimSpace(line)
	// Skip comment-only lines. A commented-out route is not a registration,
	// and treating it as one produced a false positive that would have made
	// this check noise rather than signal.
	if strings.HasPrefix(trimmed, "//") {
		return "", "", "", false
	}

	if m := routeLiteral.FindStringSubmatch(trimmed); m != nil {
		return m[1], m[2], m[3], true
	}
	if m := groupDecl.FindStringSubmatch(trimmed); m != nil {
		return m[1], "", "", true
	}
	return "", "", "", false
}

// prefixesOf concatenates the string literals in a Group() chain.
func prefixesOf(arg string) string {
	var b strings.Builder
	for _, m := range strLiteral.FindAllStringSubmatch(arg, -1) {
		b.WriteString(m[1])
	}
	return b.String()
}

// routeScanner walks main.go once, tracking which path prefix each variable
// resolves to, so that two registrations are compared by their RESOLVED path.
//
// ---- WHY RESOLUTION IS NECESSARY ----
//
// A literal-only comparison is wrong. main.go contains both:
//
//   protected.POST("/pin/verify")        -> /api/v1/auth/pin/verify
//   secGroup.POST("/pin/verify")         -> /api/v1/auth/security/pin/verify
//
// The path literal "/pin/verify" appears twice, but these are DIFFERENT
// routes and gin does not panic on them. A literal scanner reports a false
// positive here - and a scanner that cries wolf gets deleted, taking the real
// protection with it. So the prefix chain is resolved instead.
type routeScanner struct {
	// groupPrefix maps a variable name to its resolved path prefix, e.g.
	// "auth" -> "/api/v1/auth", "secGroup" -> "/api/v1/auth/security".
	groupPrefix map[string]string
	// counts counts resolved "METHOD path" occurrences.
	counts map[string]int
}

func newRouteScanner() *routeScanner {
	return &routeScanner{
		// `r` is gin's root engine; its prefix is empty.
		groupPrefix: map[string]string{"r": ""},
		counts:     map[string]int{},
	}
}

func (s *routeScanner) scanLine(line string) {
	group, method, path, ok := parseRouteLiteral(line)
	if !ok {
		return
	}

	// A group declaration with no method: record the prefix.
	if method == "" {
		// Recover the argument list to concatenate the chain.
		trimmed := strings.TrimSpace(line)
		if m := groupDecl.FindStringSubmatch(trimmed); m != nil {
			parent := s.groupPrefix[m[2]]
			s.groupPrefix[group] = parent + prefixesOf(m[3])
		}
		return
	}

	prefix := s.groupPrefix[group]
	// `Group("")` yields an empty prefix, so paths must be joined with a
	// guaranteed separator or "/a" + "/b" would become "/ab".
	full := strings.TrimSuffix(prefix, "/") + path
	if prefix == "" {
		full = path
	}
	s.counts[method+" "+full]++
}
