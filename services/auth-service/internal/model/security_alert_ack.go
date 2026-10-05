package model

// Acknowledgement of a critical security event.
//
// =============================================================================
// ACKNOWLEDGED IS NOT RESOLVED. THAT IS THE WHOLE POINT OF THIS TYPE.
// =============================================================================
//
// The dashboard had a permanent red banner for critical events: no dismissal, no
// record, the same three lockouts shouting on every page load forever.
//
// That is the failure mode every un-acknowledgeable alert reaches. A permanent
// alarm trains people to ignore alarms, and "somebody noticed" looks exactly like
// "nobody noticed" — which is the wrong answer to the only question that matters
// during an incident review.
//
// So this records ONE fact: a human saw an event. It does not resolve it, does not
// close it, and does not touch `security_events`.
//
//	ACKNOWLEDGED   a person has looked at this        -> suppresses the BANNER
//	RESOLVED       the condition has been dealt with   -> something else, and not this
//
// Collapsing those two is how a live incident gets closed by clicking a button, so
// they are not collapsed here. An acknowledged event still appears in the Security
// Events panel, still counts in the totals, and is still queryable forever. Only the
// banner stops shouting, and only until a NEW critical event arrives — which is
// unacknowledged by definition, so the banner comes back on its own.
//
// =============================================================================
// WHY THERE IS NO FOREIGN KEY ON `EventID`
// =============================================================================
//
// `security_events` is an append-only audit log, and the retention sweeper deletes
// rows older than the configured window. An acknowledgement that outlives its event
// is CORRECT: the fact that somebody saw it on the day it happened does not become
// false when the event row is archived.
//
// A foreign key would make the acknowledgement disappear too, which would silently
// resurrect the banner for an event a human had already reviewed months ago.

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SecurityAlertAcknowledgement records that an operator saw a critical event.
type SecurityAlertAcknowledgement struct {
	ID uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`

	// EventID is the `security_events.id` that was seen. Not a foreign key — see
	// the type comment.
	EventID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"event_id"`

	// AcknowledgedBy is an EMAIL, not a user id.
	//
	// Deliberate, and it is not a shortcut. `superadmin_accounts` holds master-root
	// and recovery identities; a token's `user_id` is a UUID in a different id
	// space (billing-service models users as `uint` — see that service's
	// `identity.go` for the mismatch). An email is what an incident reviewer reads,
	// and it cannot silently fail to resolve.
	AcknowledgedBy string `gorm:"size:255;not null;index" json:"acknowledged_by"`

	// Note is the operator's own words. Optional, but this is where "false
	// positive, that IP is the office router" belongs — otherwise the knowledge
	// lives in one person's head and is lost when they rotate off.
	//
	// Capped at 1000 to match `security_events.detail`, the field an operator
	// reads alongside it.
	Note string `gorm:"size:1000;not null;default:''" json:"note"`

	// AcknowledgedAt is when they saw it.
	//
	// `timestamptz`, because an incident review spanning a timezone boundary is
	// ordinary and a naive local timestamp makes the answer ambiguous.
	AcknowledgedAt time.Time `gorm:"not null;default:now();index" json:"acknowledged_at"`

	// IPAddress is where they saw it from — the difference between "noticed" and
	// "noticed from the office".
	IPAddress string `gorm:"size:64;not null;default:''" json:"ip_address"`
}

// TableName pins the table so GORM's pluralisation cannot guess differently.
func (SecurityAlertAcknowledgement) TableName() string {
	return "security_alert_acknowledgements"
}

// ---- Errors ----

// ErrAlreadyAcknowledged is returned on a repeat acknowledgement.
//
// The unique constraint on `event_id` would enforce this anyway, but a named
// error lets the handler answer 409 with an explanation instead of a generic
// database error, and lets the client treat it as success — because for the
// operator's intent, "already done" IS done.
var ErrAlreadyAcknowledged = gorm.ErrDuplicatedKey

// AcknowledgementWithEvent is one row of the acknowledgement history, joined with
// the event it refers to.
//
// The event is EMBEDDED rather than referenced by id, because the only reason to
// look at this list is to read what was acknowledged — a list of ids and timestamps
// answers no question anybody actually asks.
//
// Left-joined rather than inner-joined, so an acknowledgement whose event has been
// archived by retention still appears. Losing the history entry would be a
// regression in the audit trail caused by a housekeeping job, which is a
// particularly annoying kind of wrong.
type AcknowledgementWithEvent struct {
	SecurityAlertAcknowledgement
	EventType      string     `json:"event_type"`
	Detail         string     `json:"detail"`
	EventEmail     string     `json:"event_email,omitempty"`
	EventIP        string     `json:"event_ip,omitempty"`
	EventAt        *time.Time `json:"event_at,omitempty"`
	// EventMissing is true when the event row has been purged by retention.
	// Distinguishes "acknowledged an event we can no longer show" from "this row
	// is corrupt", and the UI says so rather than rendering an empty entry.
	EventMissing bool `json:"event_missing"`
}
