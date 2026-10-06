package model

import (
	"time"

	"github.com/google/uuid"
)

// UserIdentity is the key-lookup adapter between the two id spaces
// in this stack.
//
// -----------------------------------------------------------------------------
// WHY THIS TABLE EXISTS
// -----------------------------------------------------------------------------
//
// `auth-service` keys every user by a canonical UUID. The JWT's
// `user_id` claim IS that UUID. `billing-service` keys its own rows
// by a `uint` - `subscriptions.user_id` is `uint`, indexed, with no
// foreign key to anything, because billing has no users table of its
// own.
//
// The two spaces never agreed. `strconv.ParseUint(uuid)` fails for
// every real user, so `Subscribe` answered 400 `user_id_not_resolvable`
// for every legitimate subscriber - the exact crash this adapter
// closes.
//
// -----------------------------------------------------------------------------
// THE BRIDGE
// -----------------------------------------------------------------------------
//
// One row per auth UUID. The row's own auto-increment `id` IS the
// billing-side uint: the first time billing sees an auth UUID it
// allocates a row, and that id becomes the `user_id` written on
// `subscriptions`. The mapping is stable (unique index on the UUID),
// so the same user always resolves to the same billing id, and the
// same billing id always traces back to exactly one auth UUID.
//
// Existing `subscriptions` rows keep whatever uint they already had.
// They predate the mapping and were never reconcilable; this adapter
// is forward-looking, not a backfill.
//
// Hinglish: ye table auth ka UUID ko billing ke uint se jodti hai -
// pehli baar UUID dekhne par ek row ban ti hai, uska id hi billing
// ka user_id ban jata hai.
type UserIdentity struct {
	// ID is the billing-side uint. `subscriptions.user_id` stores
	// this value.
	ID uint `gorm:"primarykey" json:"id"`
	// AuthUUID is auth-service's canonical user id. Unique: one
	// billing id per auth user, ever.
	AuthUUID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"auth_uuid"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (UserIdentity) TableName() string {
	return "user_identities"
}
