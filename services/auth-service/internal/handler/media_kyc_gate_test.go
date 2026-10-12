package handler

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The KYC gate on the upload path, asserted against the SOURCE.
//
// =============================================================================
// WHY A SOURCE ASSERTION AND NOT A BEHAVIOURAL TEST
// =============================================================================
//
// A behavioural test here would set up a database, mint a token, POST a body, and
// assert a 403. It would pass while nothing else was true - and the thing that
// actually matters is not "this handler can return 403", it is "the gate is on the
// path". A handler that returned 403 for an unrelated reason would pass the
// behavioural test just as well.
//
// The gate itself is pure logic with a testable decision function
// (`decideUpload`), and THAT is asserted in `service/content_policy_test.go`.
// What is missing, and what had been missing since the policy was written, is the
// call.
//
// =============================================================================
// WHAT WAS ACTUALLY BROKEN
// =============================================================================
//
// `service/content_policy.go` documents a gate in its own header:
//
//	"Isko upload handler ke SABSE PEHLE call karna hai, koi side effect karne
//	 se PEHLE (jaise presigned URL issue karna, ya DB me row insert karna)."
//
// And `TestEveryTableNameIsProvisioned`-style discovery aside, nothing called it.
// The file said so itself: "ye policy abhi tak kisi route par call nahi ho rahi".
//
// So an inactive account could upload. An UNVERIFIED account could upload. And a
// user who had turned uploads OFF in their own settings could upload - the toggle
// was a UI element with no server behind it, which is exactly the "persisted but
// inert" state that file was written to prevent.
//
// The upload path has since grown presigned URLs, a state machine, a transcode
// handoff and a moderation scan. The gate is what sits in front of all of them.

// readMediaHandler reads the media route file, minus comments.
//
// Comments are stripped for the reason `testsupport_test.go` spells out: the
// repository has been bitten six times by a comment that describes the correct
// behaviour sitting next to code that does something else. Asserting over a file
// with comments attached would let this test pass against documentation.
func readMediaHandler(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "handler", "media_routes.go"))
	if err != nil {
		t.Fatalf("read media_routes.go: %v", err)
	}
	return stripComments(string(raw))
}

// TestInitMediaWiresTheUploadGate is the regression test for an unwired gate.
//
// `RequireContentUpload` existed, was documented as "call this first", and had no
// caller. The assertion is that `InitMedia` now calls it.
func TestInitMediaWiresTheUploadGate(t *testing.T) {
	src := readMediaHandler(t)

	// Pull out the `InitMedia` function body. A whole-file grep would pass if the
	// gate were wired into some other handler in the file.
	start := strings.Index(src, "func (h *AuthHandler) InitMedia(")
	if start < 0 {
		t.Fatal("InitMedia not found in media_routes.go")
	}
	body := src[start:]
	if end := strings.Index(body, "\nfunc "); end > 0 {
		body = body[:end]
	}

	if !strings.Contains(body, "RequireContentUpload(") {
		t.Error("InitMedia does not call RequireContentUpload.\n" +
			"The upload policy in service/content_policy.go says the gate must be the " +
			"first call on this path, before a presigned URL is minted and before the " +
			"row is inserted. Without it an inactive, unverified, or opted-out user " +
			"still uploads - and the bytes, the transcode and the moderation scan all " +
			"run before anyone notices.")
	}

	// And it must be wired to the HTTP response, not merely called. A call whose
	// result is discarded is the same as no call.
	if !strings.Contains(body, "StatusCodeForDecision(") {
		t.Error("InitMedia calls RequireContentUpload but does not use " +
			"StatusCodeForDecision to translate the verdict into a status code.\n" +
			"A decision that is never applied is a gate that is open.")
	}
}

// TestUploadGateIsCheckedBeforeThePresignedURL pins the ORDER, which is the part
// that makes the gate worth having.
//
// Refusing an unverified upload at `finalize` still defeats the purpose: by then
// the bytes are in the bucket, the row exists and the transcode is running. The
// only thing a late refusal achieves is having paid for the compute.
func TestUploadGateIsCheckedBeforeThePresignedURL(t *testing.T) {
	src := readMediaHandler(t)

	start := strings.Index(src, "func (h *AuthHandler) InitMedia(")
	if start < 0 {
		t.Fatal("InitMedia not found")
	}
	body := src[start:]
	if end := strings.Index(body, "\nfunc "); end > 0 {
		body = body[:end]
	}

	gate := strings.Index(body, "RequireContentUpload(")
	presign := strings.Index(body, "CreateMediaUploadTicket(")
	if gate < 0 {
		t.Fatal("the gate is not wired at all - see TestInitMediaWiresTheUploadGate")
	}
	if presign >= 0 && presign < gate {
		t.Error("the presigned URL is minted BEFORE the upload gate runs.\n" +
			"Order is the whole reason the gate exists: a refused upload should never " +
			"have cost a URL, and an unverified upload should never have cost a " +
			"transcode.")
	}

	// The dedup reuse path is also a way to write a row, so the gate must be ahead
	// of it too - otherwise an unverified user with a reusable file still gets an
	// asset row.
	reuse := strings.Index(body, "h.media.Reuse(")
	if reuse >= 0 && reuse < gate {
		t.Error("the reuse path writes an asset row BEFORE the upload gate runs.")
	}
}
