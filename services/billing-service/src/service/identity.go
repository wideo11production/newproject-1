package service

// The service half of the identity adapter: turn the VERIFIED token
// claim (auth's UUID) into the billing-side uint, with a sentinel
// error the handlers can tell apart from a broken database.
//
// Why a sentinel and not a string comparison: the handlers answer
// 400 `user_id_not_resolvable` for "this token names no resolvable
// user" and 500 for "the database is on fire". A wrapped string
// makes those two indistinguishable the moment anyone rewords a
// message; `errors.Is` does not reword.

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
)

// ErrIdentityNotResolvable means the token's user_id claim is not a
// UUID auth-service would ever issue. It is a CLIENT error (400),
// never a server error: the database was never asked.
var ErrIdentityNotResolvable = errors.New("user_id_not_resolvable")

// ResolveBillingUserID maps an auth-service UUID string onto the
// billing-side uint, allocating a billing id on first sight.
//
// `authUserID` comes from the verified token claim - never from a
// request body or URL. It is trimmed, parsed, and only then handed
// to the repository, so a malformed claim fails before any query.
func (s *BillingService) ResolveBillingUserID(ctx context.Context, authUserID string) (uint, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(authUserID))
	if err != nil {
		return 0, ErrIdentityNotResolvable
	}
	return s.identityRepo.Resolve(ctx, parsed)
}

// ResolveAuthUserID maps a billing-side uint back onto the auth-service
// UUID string. Used when a handler has the billing id (from resolveBillingUser)
// and needs the auth UUID for cross-service calls.
//
// Returns ErrIdentityNotResolvable when no auth UUID is linked to the billing id.
func (s *BillingService) ResolveAuthUserID(ctx context.Context, billingUserID uint) (uuid.UUID, error) {
	parsed, err := s.identityRepo.Lookup(ctx, billingUserID)
	if err != nil {
		return uuid.Nil, ErrIdentityNotResolvable
	}
	return parsed, nil
}
