package repository

// The billing half of the identity adapter: resolve an auth UUID to
// the billing-side uint, allocating one on first sight.
//
// Why the allocation lives HERE and not in the service: the service
// already coordinates seven repositories; the "one row per UUID,
// races included" rule is a storage concern, and storage is where a
// double-insert is actually possible. Two concurrent first-sight
// requests for the same UUID both miss the SELECT, both try to
// INSERT, and exactly one wins the unique index.

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"newproject/services/billing-service/src/model"
)

// UserIdentityRepository bridges auth's UUID space to billing's uint
// space. See `model/user_identity.go` for the shape of the bridge.
type UserIdentityRepository interface {
	// Resolve returns the billing id for an auth UUID, allocating
	// one if this is the first time billing sees that user.
	Resolve(ctx context.Context, authUUID uuid.UUID) (uint, error)

	// Lookup returns the auth UUID for a billing id.
	//
	// THE REVERSE, AND WHY IT WAS NOT THERE BEFORE
	//
	// `Resolve` exists because a JWT arrives with a UUID and every billing row
	// wants a uint. The reverse is needed because an ACTIVATION happens from a
	// subscription id - a payment confirms money, the payment names an invoice,
	// the invoice names a subscription, and the subscription stores only the
	// billing-side uint. To grant the plan, the entitlement client needs the
	// UUID the token carries, and the only place that mapping exists is this
	// table.
	//
	// It is an ERROR, not an empty string, when there is no row. A subscription
	// whose billing id has no identity row was created by the pre-adapter code
	// path (the model comment records that those rows "were never reconcilable"),
	// and silently returning an empty UUID would make the caller fire an
	// entitlement for a user that does not exist. That failure would be
	// indistinguishable from a successful grant of nothing.
	Lookup(ctx context.Context, billingID uint) (uuid.UUID, error)
}

type userIdentityRepository struct {
	db *gorm.DB
}

func NewUserIdentityRepository(db *gorm.DB) UserIdentityRepository {
	return &userIdentityRepository{db: db}
}

func (r *userIdentityRepository) Resolve(ctx context.Context, authUUID uuid.UUID) (uint, error) {
	var ident model.UserIdentity
	err := r.db.WithContext(ctx).Where("auth_uuid = ?", authUUID).First(&ident).Error
	if err == nil {
		return ident.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	// ---- First sight: allocate ----
	//
	// The insert is the allocation. If a concurrent request for the
	// SAME UUID won the race, the unique index rejects this insert -
	// and the correct answer is the winner's id, not an error: both
	// requests are about the same real user, and either id would
	// serve, but only the winner's is stable.
	ident = model.UserIdentity{AuthUUID: authUUID}
	if err := r.db.WithContext(ctx).Create(&ident).Error; err != nil {
		var winner model.UserIdentity
		if err2 := r.db.WithContext(ctx).Where("auth_uuid = ?", authUUID).First(&winner).Error; err2 == nil {
			return winner.ID, nil
		}
		// Neither ours nor anyone else's: report the ORIGINAL failure,
		// which is the one that says what was attempted.
		return 0, err
	}
	return ident.ID, nil
}

// Lookup maps the billing-side uint back to auth's UUID.
//
// The primary key IS the billing id, so this is a `First(&ident, billingID)`
// rather than a `Where` - and a not-found is genuinely absent, not ambiguous.
func (r *userIdentityRepository) Lookup(ctx context.Context, billingID uint) (uuid.UUID, error) {
	if billingID == 0 {
		// 0 is the zero value and is never a real row. Returning it as a
		// "not found" instead of an error would let a caller treat an
		// unpopulated struct field as a user identity, which is the kind of
		// thing that grants an entitlement to nobody and looks like it worked.
		return uuid.Nil, fmt.Errorf("billing user id 0 is not a real identity")
	}

	var ident model.UserIdentity
	err := r.db.WithContext(ctx).First(&ident, billingID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return uuid.Nil, fmt.Errorf("billing user %d has no identity row - "+
				"created before the identity adapter and not reconcilable", billingID)
		}
		return uuid.Nil, err
	}
	return ident.AuthUUID, nil
}
