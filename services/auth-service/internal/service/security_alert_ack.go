package service

// Acknowledging, and listing, critical security alerts.
//
// -----------------------------------------------------------------------------
// WHY THIS IS NOT A FIELD ON `security_events`
// -----------------------------------------------------------------------------
//
// The obvious design is `security_events.acknowledged_at` plus
// `acknowledged_by`. It is worse for three reasons, and each one has bitten
// somewhere in this codebase already:
//
//  1. IT MIXES TWO DIFFERENT FACTS INTO ONE ROW. An audit log should describe
//     what HAPPENED. "Somebody looked at this" happened on a different day, to a
//     different actor, with an optional note. Written into the event row, the
//     event stops being a record of an event and becomes a record of two events.
//
//  2. RETENTION DELETES IT. The sweeper removes `security_events` older than the
//     configured window. An in-row acknowledgement goes with it, and the fact that
//     a human reviewed a lockout eight months ago — which is exactly what an
//     incident review is looking for — becomes unrecoverable as a side effect of a
//     housekeeping decision.
//
//  3. RETRY AND DOUBLE-CLICK. A separate table with a unique constraint on
//     `event_id` makes a repeat acknowledgement a clean 409. A column updated
//     in place makes it a silent no-op that overwrites the first operator's name
//     and timestamp, so the record shows the LAST person to click rather than
//     everyone who looked.
//
// A separate table also means the acknowledgement history has its own lifetime,
// which is the property that makes it useful.

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// ErrAckAlreadyDone is returned when an event has already been acknowledged.
var ErrAckAlreadyDone = errors.New("security alert already acknowledged")

// ErrAckNotFound is returned for an event id that does not exist.
//
// Checked explicitly rather than letting the unique constraint absorb it: a
// duplicate and a typo'd uuid produce the same database error, and answering
// "already acknowledged" to somebody who passed a bad id is worse than useless.
var ErrAckNotFound = errors.New("security event not found")

// MaxAckNoteLength bounds the operator note.
//
// 1000 to match `security_events.detail`, the field this is read beside. Truncating
// an operator's note is mildly rude; accepting an unbounded one is how a
// "acknowledged" row becomes a data-exfiltration channel.
const MaxAckNoteLength = 1000

// AcknowledgeSecurityAlert records that `operatorEmail` has seen a critical event.
//
// ---------------------------------------------------------------------------
// IT IS AN INSERT, NOT AN UPDATE, AND THE UNIQUE CONSTRAINT IS THE POINT
// ---------------------------------------------------------------------------
//
// A repeat acknowledgement returns `ErrAckAlreadyDone`. The handler maps that to a
// 409 with an explanation, and the UI treats it as success — because for the
// operator's intent, "already done" IS done, and an error dialog telling somebody
// their click did not register is a worse outcome than the click being redundant.
//
// The alternative — upsert, last write wins — was rejected because it destroys the
// accountability this table exists to provide: with an upsert you cannot tell who
// actually looked, only who looked LAST.
func (s *SuperadminService) AcknowledgeSecurityAlert(
	ctx context.Context,
	eventID uuid.UUID,
	operatorEmail string,
	note string,
	ipAddress string,
) (*model.SecurityAlertAcknowledgement, error) {
	if operatorEmail == "" {
		// Fail closed. An acknowledgement with no author is exactly the record this
		// table must never contain — it would answer "was this reviewed?" with a
		// confident yes and no way to check.
		return nil, errors.New("acknowledgement requires an operator identity")
	}

	// ---- The event must exist ----
	var existing model.SecurityEvent
	if err := s.db.WithContext(ctx).Where("id = ?", eventID).First(&existing).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAckNotFound
		}
		return nil, err
	}

	ack := &model.SecurityAlertAcknowledgement{
		ID:             uuid.New(),
		EventID:        eventID,
		AcknowledgedBy: operatorEmail,
		Note:           truncateNote(note),
		AcknowledgedAt: time.Now().UTC(),
		IPAddress:      truncateStr(ipAddress, 64),
	}

	if err := s.db.WithContext(ctx).Create(ack).Error; err != nil {
		if isDuplicateKey(err) {
			return nil, ErrAckAlreadyDone
		}
		return nil, err
	}
	return ack, nil
}

// isDuplicateKey recognises a unique-constraint violation.
//
// PostgreSQL raises `23505` and GORM surfaces it as `gorm.ErrDuplicatedKey` when
// the driver translates it. Both are checked because the translation depends on
// the driver build, and a check that works on one machine and not another is worse
// than one that checks both.
func isDuplicateKey(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	return strings.Contains(strings.ToUpper(err.Error()), "DUPLICATE KEY")
}

// ListSecurityAlertAcknowledgements returns the acknowledgement history, newest
// first, joined with the events they refer to.
//
// LEFT JOIN, always. An acknowledgement whose event has been archived by retention
// must still appear: losing a history entry because a housekeeping job ran is a
// regression in the audit trail, and it is exactly the sort of thing that is only
// noticed during an incident review.
func (s *SuperadminService) ListSecurityAlertAcknowledgements(
	ctx context.Context,
	limit int,
) ([]model.AcknowledgementWithEvent, error) {
	if limit <= 0 || limit > 500 {
		// Bounded on both sides. Unbounded lets one caller pull the whole table;
		// and the dashboard shows the most recent entries, so a large limit has no
		// purpose beyond being slow.
		limit = 200
	}

	var rows []model.AcknowledgementWithEvent

	err := s.db.WithContext(ctx).
		Table("security_alert_acknowledgements AS ack").
		Select(`ack.id, ack.event_id, ack.acknowledged_by, ack.note,
		        ack.acknowledged_at, ack.ip_address,
		        COALESCE(ev.event_type, '')     AS event_type,
		        COALESCE(ev.detail, '')        AS detail,
		        COALESCE(ev.email, '')         AS event_email,
		        COALESCE(ev.ip_address, '')    AS event_ip,
		        ev.timestamp                   AS event_at,
		        (ev.id IS NULL)                AS event_missing`).
		Joins("LEFT JOIN security_events AS ev ON ev.id = ack.event_id").
		Order("ack.acknowledged_at DESC").
		Limit(limit).
		Scan(&rows).Error

	if err != nil {
		return nil, err
	}
	return rows, nil
}

// AcknowledgedEventIDs returns the set of event ids that have been acknowledged.
//
// This is what the dashboard uses to decide whether a critical event should be
// shouting. Returning a SET rather than a count because the question is "is THIS
// one acknowledged", not "how many are" — a count would let the banner go quiet
// because some OTHER event was acknowledged, which is precisely the failure the
// banner exists to prevent.
func (s *SuperadminService) AcknowledgedEventIDs(
	ctx context.Context,
	eventIDs []uuid.UUID,
) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool, len(eventIDs))
	if len(eventIDs) == 0 {
		return out, nil
	}

	var acked []uuid.UUID
	if err := s.db.WithContext(ctx).
		Model(&model.SecurityAlertAcknowledgement{}).
		Where("event_id IN ?", eventIDs).
		Pluck("event_id", &acked).Error; err != nil {
		return nil, err
	}

	for _, id := range acked {
		out[id] = true
	}
	return out, nil
}

// truncateNote bounds an operator note at a rune boundary.
//
// A byte slice cut mid-rune produces invalid UTF-8, which `pgx` rejects on the
// way in — so the operator's note is lost entirely because it was one character
// too long. Cutting on a rune boundary makes the failure "slightly shortened"
// instead of "rejected".
func truncateNote(note string) string {
	note = strings.TrimSpace(note)
	if note == "" {
		return ""
	}

	runes := []rune(note)
	if len(runes) <= MaxAckNoteLength {
		return note
	}
	// The ellipsis counts toward the limit, so the result is never longer than the
	// column.
	const ellipsis = "…"
	if MaxAckNoteLength <= len([]rune(ellipsis)) {
		return ""
	}
	return string(runes[:MaxAckNoteLength-len([]rune(ellipsis))]) + ellipsis
}
