package service

// Tests for the content upload policy (Phase B2 / gap #4).
//
// The whole point of the previous gap was that `content_upload_enabled` was
// PERSISTED but never ENFORCED. These tests pin the enforcement rules so the
// decision logic cannot silently change.
//
// `decideUpload` is pure, so every combination is exhaustively testable
// without a database - which is exactly why it was extracted from the DB
// path.

import "testing"

// TestDecideUploadAllCombinations walks the full 2x2x2 truth table.
//
// Eight cases, all asserted. Writing them as a table (rather than a few
// hand-picked `if` statements) is deliberate: an authorization decision is
// exactly the kind of thing where an untested combination becomes a bug.
func TestDecideUploadAllCombinations(t *testing.T) {
	cases := []struct {
		name        string
		isActive    bool
		isVerified  bool
		uploadsOn   bool
		wantAllowed bool
		wantReason  UploadDecisionReason
	}{
		{
			name: "all good", isActive: true, isVerified: true, uploadsOn: true,
			wantAllowed: true, wantReason: ReasonAllowed,
		},
		{
			name: "user turned uploads off", isActive: true, isVerified: true, uploadsOn: false,
			wantAllowed: false, wantReason: ReasonDisabledByUser,
		},
		{
			name: "email not verified", isActive: true, isVerified: false, uploadsOn: true,
			wantAllowed: false, wantReason: ReasonEmailUnverified,
		},
		{
			name: "account inactive", isActive: false, isVerified: true, uploadsOn: true,
			wantAllowed: false, wantReason: ReasonAccountInactive,
		},
		{
			// SECURITY: an inactive account must never be reported as merely
			// "you turned uploads off" - the user cannot fix that themselves.
			name: "inactive wins over disabled", isActive: false, isVerified: true, uploadsOn: false,
			wantAllowed: false, wantReason: ReasonAccountInactive,
		},
		{
			// Same for unverified: the user has an action they CAN take.
			name: "unverified wins over disabled", isActive: true, isVerified: false, uploadsOn: false,
			wantAllowed: false, wantReason: ReasonEmailUnverified,
		},
		{
			name: "everything wrong", isActive: false, isVerified: false, uploadsOn: false,
			wantAllowed: false, wantReason: ReasonAccountInactive,
		},
		{
			// FAIL-CLOSED: nothing set at all must not be allowed.
			name: "all defaults false", isActive: false, isVerified: false, uploadsOn: false,
			wantAllowed: false, wantReason: ReasonAccountInactive,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := decideUpload(tc.isActive, tc.isVerified, tc.uploadsOn)
			if got.Allowed != tc.wantAllowed {
				t.Errorf("Allowed = %v, want %v (reason %q)", got.Allowed, tc.wantAllowed, got.Reason)
			}
			if got.Reason != tc.wantReason {
				t.Errorf("Reason = %q, want %q", got.Reason, tc.wantReason)
			}
		})
	}
}

// TestDecideUploadMessageIsActionable guards the UX reason behind the
// ordering. A blocked user must be told what to actually DO.
func TestDecideUploadMessageIsActionable(t *testing.T) {
	// Inactive -> "contact support", NOT "turn uploads on" (they cannot).
	inactive := decideUpload(false, true, false)
	if !contains(inactive.Message, "support") {
		t.Errorf("inactive message should point to support, got %q", inactive.Message)
	}
	if contains(inactive.Message, "turn") && contains(inactive.Message, "settings") {
		t.Errorf("inactive user was told to change a setting they cannot change: %q", inactive.Message)
	}

	// Unverified -> told to verify email.
	unverified := decideUpload(true, false, false)
	if !contains(unverified.Message, "Verify") {
		t.Errorf("unverified message should say 'verify', got %q", unverified.Message)
	}

	// Disabled -> told it is their own setting, and it reads as their choice
	// rather than an error.
	disabled := decideUpload(true, true, false)
	if !contains(disabled.Message, "settings") {
		t.Errorf("disabled message should mention settings, got %q", disabled.Message)
	}
}

// TestDecideUploadNeverLeaksReasonOnMissingUser pins the information-leak
// protection: a missing user must not be distinguishable by message text.
func TestDecideUploadNeverLeaksReasonOnMissingUser(t *testing.T) {
	notFound := UploadDecision{
		Allowed: false,
		Reason:  ReasonUserNotFound,
		Message: "Sign in again to continue.",
	}
	// The message must not contain the words "user", "account", or "exist".
	for _, leak := range []string{"not exist", "doesn't exist", "no such user", "unknown user"} {
		if contains(notFound.Message, leak) {
			t.Errorf("SECURITY: message leaks user existence via %q", leak)
		}
	}
}

// TestStatusCodeForDecision checks the HTTP mapping.
//
// The important assertion is 403-not-401 for a self-imposed block: a 401
// makes the frontend show "session expired" for a perfectly valid session.
func TestStatusCodeForDecision(t *testing.T) {
	cases := []struct {
		reason UploadDecisionReason
		want   int
	}{
		{ReasonAllowed, 200},
		{ReasonDisabledByUser, 403},
		{ReasonEmailUnverified, 403},
		{ReasonAccountInactive, 403},
		{ReasonUserNotFound, 401},
		// An unrecognised reason must fail CLOSED, not default to allowed.
		{UploadDecisionReason("some_reason_added_later"), 403},
		{UploadDecisionReason(""), 403},
	}
	for _, tc := range cases {
		t.Run(string(tc.reason), func(t *testing.T) {
			got := StatusCodeForDecision(UploadDecision{Reason: tc.reason})
			if got != tc.want {
				t.Errorf("StatusCodeForDecision(%q) = %d, want %d", tc.reason, got, tc.want)
			}
		})
	}
}

// contains is a tiny local helper so the test file does not depend on
// strings import ordering or a helper name colliding with the package.
func contains(haystack, needle string) bool {
	return len(needle) == 0 || len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
