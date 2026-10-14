package service

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// WHAT MUST BE REFUSED
// ---------------------------------------------------------------------------
//
// Every case here is a real bypass that has been used against comment sections.
// The list is the point: a ban that stops `http://example.com` and nothing else is
// a ban that stops people who did not intend to get around it.

func TestValidateCommentBodyRefusesLinks(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"scheme https", "check out https://example.com for more"},
		{"scheme http", "http://example.com"},
		{"no scheme www", "www.example.com"},
		{"bare domain", "example.com"},
		{"bare domain with path", "go to example.com/watch?v=1"},
		{"bracketed dot", "example[.]com"},
		{"parenthesised dot", "example(.)com"},
		{"curly dot", "example{.}com"},
		{"middle dot", "example·com"},
		{"unicode fullwidth dot", "example．com"},
		{"spaced dots", "e x a m p l e . c o m"},
		{"padded domain", "example . com"},
		{"dotted inside prose", "please visit example.com for more"},
		{"dotted bracketed inside prose", "example[.]com is the site"},
		{"zero width space", "exa​mple.com"},
		{"javascript scheme", "javascript:alert(1)"},
		{"mailto", "mail me at mailto:someone@example.com"},
		{"ip literal with port", "connect to 1.2.3.4:8080"},
		{"known tld subdomain", "sub.example.video"},
		{"tld at end with path", "my.site/verify"},
		{"wait this is the whole", "visit bit.ly/xyz"},
		{"uppercase scheme", "HTTPS://EXAMPLE.COM"},
		{"mixed case domain", "Example.Com"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateCommentBody(tc.body)
			if err == nil {
				t.Fatalf("body %q must be refused", tc.body)
			}
			// The reason has to say WHAT it saw, or the author cannot find it in
			// their own text.
			if err.Error() == "" {
				t.Fatal("a refusal must carry a reason")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// WHAT MUST BE ALLOWED
// ---------------------------------------------------------------------------
//
// This is the half that decides whether the ban is usable. A validator that refuses
// ordinary writing is a validator people work around, and the workaround is the one
// form that both gets past the check and is harder to spot.

func TestValidateCommentBodyAllowsOrdinaryText(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"plain comment", "this is a great video, thanks for making it"},
		{"punctuation heavy", "wow!!! i loved the part at 3:45... so good :)"},
		{"abbreviation e.g.", "i use a dot matrix printer, e.g. for the stencil"},
		{"abbreviation U.S.A.", "shot on location in the U.S.A. last summer"},
		{"version string", "upgraded to v1.2.3 last week and it fixed the dub"},
		{"measurement", "the cable was 3.5 metres and still reached"},
		{"math", "the ratio is 0.5 and the offset is 1.25"},
		{"emoticons and unicode", "🔥🔥🔥 this slaps"},
		{"code-ish but no tld", "the config key is db.pool.max"},
		{"repeated dots", "......"},
		{"a lone @", "@creator please make more of these"},
		{"email-like but no scheme", "reach me at someone at example dot com"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateCommentBody(tc.body); err != nil {
				t.Fatalf("body %q must be allowed, got: %s", tc.body, err)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// THE EDGE CASES THAT ACTUALLY MATTER
// ---------------------------------------------------------------------------

func TestValidateCommentBodyEmptyIsAllowed(t *testing.T) {
	// An empty body is not a link, so this passes. Length is a SEPARATE check in
	// the service, and conflating the two would mean a link-shaped empty string
	// produced a confusing error.
	for _, body := range []string{"", "   ", "\n\t "} {
		if err := ValidateCommentBody(body); err != nil {
			t.Fatalf("empty body must pass the link gate, got %s", err)
		}
	}
}

func TestValidateCommentBodyReasonNamesTheOffendingText(t *testing.T) {
	// The author is shown this string. If it names a category but not the phrase,
	// they cannot find it - and an explanation nobody can act on teaches them to
	// obfuscate harder rather than to stop.
	err := ValidateCommentBody("great video! visit example.com/verify now")
	if err == nil {
		t.Fatal("expected a refusal")
	}

	msg := err.Error()
	for _, want := range []string{"link", "example.com"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("the reason should mention %q, got: %s", want, msg)
		}
	}
}

func TestDetectLinkFindsTheRightKind(t *testing.T) {
	// The KIND is what the reason says, so it has to be accurate - a reason that
	// says "url scheme" when the input was a bare domain is a misleading refusal.
	cases := []struct {
		body string
		kind string
	}{
		{"https://example.com", "url scheme"},
		{"www.example.com", "www host"},
		{"example.com/x", "domain"},
		{"1.2.3.4:8080", "ip address"},
	}
	for _, tc := range cases {
		det, ok := detectLink(tc.body)
		if !ok {
			t.Fatalf("expected a detection for %q", tc.body)
		}
		if det.Kind != tc.kind {
			t.Fatalf("body %q: expected kind %q, got %q (snippet %q)",
				tc.body, tc.kind, det.Kind, det.Snippet)
		}
	}
}

func TestNormaliseForLinkDetectionFlattensObfuscation(t *testing.T) {
	// The normaliser destroys obfuscations, and now KEEPS ordinary spaces - see
	// `normaliseForLinkDetection`: deleting them is what let "visit example.com for
	// more" through as prose, because the words fused and no TLD boundary was left.
	cases := []struct {
		in, want string
	}{
		{"example[.]com", "example.com"},
		{"example(.)com", "example.com"},
		{"exa​mple", "example"},
		{"a·b", "a.b"},
		{"plain", "plain"},
		// ordinary space survives
		{"e x a m p l e", "e x a m p l e"},
		{"visit example.com for more", "visit example.com for more"},
	}
	for _, tc := range cases {
		got := normaliseForLinkDetection(tc.in)
		if got != tc.want {
			t.Fatalf("normalise(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestSnippetAroundPreservesOriginalText(t *testing.T) {
	// The reason must show the text the AUTHOR typed, not the normalised form:
	// "your comment contained example[.]com" is useless when their own draft reads
	// "example.com".
	const marker = "example[.]com"
	body := "great video, please verify at " + marker + " and let me know"

	at := strings.Index(body, marker)
	got := snippetAround(body, at, len(marker))

	if !strings.Contains(got, "[.]") {
		t.Fatalf("the snippet should preserve the original dots, got %q", got)
	}
	if len(got) > 70 {
		t.Fatalf("the snippet should be capped, got %d bytes", len(got))
	}
}

// ---------------------------------------------------------------------------
// THE FALSE-POSITIVE REGRESSION SET
// ---------------------------------------------------------------------------
//
// These are the sentences that, if they ever start being refused, mean a rule was
// added too aggressively. They are kept together so a diff that widens the ban has
// to face them all at once.

func TestValidateCommentBodyRegressionOrdinarySentences(t *testing.T) {
	sentences := []string{
		"the highlight reel was 4 minutes long",
		"i hit the highway at high speed",
		"the dosage instructions were on the label",
		"a dossier of the whole project",
		"shot on iPhone in high resolution",
		"he took a higher dose of vitamin c",
		"we watched it on a big screen",
		"the crack in the wall was getting bigger",
		"a joint of meat in the oven",
		"my camera gear is a mess",
	}

	for _, s := range sentences {
		if err := ValidateCommentBody(s); err != nil {
			t.Fatalf("sentence %q must be allowed, got: %s", s, err)
		}
	}
}
