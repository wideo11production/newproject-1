// The UI click ledger - one row per interface interaction.
//
// =============================================================================
// THIS IS NOT THE SAME THING AS `ClickLog`
// =============================================================================
//
// The existing `ClickLog` in this service is AD AND CONTENT ENGAGEMENT:
//
//	AdID, CampaignID, ContentID, VideoID, IPAddress, Country, Device, Timestamp
//
// This is INTERFACE INTERACTION - which control the user actually pressed:
//
//	Page, Target, Label, Surface, ElementID, X, Y, Referrer
//
// Same word "click", two different domains. They are kept as two tables on
// purpose:
//
//   - Different lifetimes. A UI event is high-volume and short-lived (90 days).
//     An ad click is low-volume, money-relevant, and needs to be kept as long
//     as the billing dispute window.
//   - Different meaning. A UI click has no `AdID`; giving it one would be a lie,
//     and an ad click has no `Target`.
//
// Merging them into one table would mean every UI click carries a nullable money
// column that is always NULL, and every ad click carries a nullable UI column
// that is always NULL. Two tables say what is true.
//
// =============================================================================
// WHY THIS IS HERE AND NOT IN auth-service
// =============================================================================
//
// It WAS in auth_service, in a table called `click_events`. That was the wrong
// home: auth owns credentials and sessions, and nothing about "which button did
// this user press" is an auth concern. It ended up there because auth-service
// was the only service with a database already wired up.
//
// Moving it is only worth doing if something actually consumes it. The
// superadmin app's Awareness grid does. So it moves to the analytics service,
// which is the service that models events for a living.

package model

import (
	"time"

	"github.com/google/uuid"
)

// UIClickEvent is one interface interaction.
//
// Ids are UUIDs, not the `uint` auto-increment used by the ad models above.
// Reason: these rows are written by many independent apps and later joined
// across services (a session id from auth, a click from here). A cross-service
// join on a sequential integer is only safe if every writer shares a sequence,
// and these writers do not.
type UIClickEvent struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`

	// ---- Which app ----
	//
	// Indexed with Page, because the question is always "in this app, on this
	// page" and `page` alone is ambiguous: the editor and the web landing page
	// are both "/".
	Surface string `gorm:"size:64;not null;index:idx_ui_click_surface_page,priority:1" json:"surface"`
	Page    string `gorm:"size:255;not null;index:idx_ui_click_surface_page,priority:2" json:"page"`

	// ---- What was pressed ----
	//
	// `Target` is a SELECTOR, not an id. It is resolved at write time in
	// priority order `data-track` > `aria-label` > `tag.class.class`, so it is a
	// stable name wherever the app bothered to provide one. See
	// `packages/ui/src/activity-tracker.tsx` for the writer.
	Target    string `gorm:"size:255" json:"target"`
	Label     string `gorm:"size:255" json:"label"`
	ElementID string `gorm:"size:128" json:"element_id"`

	// ---- Where on screen ----
	//
	// Kept because "users keep missing the thing at the bottom right" is a real
	// finding that `target` alone cannot show.
	X int `gorm:"not null;default:0" json:"x"`
	Y int `gorm:"not null;default:0" json:"y"`

	// ---- Context ----
	//
	// Geo and device are derived SERVER-side from the request, never taken from
	// the client payload - otherwise a user just sends whatever country they
	// like and the geography becomes fiction.
	UserAgent string `gorm:"size:200" json:"user_agent"`
	IPAddress string `gorm:"size:64;index" json:"ip_address"`
	Referrer  string `gorm:"size:255" json:"referrer"`

	Country string `gorm:"size:3" json:"country"`
	Region  string `gorm:"size:100" json:"region"`
	City    string `gorm:"size:100" json:"city"`
	Device  string `gorm:"size:50" json:"device"`
	Browser string `gorm:"size:50" json:"browser"`
	OS      string `gorm:"size:50" json:"os"`

	// ---- Who ----
	//
	// Nullable, because clicks are captured on public pages too - the login
	// screen, the pricing table, the register form. That traffic is exactly the
	// traffic a funnel needs.
	UserID    *uuid.UUID `gorm:"type:uuid;index" json:"user_id,omitempty"`
	UserEmail string     `gorm:"size:255;index" json:"user_email,omitempty"`

	// Ties a click to the login session it came from, so "which device" is
	// answerable without guessing.
	SessionID *uuid.UUID `gorm:"type:uuid;index" json:"session_id,omitempty"`

	// ---- How this row was attributed ----
	//
	// The three values, and why "forged" is the one that matters:
	//
	//	verified  - the sending app checked the session cookie's SIGNATURE. Trust
	//	            the UserID/UserEmail on this row; it came from a real session.
	//	anonymous - no session cookie. A signed-out visitor on a public page. This
	//	            is the majority of rows on a landing site and is NOT suspicious.
	//	forged    - a session cookie WAS presented and it FAILED signature
	//	            verification. Nobody browsing normally produces this: the browser
	//	            holds an httpOnly cookie it cannot rewrite, so the only way to
	//	            send a bad one is to construct the request by hand.
	//
	// This is the field that makes click FRAUD visible. Before it existed, a
	// forged cookie produced a row indistinguishable from a real one, and the
	// "who pressed export" answer could be manufactured by anyone with curl. Now a
	// single `WHERE attribution = 'forged'` isolates every attempt, and the count
	// of `verified` rows is a number that means something.
	//
	// A user cannot influence this value: it is set by the sending app's server
	// after a signature check, not by the browser.
	Attribution string `gorm:"size:16;not null;default:'anonymous';index" json:"attribution"`

	// ---- When ----
	//
	// Two timestamps, and the difference is deliberate. `OccurredAt` is when the
	// user clicked, as reported by the client. `CreatedAt` is when the row was
	// written, which is what retention must use: a client can send a timestamp
	// from last year, and purging on that would let anyone delete rows by lying
	// about the clock.
	OccurredAt time.Time `gorm:"index;not null" json:"occurred_at"`
	CreatedAt  time.Time `gorm:"autoCreateTime;index;not null" json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (UIClickEvent) TableName() string { return "ui_click_events" }
