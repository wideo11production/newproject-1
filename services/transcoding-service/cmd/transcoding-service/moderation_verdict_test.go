package main

import "testing"

// The moderation verdict rules, tested directly.
//
// These tests exist because of a real failure: an early engine let `skin_tone`
// reject a video on its own at 0.70, and it auto-refused a legitimate upload that
// scored 88.5% - a warm-toned video genuinely has most of its pixels in the skin
// chroma range. Without these tests, the same fix gets undone by the next person
// who adds a check.
//
// The rule being pinned, in one sentence:
//
//	A SINGLE WEAK SIGNAL NEVER REJECTS. Rejection needs an extreme single signal
//	or two or more independent signals firing together.

// makeResult builds the check set a verdict is computed from.
func makeResult(checks ...ModerationCheck) *ModerationResult {
	return &ModerationResult{
		Provider: moderationVersion,
		Checks:   checks,
		Verdict:  "approved",
	}
}

// TestSkinToneAloneNeverRejects is the regression test for the real bug.
//
// A video that is 85% warm-toned pixels is ordinary: a desert, a beach, a wooden
// interior, a close-up of a face in warm light. It must FLAG for a human, not
// refuse the upload.
func TestSkinToneAloneNeverRejects(t *testing.T) {
	skin := func(score float64) ModerationCheck {
		return ModerationCheck{
			Name: "skin_tone", Score: score, FlagAt: 0.45, RejectAt: 0.70,
			Flagged: score >= 0.45, Rejected: score >= 0.70,
			Detail: "warm-toned video",
		}
	}
	for _, score := range []float64{0.50, 0.70, 0.80, 0.885, 0.91} {
		r, _, _ := moderateVerdict(makeResult(skin(score)))
		if r == "rejected" {
			t.Errorf("skin_tone alone at %.2f REJECTED - a single weak signal must never refuse an upload", score)
		}
		if r != "flagged" {
			t.Errorf("skin_tone alone at %.2f -> %s, want flagged", score, r)
		}
	}
}

// TestExtremeSingleSignalRejects is the other half of the rule: a signal far
// past its threshold is not ambiguous and does reject on its own.
func TestExtremeSingleSignalRejects(t *testing.T) {
	skin := func(score float64) ModerationCheck {
		return ModerationCheck{
			Name: "skin_tone", Score: score, FlagAt: 0.45, RejectAt: 0.70,
			Flagged: true, Rejected: score >= 0.70,
			Detail: "essentially the entire frame is skin",
		}
	}
	// 0.92 is the extreme floor: above it, "mostly a body" is no longer a colour
	// question.
	if v, _, _ := moderateVerdict(makeResult(skin(0.95))); v != "rejected" {
		t.Errorf("skin_tone at 0.95 -> %s, want rejected (extreme single signal)", v)
	}
	// And just under it, corroboration is still required.
	if v, _, _ := moderateVerdict(makeResult(skin(0.90))); v == "rejected" {
		t.Errorf("skin_tone at 0.90 -> %s, want flagged (not yet extreme)", v)
	}
	if v, _, _ := moderateVerdict(makeResult(skin(0.90))); v != "flagged" {
		t.Errorf("skin_tone at 0.90 -> %s, want flagged", v)
	}
}

// TestCorroborationRejects pins the combined-signal path.
func TestCorroborationRejects(t *testing.T) {
	check := func(name string, score float64) ModerationCheck {
		return ModerationCheck{Name: name, Score: score, Flagged: true, Detail: name}
	}
	// Two independent weak signals together.
	r, _, _ := moderateVerdict(makeResult(check("skin_tone", 0.60), check("motion_skin", 0.58)))
	if r != "rejected" {
		t.Errorf("two corroborating signals -> %s, want rejected", r)
	}
	// One is not enough.
	r, _, _ = moderateVerdict(makeResult(check("skin_tone", 0.60)))
	if r == "rejected" {
		t.Errorf("one signal -> %s, want flagged", r)
	}
}

// TestSkippedChecksDoNotCorroborate is a subtle and important case.
//
// A skipped check is "we could not measure this", and treating it as a fired
// signal would mean a video with no audio stream gets itself an implicit
// corroborating flag from the check that could not run. Two inconclusive results
// are not a pattern.
func TestSkippedChecksDoNotCorroborate(t *testing.T) {
	skipped := ModerationCheck{Name: "audio_spike", Skipped: true, Reason: "no audio stream"}
	live := ModerationCheck{Name: "skin_tone", Score: 0.60, Flagged: true, Detail: "warm"}

	if v, _, _ := moderateVerdict(makeResult(skipped, live)); v != "flagged" {
		t.Errorf("one live + one skipped -> %s, want flagged (skipped must not corroborate)", v)
	}
	if v, _, _ := moderateVerdict(makeResult(skipped, skipped)); v != "approved" {
		t.Errorf("all skipped -> %s, want approved (nothing was measured)", v)
	}
}

// TestNoChecksApproves covers the degenerate case: a files with no analysable
// streams at all must not be refused, because refusing it would be refusing it
// for a property nobody measured.
func TestNoChecksApproves(t *testing.T) {
	if v, _, _ := moderateVerdict(makeResult()); v != "approved" {
		t.Errorf("no checks -> %s, want approved", v)
	}
}


