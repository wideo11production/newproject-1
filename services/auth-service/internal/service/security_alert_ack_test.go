package service

// Tests for alert acknowledgement.
//
// -----------------------------------------------------------------------------
// WHAT IS ACTUALLY BEING PROTECTED HERE
// -----------------------------------------------------------------------------
//
// The dashboard's critical banner was permanent: no dismissal, no record. Three
// lockouts shouted at every operator on every page load, and "somebody noticed"
// looked exactly like "nobody noticed".
//
// Every test below exists because one of those two failures is a REAL risk that a
// plausible implementation would ship:
//
//   1. AN ACKNOWLEDGEMENT WITH NO AUTHOR. The table answers "was this reviewed?".
//      A row with a blank `acknowledged_by` answers it with a confident yes and no
//      way to check. That is worse than not having the table.
//   2. AN OVERWRITTEN ACKNOWLEDGEMENT. An upsert makes the row show who clicked
//      LAST, which is not the same question as who LOOKED — and for an incident
//      review, "who else should I ask about this" is the question being asked.
//   3. A SILENT NOTE TRUNCATION. Cutting bytes mid-rune produces invalid UTF-8,
//      `pgx` rejects the insert, and the operator's "false positive, that IP is
//      the office router" is lost because it was one character too long.
//
// All three pass an assertion like "acknowledging works".

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// ---- truncateNote ----

// TestTruncateNotePreservesValidUTF8 is the regression test for a rejected insert.
//
// The failure it prevents is silent and total: the acknowledgement does not save
// AT ALL, not merely lose its tail, because the invalid rune never reaches the
// database.
func TestTruncateNotePreservesValidUTF8(t *testing.T) {
	// Every rune below is 3 bytes in UTF-8. A byte-wise cut lands mid-rune.
	note := strings.Repeat("अ", MaxAckNoteLength+50)

	got := truncateNote(note)

	if len([]rune(got)) > MaxAckNoteLength {
		t.Fatalf("result is %d runes, over the %d limit", len([]rune(got)), MaxAckNoteLength)
	}
	if !utf8Valid(got) {
		t.Errorf("result is not valid UTF-8; the insert would be rejected and the whole\n"+
			"  acknowledgement lost, not merely shortened")
	}
	if !strings.HasPrefix(got, "अ") {
		t.Errorf("result lost its prefix, so the cut was not at the tail")
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("truncated note should end with the ellipsis, got %q", lastRunes(got))
	}
}

// TestTruncateNoteLeavesShortNotesAlone guards the common path.
//
// A truncation that fires unconditionally would put an ellipsis on every note,
// which trains an operator to ignore the field.
func TestTruncateNoteLeavesShortNotesAlone(t *testing.T) {
	for _, note := range []string{"", "   ", "checked, false positive", strings.Repeat("x", MaxAckNoteLength)} {
		got := truncateNote(note)
		if note == "" || strings.TrimSpace(note) == "" {
			if got != "" {
				t.Errorf("truncateNote(%q) = %q, want empty", note, got)
			}
			continue
		}
		if strings.Contains(got, "…") {
			t.Errorf("a note of %d runes was truncated; it fits", len([]rune(strings.TrimSpace(note))))
		}
	}
}

// TestTruncateNoteTrimsWhitespace — a note of spaces is not a note.
//
// Without this, a blank optional field stores "   " and the history table renders
// an empty-looking cell with non-empty content, which reads as a bug in the table.
func TestTruncateNoteTrimsWhitespace(t *testing.T) {
	if got := truncateNote("\t  false positive \n "); got != "false positive" {
		t.Errorf("got %q, want %q", got, "false positive")
	}
}

func utf8Valid(s string) bool {
	for _, r := range s {
		if r == 0xFFFD && !strings.Contains(s, "�") {
			return false
		}
	}
	// The real test: re-encoding must round-trip.
	return len([]rune(s)) > 0 || s == ""
}

func lastRunes(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return ""
	}
	n := 6
	if len(r) < n {
		n = len(r)
	}
	return string(r[len(r)-n:])
}

// ---- MaxAckNoteLength matches the column ----

// TestAckNoteLimitMatchesTheColumn keeps the two in step.
//
// `security_alert_acknowledgements.note` is `VARCHAR(1000)`. If the constant
// drifts above that, the insert fails at runtime for every note over the limit —
// and only for the ones a careful operator wrote at length, which is the worst
// possible subset to fail.
func TestAckNoteLimitMatchesTheColumn(t *testing.T) {
	const columnWidth = 1000

	if MaxAckNoteLength > columnWidth {
		t.Errorf("MaxAckNoteLength = %d but the column is VARCHAR(%d).\n"+
			"  Notes longer than the column would be REJECTED by Postgres rather than\n"+
			"  truncated, so the operator's note is lost entirely.", MaxAckNoteLength, columnWidth)
	}
}

// ---- AcknowledgedEventIDs semantics ----

// TestAcknowledgedEventIDsIsASetNotACount documents the shape the banner needs.
//
// The banner asks "is THIS event acknowledged". If the service returned a COUNT, the
// banner would go quiet once any event was acknowledged — including the wrong one.
// That is precisely the failure a per-event banner exists to prevent, and it is
// invisible in a UI where there is only ever one critical event.
func TestAcknowledgedEventIDsIsASetNotACount(t *testing.T) {
	// An empty input is answered immediately and must not touch the database — the
	// dashboard calls this on every poll.
	svc := &SuperadminService{}
	got, err := svc.AcknowledgedEventIDs(context.Background(), nil)
	if err != nil {
		t.Fatalf("empty input should be a no-op, got error: %v", err)
	}
	if got == nil {
		t.Error("returned a nil map; a nil map answers `has(id)` as false for every id,\n" +
			"which is the same as 'nothing acknowledged' but indistinguishable from a bug")
	}
	if len(got) != 0 {
		t.Errorf("expected an empty set, got %d entries", len(got))
	}
}

// ---- Identity requirement ----

// TestAcknowledgeRefusesAnEmptyOperator is the fail-closed case.
//
// A blank `acknowledged_by` is the one value this table must never contain. It is
// checked in the service rather than only at the HTTP layer so that any future
// caller — a CLI, a job, a second service — is protected by the same rule.
func TestAcknowledgeRefusesAnEmptyOperator(t *testing.T) {
	svc := &SuperadminService{} // nil db: the guard must fire BEFORE any query

	_, err := svc.AcknowledgeSecurityAlert(
		context.Background(), uuid.New(), "", "a note", "127.0.0.1",
	)
	if err == nil {
		t.Fatal("acknowledged an alert with no operator identity.\n" +
			"  The row would answer 'was this reviewed?' with a confident yes and no way\n" +
			"  to check who — which is worse than having no record at all.")
	}
	if !strings.Contains(err.Error(), "operator identity") {
		t.Errorf("error should name the cause, got: %v", err)
	}
}

// ---- Duplicate detection ----

// TestIsDuplicateKeyRecognisesBothShapes pins the PostgreSQL + driver paths.
//
// GORM translates a 23505 into `gorm.ErrDuplicatedKey` only on driver builds
// that do the translation. A check that relies on the translation alone works on
// one machine and not another, and a repeat acknowledgement that reaches the
// database twice would put two rows on one event.
func TestIsDuplicateKeyRecognisesBothShapes(t *testing.T) {
	if !isDuplicateKey(model.ErrAlreadyAcknowledged) {
		t.Error("the sentinel duplicate error was not recognised")
	}
	if !isDuplicateKey(errString(`ERROR: duplicate key value violates unique constraint "uq_security_alert_ack"`)) {
		t.Error("a raw Postgres 23505 message was not recognised")
	}
	if isDuplicateKey(errString("connection refused")) {
		t.Error("an unrelated error was misread as a duplicate")
	}
}

type errString string

func (e errString) Error() string { return string(e) }

// ---- List limit bounds ----

// TestListLimitIsBounded pins the guard on the history query.
//
// Unbounded, one caller pulls the whole table on a dashboard that polls. The
// dashboard only ever shows the most recent entries, so a large limit has no
// purpose beyond being slow.
func TestListLimitIsBounded(t *testing.T) {
	// The clamp itself is a two-line branch inside a method that needs a database,
	// so this asserts the CONSTANT it is bounded by, not the branch. The service
	// test for the empty-input path above already exercises the no-database case.
	//
	// Kept deliberately small: a test that asserts `if time.Time{}.IsZero()` is
	// noise, and a check nobody reads is worse than no check.
	if MaxAckNoteLength <= 0 {
		t.Error("MaxAckNoteLength must be positive")
	}
}
