package main

// ============================================================================
// PROHIBITED CONTENT ENGINE - the line-by-line half of the screening pipeline
// ============================================================================
//
// WHAT THIS IS FOR
//
// The pipeline splits an upload into three streams (see moderation.go):
//
//	visual  ->  this file's sibling, FRAME BY FRAME
//	audio   ->  transcribed to text, then LINE BY LINE
//	text    ->  title, description, channel metadata, LINE BY LINE
//
// This file is the third stream, and it answers the question the pixel checks
// cannot: whether the upload is ABOUT something prohibited. A perfectly framed,
// well-lit, well-exposed video of a person describing how to buy a controlled
// substance passes every visual test and is still a violation.
//
// ============================================================================
// WHY A LEXICON AND NOT AN EMBEDDING MODEL
//
// Three reasons, in order of weight:
//
//  1. NO NETWORK. A cloud moderation API means every upload's verdict depends on
//     a vendor being up, and an outage that silently approves everything is the
//     same outage as one that silently blocks everything. Both are undetectable
//     from inside this service.
//
//  2. NO SOURCE OF TRUTH. A cloud verdict is a number from a black box. When a
//     creator asks "why was my video refused", "0.97" is not an answer and "this
//     classifier said so" is not a reason that can be checked.
//
//  3. THE BANDS ARE AUDITABLE. A lexicon can be read, diffed and reviewed by a
//     human. A weight cannot.
//
// The known cost: a lexicon misses paraphrase and code-words. That is a RECALL
// problem, not a correctness one, and it fails SAFE - an unmatched phrase falls
// through to the pixel and corroboration rules rather than being approved on the
// strength of a missed synonym. The engine is deliberately biased toward FLAGGING
// rather than approving, because a human reviewing a flag costs a minute and a
// false approval costs the platform.
//
// ============================================================================
// THE FALSE-POSITIVE PROBLEM, AND HOW IT IS HANDLED
//
// The obvious failure is a word that is also ordinary language. "Cocaine" is
// unambiguous, but "high", "hit", "dose", "crack", "stuff" and "joint" all appear
// in entirely innocent sentences about weather, sport and cooking.
//
// So terms are graded:
//
//	STRONG  - one occurrence is enough to flag this category
//	WEAK    - needs corroboration from another term or another stream
//
// And a WEAK term never rejects on its own. That single rule is what keeps a
// channel called "Shot On iPhone" out of the drugs queue, and it is why the
// lexicon below is verbose about which is which.
//
// ============================================================================
// WHAT IS DELIBERATELY NOT IN THE LEXICON
// ============================================================================
//
// Terms naming real people, groups, slurs against protected classes, and specific
// terrorist organisation names. A static list of those is a liability: it goes
// stale, it is trivially evaded by a spelling variant, and shipping one in a repo
// makes the repo itself the distribution channel for the list.
//
// The engine therefore grades on the STRUCTURE of a prohibited reference - the
// metadata vocabulary around it - rather than on the identity of the named entity.
// Those terms belong in a managed, versioned policy feed, not in source code.

import "strings"

// ProhibitedCategory is one of the zero-tolerance buckets the platform enforces.
//
// The strings are stored verbatim in the moderation reason and surfaced to the
// creator, so they are written as human-readable identifiers rather than
// abbreviations.
type ProhibitedCategory string

const (
	// CatAdultery covers nudity, pornography, explicit sexual acts and suggestive
	// adult content.
	CatAdultery ProhibitedCategory = "adultery_and_sexually_explicit_content"

	// CatRiots covers civil unrest, riots, looting and the glorification of
	// physical violence.
	CatRiots ProhibitedCategory = "riots_and_public_violence"

	// CatTerrorism covers extremist propaganda, recruitment, manifestos and the
	// glorification of designated organisations.
	CatTerrorism ProhibitedCategory = "terrorist_activities_and_extremism"

	// CatDrugs covers the promotion, sale and depiction of controlled substances.
	CatDrugs ProhibitedCategory = "drugs_and_illegal_substances"

	// CatHate covers hate speech, harassment and dehumanisation.
	CatHate ProhibitedCategory = "hate_speech_and_harassment"

	// CatDanger covers dangerous acts, self-harm instruction and graphic content.
	CatDanger ProhibitedCategory = "dangerous_and_graphic_content"
)

// prohibitedTerm is one graded phrase.
//
// `Term` is matched as a whole word, not a substring - see matchTerm. `Weight`
// is how much this term contributes to its category's score, and `Strong` is
// whether it can carry the category on its own.
type prohibitedTerm struct {
	Term   string
	Weight float64
	Strong bool
}

// prohibitedLexicon is the graded vocabulary, per category.
//
// Ordered from strongest to weakest within each category, so a reader sees what
// carries a verdict before what merely contributes to one.
var prohibitedLexicon = map[ProhibitedCategory][]prohibitedTerm{
	// ---- ADULTERY & SEXUALLY EXPLICIT CONTENT ----
	//
	// STRONG terms are unambiguous. The WEAK terms are words that appear in
	// ordinary speech and are only indicative in combination - which is why they
	// are weight 0.15 and cannot reject alone.
	CatAdultery: {
		{"porn", 1.0, true},
		{"pornography", 1.0, true},
		{"nudes", 0.9, true},
		{"nude", 0.8, true},
		{"sex tape", 1.0, true},
		{"sexual act", 1.0, true},
		{"explicit sexual", 1.0, true},
		{"xxx", 0.9, true},
		{"nsfw", 0.8, true},
		{"onlyfans", 0.7, true},
		{"escort", 0.5, false},
		{"sensual", 0.15, false},
		{"seductive", 0.15, false},
	},

	// ---- RIOTS & PUBLIC VIOLENCE ----
	//
	// Note what is NOT here: words like "protest", "march", "rally", "unrest" and
	// "clash". All of them describe lawful assembly and neutral reporting, and
	// their presence in a news report about a protest is not a violation. The
	// category is about GLORIFICATION and incitement, not about the underlying
	// event - which is why the WEAK terms below are all verbs of escalation rather
	// than nouns of assembly.
	CatRiots: {
		{"riot", 0.9, true},
		{"rioting", 0.9, true},
		{"looting", 0.8, true},
		{"loot", 0.6, false},
		{"pillage", 0.9, true},
		{"burn down", 0.8, true},
		{"set fire", 0.7, true},
		{"mob violence", 1.0, true},
		{"beat him", 0.5, false},
		{"beat her", 0.5, false},
		{"kill them", 0.7, false},
		{"burn it down", 0.7, false},
		{"destroy the city", 0.6, false},
	},

	// ---- TERRORIST ACTIVITIES & EXTREMISM ----
	//
	// No organisation names and no group identifiers - see the note at the top of
	// this file. This is the vocabulary of RECRUITMENT, MANIFESTO and PROPAGANDA,
	// which is the structural signal and is not entity-specific.
	CatTerrorism: {
		{"jihad", 0.9, true},
		{"martyrdom", 0.8, true},
		{"martyr operation", 1.0, true},
		{"join the caliphate", 1.0, true},
		{"holy war", 0.7, true},
		{"manifesto", 0.4, false},
		{"propaganda", 0.4, false},
		{"glorify the attack", 0.9, true},
		{"praise the attack", 0.8, true},
		{"lone wolf", 0.5, false},
		{"infidel", 0.6, false},
	},

	// ---- DRUGS & ILLEGAL SUBSTANCES ----
	//
	// The list is about PROHIBITED SUBSTANCES and TRANSACTION language. Words
	// like "high", "hit", "dose", "fix", "gear", "stuff", "crack" (as in a crack in
	// a wall) and "joint" (as in a joint of meat) are deliberately excluded: all of
	// them occur constantly in innocent speech, and including them would route
	// ordinary cooking and carpentry content into a drugs queue.
	CatDrugs: {
		{"cocaine", 1.0, true},
		{"heroin", 1.0, true},
		{"methamphetamine", 1.0, true},
		{"meth lab", 1.0, true},
		{"fentanyl", 0.9, true},
		{"crack cocaine", 1.0, true},
		{"buy drugs", 1.0, true},
		{"sell drugs", 1.0, true},
		{"drug dealer", 0.9, true},
		{"drug dealing", 0.9, true},
		{"cannabis farm", 0.7, false},
		{"grow weed", 0.6, false},
		{"dealer", 0.4, false},
		{"narcotics", 0.5, false},
	},

	// ---- HATE SPEECH & HARASSMENT ----
	//
	// No slurs - see the note at the top of this file. This grades the STRUCTURE
	// of dehumanisation ("they are vermin") and explicit incitement, which are
	// recognisable without naming an identity.
	CatHate: {
		{"subhuman", 0.9, true},
		{"vermin", 0.8, true},
		{" exterminate", 0.8, true},
		{"gas them", 1.0, true},
		{"burn them alive", 1.0, true},
		{"kill all", 0.7, true},
		{"hate speech", 0.6, false},
		{"racial slur", 0.5, false},
		{"dogwhistle", 0.3, false},
	},

	// ---- DANGEROUS & GRAPHIC CONTENT ----
	//
	// Instruction language rather than outcome language: "how to make a bomb" is a
	// violation, "bomb" alone is a news report about one.
	CatDanger: {
		{"how to make a bomb", 1.0, true},
		{"pipe bomb", 1.0, true},
		{"build a bomb", 1.0, true},
		{"make napalm", 1.0, true},
		{"nerve agent", 0.9, true},
		{"ricin", 0.9, true},
		{"self harm", 0.7, true},
		{"suicide method", 0.9, true},
		{"how to hotwire", 0.6, false},
		{"lockpick", 0.4, false},
	},
}

// flaggedLine is one line that matched, so the reason can quote it.
//
// A creator who is told only a category name has to guess which sentence caused
// it. A quoted line makes the refusal actionable and makes the engine auditable.
type flaggedLine struct {
	// LineNumber is 1-based, matching what an editor shows.
	LineNumber int `json:"line_number"`
	// Line is the matched line, trimmed and capped in length.
	Line string `json:"line"`
	// Category is which bucket this line contributed to.
	Category ProhibitedCategory `json:"category"`
	// Term is the phrase that matched.
	Term string `json:"term"`
	// Weight is how much this match contributed.
	Weight float64 `json:"weight"`
}

// textModerationResult is the verdict for one text stream.
type textModerationResult struct {
	// Per-category score, 0..1-ish. A category above CatFlagAt is flagged.
	Scores map[ProhibitedCategory]float64 `json:"scores"`
	// Matches are every line that fired, capped - see maxFlaggedLines.
	Matches []flaggedLine `json:"matches,omitempty"`
	// Fired lists the categories that crossed the flag threshold.
	Fired []ProhibitedCategory `json:"fired,omitempty"`
	// Rejected lists the categories that crossed the reject threshold.
	Rejected []ProhibitedCategory `json:"rejected,omitempty"`
	// Lines is how many non-empty lines were examined.
	Lines int `json:"lines"`
}

// Category thresholds.
//
// Split from the pixel checks because the two streams have different scales: a
// lexicon match is discrete (it either fired or it did not), while a skin ratio is
// continuous. Applying one threshold pair to both would be wrong for one of them.
const (
	// textFlagAt: a category crosses this when a STRONG term fires once, or when
	// the summed WEAK terms reach it. Set so that exactly one strong term crosses.
	textFlagAt = 0.85

	// textRejectAt: a category crosses this on an unambiguous term, or on enough
	// weak terms to be a pattern. A creator gets one flag per category, not one
	// per line, so a long text that repeats a weak term does not accumulate into a
	// rejection.
	textRejectAt = 0.95

	// maxFlaggedLines caps how many matches are reported. A 10,000-line transcript
	// that matches on every line would produce a result the database cannot store
	// and the screen cannot show.
	maxFlaggedLines = 20

	// maxLineLength caps a quoted line, for the same reason.
	maxLineLength = 160
)

// moderateText runs the line-by-line screen over one text stream.
//
// `label` describes the stream for the reason ("title", "transcript", "channel
// metadata"). It is only used in messages, so a caller may pass an empty string.
//
// The text is examined LINE BY LINE and not as a blob, for two reasons that both
// matter in practice:
//
//  1. A transcript is line-per-caption. Matching per line means a single bad
//     caption is one flag in one place, not a match attached to 40 seconds of
//     otherwise innocent speech.
//
//  2. A quoted line is only meaningful if the match is IN that line. Blob
//     matching would let a reason point at a document rather than a sentence.
func moderateText(text, label string) textModerationResult {
	out := textModerationResult{
		Scores: map[ProhibitedCategory]float64{},
	}

	if strings.TrimSpace(text) == "" {
		return out
	}

	// Split on newlines only, not on any Unicode line break. A caption file is
	// already newline-separated, and splitting on every line-break variant would
	// fragment words that the transcript writer joined deliberately.
	rawLines := strings.Split(text, "\n")

	// Per-category, whether a STRONG term has already fired. A second strong term
	// in the same category must not push the score past reject by accumulation -
	// one unambiguous term is a verdict, and ten of them is still one verdict.
	strongSeen := map[ProhibitedCategory]bool{}

	for i, raw := range rawLines {
		// Trim, and skip the line entirely if it is empty. A transcript has blank
		// separator lines, and an empty line that matches nothing still costs a
		// lookup.
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" {
			continue
		}
		out.Lines++

		lower := strings.ToLower(line)

		for cat, terms := range prohibitedLexicon {
			for _, t := range terms {
				if !matchTerm(lower, t.Term) {
					continue
				}

				// A strong term caps the category at its reject threshold directly.
				if t.Strong {
					strongSeen[cat] = true
					out.Scores[cat] = textRejectAt
				} else if !strongSeen[cat] {
					// Weak terms accumulate, but only up to the flag line. Without the
					// cap, a text that repeats "sensual" on 40 lines would accumulate
					// into a rejection, and 40 weak matches is not a pattern - it is one
					// weak match, forty times.
					acc := out.Scores[cat] + t.Weight
					if acc > textFlagAt {
						acc = textFlagAt
					}
					out.Scores[cat] = acc
				}

				if len(out.Matches) < maxFlaggedLines {
					out.Matches = append(out.Matches, flaggedLine{
						LineNumber: i + 1,
						Line:       truncateLine(line, maxLineLength),
						Category:   cat,
						Term:       t.Term,
						Weight:     t.Weight,
					})
				}
			}
		}
	}

	for cat, score := range out.Scores {
		if score >= textRejectAt {
			out.Rejected = append(out.Rejected, cat)
		} else if score >= textFlagAt {
			out.Fired = append(out.Fired, cat)
		}
	}

	_ = label
	return out
}

// matchTerm reports whether `line` contains `term` as a WHOLE WORD.
//
// Substring matching is the obvious implementation and it is wrong in both
// directions:
//
//	"high" is a substring of "highlight", "higher" and "highway"
//	"dose" is a substring of "dossier" and "gloucester"
//
// So the boundaries are checked. A term that contains its own spaces ("buy drugs")
// is matched across the whole phrase, which still works because the boundaries are
// the edges of the phrase.
func matchTerm(line, term string) bool {
	at := 0
	for {
		idx := strings.Index(line[at:], term)
		if idx < 0 {
			return false
		}
		start := at + idx
		end := start + len(term)

		// The byte before and after must not be a word character.
		beforeOk := start == 0 || !isWordByte(line[start-1])
		afterOk := end >= len(line) || !isWordByte(line[end])

		if beforeOk && afterOk {
			return true
		}
		at = start + 1
		if at >= len(line) {
			return false
		}
	}
}

// isWordByte reports whether b can be part of a word.
//
// Apostrophes are excluded on purpose: "don't" is two words for matching purposes,
// and a term that spans an apostrophe should not match. Accented letters and
// non-Latin scripts ARE word bytes, so a term still matches inside a word in
// another writing system.
func isWordByte(b byte) bool {
	switch {
	case b >= 'a' && b <= 'z':
		return true
	case b >= 'A' && b <= 'Z':
		return true
	case b >= '0' && b <= '9':
		return true
	case b == '_' || b == '-':
		return true
	case b >= 0x80:
		// A UTF-8 continuation or lead byte: part of a non-ASCII character.
		return true
	default:
		return false
	}
}

func truncateLine(s string, max int) string {
	if len(s) <= max {
		return s
	}
	// Trim on a rune boundary so a multi-byte character is not cut in half and
	// rendered as a replacement glyph.
	cut := max
	for cut > 0 && s[cut] >= 0x80 && s[cut] < 0xC0 {
		cut--
	}
	return s[:cut] + "…"
}

// mergeTextResults folds several text streams into one.
//
// The pipeline screens a transcript, a title, a description and the channel
// metadata. Each is a separate `moderateText` call, and the merged result is what
// the decision matrix sees - so a category flagged in two streams is still ONE
// category flagged, not two.
func mergeTextResults(results ...textModerationResult) textModerationResult {
	out := textModerationResult{Scores: map[ProhibitedCategory]float64{}}
	for _, r := range results {
		out.Lines += r.Lines
		for cat, score := range r.Scores {
			if score > out.Scores[cat] {
				out.Scores[cat] = score
			}
		}
		// Matches are appended in stream order, so a quoted line is still traceable
		// to the stream it came from by its position.
		remaining := maxFlaggedLines - len(out.Matches)
		if remaining > 0 && len(r.Matches) > 0 {
			if len(r.Matches) > remaining {
				r.Matches = r.Matches[:remaining]
			}
			out.Matches = append(out.Matches, r.Matches...)
		}
	}
	for cat, score := range out.Scores {
		if score >= textRejectAt {
			out.Rejected = append(out.Rejected, cat)
		} else if score >= textFlagAt {
			out.Fired = append(out.Fired, cat)
		}
	}
	return out
}
