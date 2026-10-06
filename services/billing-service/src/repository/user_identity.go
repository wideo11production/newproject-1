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
