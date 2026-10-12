package service

// ============================================================================
// COMMENT LINK BAN - what a comment may not contain
// ============================================================================
//
// WHY THIS IS A SEPARATE FILE AND A SEPARATE FUNCTION
//
// Comments are the one surface where a user's text is shown next to other users'
// names and photographs, and it is the surface that gets abused: a comment that
// says "great content!" and then quietly contains a URL is a phishing vector with
// the platform's own rendering as cover.
//
// So this is not a filter with thresholds that can be tuned. It is a gate: a
// comment containing a link-shaped thing is REFUSED, with the reason returned to
// the author. There is no score, no "borderline", and no configuration that
// turns it off.
//
// ============================================================================
// WHAT COUNTS AS A LINK, AND WHAT IS DELIBERATELY EXCLUDED
// ============================================================================
//
// Detected, because each is a real bypass that has been used:
//
//	http://...            the obvious one, with any scheme (https, ftp, ws)
//	www.example.com       the second most common, and needs no scheme
//	example.com           a bare domain with a known TLD
//	1.2.3.4 / [::1]       an IP literal
//	example[.]com         bracketed and parenthesised dots
//	example (.) com       spaced dots
//	ex·ample·com          middle dots and other Unicode separators
//	e x a m p l e . c o m per-character spacing, the classic spammer trick
//	bit.ly/xyz            a shortener is a link too, and the WORST kind
//
// Deliberately NOT detected, because blocking them would make ordinary writing
// impossible and a validator that rejects "I use a dot matrix printer" is a
// validator people work around:
//
//	"example.com" inside a code span or a quoted error message - allowed only
//	  when it carries NO scheme, NO www, and NO path; see `bareDomainNeedsPath`
//	A version string like "v1.2.3"  - digits only, no TLD
//	A sentence ending in an abbreviation - "e.g." and "U.S.A." have no TLD
//
// ============================================================================
// THE HONEST LIMITATION
// ============================================================================
//
// This is a pattern matcher, not a parser. It will miss a novel encoding the
// first time one appears, exactly as every pattern matcher does. What it buys is
// that the OBVIOUS and WELL-KNOWN forms are gone, that the refusal is immediate
// and explained, and - the part that matters most - that a false ACCUSE costs a
// user one rewording rather than a false accept costing everyone a phishing page.
//
// When a new encoding shows up, this file is where it is added, and the test file
// is where it is proved.

import (
	"fmt"
	"strings"
	"unicode"
)

// ErrCommentHasLink is returned when a comment contains a link.
//
// Carries a human-readable reason rather than a bare code, because the author is
// shown this text verbatim - and "your comment was rejected" with no way to know
// what part of it triggered the rule is the fastest way to teach someone to
// obfuscate harder instead of stopping.
var ErrCommentHasLink = fmt.Errorf("comment contains a link")

// Known TLDs. A SHORT list on purpose: it is the allow-list a bare domain is
// checked against, and a long one is the kind of list that ships a typo and
// quietly stops matching anything.
//
// Country codes are NOT in it, because a two-letter TLD makes almost any short
// dotted word a "domain" - "file.zip.exe", "note.md.txt", and every abbreviation
// with two dots would all match. A comment that says "I use a fast SSD drive"
// would be refused. The cost of missing ".co" is far lower than the cost of
// refusing ordinary sentences.
var knownTLDs = map[string]bool{
	"com": true,
	"net": true,
	"org": true,
	"edu": true,
	"gov": true,
	"mil": true,
	"int": true,
	"info": true,
	"biz": true,
	"io": true,
	"co": true,
	"uk": true,
	"us": true,
	"video": true,
	"tv": true,
	"me": true,
	"app": true,
	"dev": true,
	"xyz": true,
	"online": true,
	"site": true,
	"shop": true,
	"link": true,
	// "ly" is here for bit.ly and t.ly, which are the two shorteners a comment
	// section sees most often. It is deliberately the LAST addition: a bare "ly" is
	// two letters and therefore the TLD most likely to appear inside an ordinary
	// word, and adding to this list is the change most likely to introduce a false
	// refusal. If this ever starts refusing innocent text, this is the entry to
	// look at.
	"ly": true,
}

// bannedSchemes are the URL schemes that make a comment a link outright.
//
// `javascript:` is here as much for the obvious reason as for the one people
// forget: it is the payload a xss link hides behind, and it has no legitimate
// place in a comment.
var bannedSchemes = []string{
	"http://",
	"https://",
	"ftp://",
	"ftps://",
	"ftpes://",
	"sftp://",
	"ws://",
	"wss://",
	"javascript:",
	"data:",
	"file:",
	"mailto:",
	"tel:",
	"magnet:",
	"irc://",
	"ircs://",
	"gopher://",
	"ssh://",
	"tg://",
	"whatsapp://",
}

// dotSubstitutes are the characters spammers use in place of a dot.
//
// Every one of these is a character that renders as a dot or a separator in some
// font, so a human reads "example.com" and a browser loading that string would
// not. The list includes the Unicode MIDDLE DOT and the FULLWIDTH FULL STOP.
var dotSubstitutes = []string{
	"[.]", "(.)", "{.}", "<.>",
	"·", "•", "․", "．", "｡",
	"、", "।", "۔", "·",
}

// spaceChars are the separators used to break a domain into pieces.
//
// The space itself, and then the Unicode ones a spammer reaches for when a space
// is filtered. Zero-width characters are here too: they do not render at all, so
// "exa​mple.com" LOOKS like ordinary text while a normaliser sees a clean domain.
var spaceChars = []string{
	" ", "\t", "\n", "\r",
	" ", " ", " ", " ", " ", " ",
	// Zero-width: space, non-joiner, joiner, no-break space, word joiner,
	// invisible separator, and the bidi marks used to reorder displayed text.
	"​", "‌", "‍", "", "⁠", "⁡", "‪", "‫", "‬", "‭", "‮",
}

// LinkDetection is a found link and where it was.
type LinkDetection struct {
	// Kind is which rule fired, so the refusal can say what it saw.
	Kind string
	// Snippet is the offending text, for the author's benefit.
	Snippet string
}

// ValidateCommentBody checks a proposed comment for links.
//
// Returns an ErrCommentHasLink when the body contains a link-shaped thing, with
// the first detection as the reason. The check is deliberately the FIRST thing
// that runs on the body - before length, before profanity - because a link is the
// only thing here that is a security boundary rather than a preference.
func ValidateCommentBody(body string) error {
	if det, ok := detectLink(body); ok {
		return fmt.Errorf("%w: %s (%s)", ErrCommentHasLink, det.Snippet, det.Kind)
	}
	return nil
}

// detectLink is the detector itself, split from the validator so the tests can
// assert WHAT it found rather than only that it refused.
func detectLink(body string) (LinkDetection, bool) {
	// ---- 1. Schemes. The cheapest check and the most common case. ----
	lower := strings.ToLower(body)
	for _, s := range bannedSchemes {
		if strings.Contains(lower, s) {
			return LinkDetection{Kind: "url scheme", Snippet: snippetAround(body, strings.Index(lower, s), len(s))}, true
		}
	}

	// ---- 2. Normalise away the obfuscations. ----
	//
	// Everything below runs against `flat`, which is the body with dots swapped
	// for real periods and the separator characters deleted. A normaliser that
	// runs FIRST is what makes the bracketed, spaced and zero-width forms the same
	// problem as the plain one, rather than eight separate reg-exps to keep in sync.
	flat := normaliseForLinkDetection(body)
	flatLower := strings.ToLower(flat)

	// ---- 3. www. ----
	if i := strings.Index(flatLower, "www."); i >= 0 {
		if j := endOfDomainish(flatLower, i); j > i+4 {
			return LinkDetection{Kind: "www host", Snippet: flat[i:j]}, true
		}
	}

	// ---- 4. A bare domain with a known TLD. ----
	//
	// Walk the candidates rather than matching one global pattern, because the
	// "no allowed bare domain" rule needs to inspect what FOLLOWS the TLD: a
	// version string and an abbreviation end there, while a real domain carries on
	// into a path or just ends at the word.
	if d, ok := findBareDomain(flatLower); ok {
		return LinkDetection{Kind: "domain", Snippet: d}, true
	}

	// ---- 5. An IP literal. ----
	if d, ok := findIPLiteral(flatLower); ok {
		return LinkDetection{Kind: "ip address", Snippet: d}, true
	}

	return LinkDetection{}, false
}

// normaliseForLinkDetection flattens the obfuscations into plain ASCII.
//
// Two transformations, in order:
//
//	1. Every dot substitute becomes a real ".". This is what reunites
//	   "example[.]com" with "example.com".
//	2. Every separator is REMOVED, not replaced with a space. Replacing would
//	   leave "example . com" which still is not a domain; deleting is what turns
//	   "e x a m p l e . c o m" into "example.com".
//
// Note the ordering matters: a substitute containing a space, "(. )" or
// "[ . ]", needs the substitute handled BEFORE the separators are deleted, or the
// substitute is destroyed and its pieces are re-joined into a plain dot anyway.
func normaliseForLinkDetection(s string) string {
	// Work on the original for dot substitutes, because some of them contain
	// spaces that step 2 would delete.
	out := s
	for _, d := range dotSubstitutes {
		if strings.Contains(out, d) {
			out = strings.ReplaceAll(out, d, ".")
		}
	}
	// Then delete the separators. Runes rather than bytes, because the zero-width
	// and middle-dot characters are multi-byte and a byte-wise delete would leave
	// their continuation bytes behind as garbage.
	var b strings.Builder
	b.Grow(len(out))
	for _, r := range out {
		if isSeparatorRune(r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// isSeparatorRune reports whether r is one of the ignored separator characters.
func isSeparatorRune(r rune) bool {
	for _, s := range spaceChars {
		for _, sr := range s {
			if sr == r {
				return true
			}
		}
	}
	return false
}

// endOfDomainish returns the end index of a run of domain characters.
//
// Stops at the first character that cannot be in a hostname, which is what keeps
// "www.google.com check this out" from being read as "www.google.comcheckthisout".
func endOfDomainish(s string, from int) int {
	i := from
	for i < len(s) {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z',
			c >= '0' && c <= '9',
			c == '.', c == '-':
			i++
			continue
		}
		break
	}
	// Trailing dots and dashes are not part of the host.
	for i > from && (s[i-1] == '.' || s[i-1] == '-') {
		i--
	}
	return i
}

// findBareDomain scans for `label.tld` where the TLD is a COMPLETE token.
//
// The rule that decides everything is at the END of the TLD:
//
//	"example.com"        end of string        -> MATCH (the common case)
//	"example.com/watch"  a path follows       -> MATCH
//	"e.g."               the TLD is not known -> no match
//	"communicatioN.COMx" letters after "com"  -> no match, a longer word
//
// An earlier version required a PATH to follow the TLD, which meant a bare
// "example.com" - the single most common form in a comment - was allowed through.
// The known-TLD list is what makes that rule unnecessary: "e.g." and "U.S.A."
// end in `g` and `S`, neither of which is a TLD, so the list does the work the
// path requirement was doing.
func findBareDomain(lower string) (string, bool) {
	for i := 0; i < len(lower); i++ {
		start := i
		for i < len(lower) && isDomainChar(lower[i]) {
			i++
		}
		// The label must be followed by a dot. Anything else means this position is
		// not a domain start, so move on from here.
		if i >= len(lower) || lower[i] != '.' {
			continue
		}
		label := lower[start:i]
		if label == "" || !hasAlpha(label) {
			continue
		}

		dot := i
		i++ // past the dot
		tldStart := i
		for i < len(lower) && isDomainChar(lower[i]) {
			i++
		}
		tld := lower[tldStart:i]

		if !knownTLDs[tld] {
			// Not a TLD. Rewind to just after the dot so the next iteration starts
			// scanning from the next label, which is what finds `sub.example.video`
			// after `sub.example` fails on "example" not being a TLD.
			i = dot + 1
			continue
		}

		// The TLD must END at a token boundary: end of string, or a character that
		// cannot be part of a hostname. If letters follow, the "TLD" was part of a
		// longer word - "communication", "module", "comply" - and that is not a
		// domain however much it ends like one.
		if i < len(lower) {
			c := lower[i]
			if isDomainChar(c) || c == '-' {
				// Longer word. Keep scanning from after the dot so a later
				// `label.real-tld` in the same string is still found.
				i = dot + 1
				continue
			}
		}

		return lower[start:i], true
	}
	return "", false
}

// findIPLiteral finds an IPv4 or IPv6 literal.
//
// IPv4 only for the practical case, and it requires four octets AND a port or
// path to follow, for the same reason a bare TLD is not enough: "1.2.3.4" alone
// in prose is a version or a measurement far more often than it is an address.
func findIPLiteral(lower string) (string, bool) {
	for i := 0; i+7 < len(lower); i++ {
		if !isDigit(lower[i]) {
			continue
		}
		start := i
		octets := 1
		for i < len(lower) && (isDigit(lower[i]) || lower[i] == '.') {
			if lower[i] == '.' {
				octets++
			}
			i++
		}
		cand := lower[start:i]
		if octets == 4 && i < len(lower) && (lower[i] == ':' || lower[i] == '/') {
			return cand, true
		}
		i--
	}
	return "", false
}

func isDomainChar(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= '0' && c <= '9'
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func hasAlpha(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// snippetAround returns a short window of the original body for the error.
//
// The ORIGINAL, not the normalised text: the author needs to see the thing they
// actually typed, and "your comment contained example[.]com" is useless when they
// see "example.com" in their own draft.
func snippetAround(body string, at, span int) string {
	lo := at - 12
	if lo < 0 {
		lo = 0
	}
	hi := at + span + 12
	if hi > len(body) {
		hi = len(body)
	}
	s := strings.TrimSpace(body[lo:hi])
	// Runewidth is not worth a dependency for this; cap on bytes and say so.
	if len(s) > 60 {
		s = s[:60] + "…"
	}
	return s
}
