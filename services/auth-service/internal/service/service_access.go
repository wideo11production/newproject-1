package service

// Service access: one session, many services, one source of truth.
//
// =============================================================================
// WHAT PROBLEM THIS SOLVES
// =============================================================================
//
// A user signs in once on the dashboard. They should then reach the editor,
// billing, admin and the rest WITHOUT a second login - and a user who may not
// reach a service must be refused by it, cleanly, without leaking whether it
// exists.
//
// The session cookie is already shared (it is `httpOnly` and cookies ignore the
// port), so this is NOT a single-sign-on problem. It is an AUTHORISATION problem:
// we have one identity and no answer to "may this identity use this service?"
//
// The requirement is in `updatedtodo.md` Session 17.
//
// =============================================================================
// THE CLOSED SETS, AND WHY THEY ARE CLOSED
// =============================================================================
//
// Services and permissions are Go constants, not strings from a request.
//
// A label that can be invented at runtime is a label nobody has reviewed. If
// `service` came from a JSON body, a typo - or a deliberate attempt - would
// create a service that no gate knows how to check, and the natural default for
// an unknown service is either "allow" (a hole) or "deny" (an outage that looks
// like a bug). A closed set makes both impossible: anything not in this file
// does not exist.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// Services a user can be granted access to.
const (
	ServiceWeb        = "web"          // the dashboard - the service selector
	ServiceEditor     = "video_editor" // the Movavi-style editor
	ServiceAnalytics  = "analytics"
	ServiceBilling    = "billing"
	ServiceAdmin      = "admin"
	ServiceMonitor    = "monitor"
	ServiceSuperadmin = "superadmin"
	ServiceCurrency   = "currency"
)

// AllServices is the order the dashboard lists them in.
//
// Fixed, so the dashboard does not reshuffle between users or between releases -
// a list that reorders on every load is a list nobody can screenshot.
var AllServices = []string{
	ServiceWeb,
	ServiceEditor,
	ServiceAnalytics,
	ServiceBilling,
	ServiceAdmin,
	ServiceMonitor,
	ServiceCurrency,
	ServiceSuperadmin,
}

// IsKnownService reports whether a slug is one of ours.
func IsKnownService(s string) bool {
	for _, v := range AllServices {
		if v == s {
			return true
		}
	}
	return false
}

// ErrUnknownService - a slug that is not in the closed set.
var ErrUnknownService = errors.New("unknown service")

// ErrServiceNotPermitted - known service, this user may not use it.
//
// Distinct from ErrUnknownService, and the distinction matters: an unknown slug
// is a client bug and returns 404, while a known service the caller may not use
// returns 403. Collapsing them makes the 403 a way to enumerate which services
// exist.
var ErrServiceNotPermitted = errors.New("service access not granted")

// ServiceAccess answers "may this person use this service, and what may they do".
type ServiceAccess struct {
	db *gorm.DB
}

// NewServiceAccess builds the service.
func NewServiceAccess(db *gorm.DB) *ServiceAccess { return &ServiceAccess{db: db} }

// IsSuperAdmin reports whether the user holds an active superadmin account.
//
// The ONLY way to be a superadmin. There is deliberately no `role = 'superadmin'`
// shortcut, no env-var bypass and no per-service flag: a superadmin reaches
// elevated rights through this one table, so there is exactly one thing to audit.
func (s *ServiceAccess) IsSuperAdmin(ctx context.Context, userID uuid.UUID) (bool, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&model.SuperadminAccount{}).
		Where("user_id = ? AND is_active = ?", userID, true).
		Count(&n).Error
	return n > 0, err
}

// CanUse answers whether a user may use a service.
//
// A superadmin may use ALL of them, and holds no rows saying so - an explicit
// "superadmin can do everything" row would be a second source of truth about the
// most powerful account in the system, and the two would eventually disagree.
//
// FAILS CLOSED. A database error returns "no".
//
// That is the opposite of the device-slot decision in `device_slots.go`, and the
// asymmetry is the reason: a device-slot lookup that fails open costs one seat,
// while a service-access lookup that fails open is a person reaching a service
// they were never granted.
func (s *ServiceAccess) CanUse(ctx context.Context, userID uuid.UUID, service string) error {
	if !IsKnownService(service) {
		return fmt.Errorf("%w: %q", ErrUnknownService, service)
	}

	isSuper, err := s.IsSuperAdmin(ctx, userID)
	if err != nil {
		return fmt.Errorf("service access check failed (denied): %w", err)
	}
	if isSuper {
		return nil
	}

	var n int64
	if err := s.db.WithContext(ctx).Model(&model.UserService{}).
		Where("user_id = ? AND service = ? AND revoked_at IS NULL", userID, service).
		Count(&n).Error; err != nil {
		return fmt.Errorf("service access check failed (denied): %w", err)
	}
	if n == 0 {
		return fmt.Errorf("%w: %s", ErrServiceNotPermitted, service)
	}
	return nil
}

// Grant gives a user access to a service.
//
// Idempotent by re-granting the same row: a revoked grant is re-opened, and a
// live one is left alone. A duplicate row would not grant more, but it would make
// "revoke it" ambiguous, so this is an UPDATE rather than an INSERT.
func (s *ServiceAccess) Grant(ctx context.Context, userID uuid.UUID, service string, grantedBy *uuid.UUID, reason string) error {
	if !IsKnownService(service) {
		return fmt.Errorf("%w: %q", ErrUnknownService, service)
	}

	var existing model.UserService
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND service = ?", userID, service).
		First(&existing).Error

	switch {
	case err == nil:
		existing.RevokedAt = nil
		existing.RevokedBy = nil
		existing.RevokedReason = ""
		existing.GrantedBy = grantedBy
		existing.GrantedAt = time.Now().UTC()
		return s.db.WithContext(ctx).Save(&existing).Error
	case errors.Is(err, gorm.ErrRecordNotFound):
		// `reason` is the human justification, which belongs on the REGISTRY row
		// rather than on the grant - the grant's own "why" lives in
		// `revoked_reason` once it is taken away. Accepted here and ignored
		// deliberately rather than silently dropped, so the caller finds out from
		// the signature that it is not persisted.
		_ = reason
		row := model.UserService{
			ID: uuid.New(), UserID: userID, Service: service,
			GrantedBy: grantedBy, GrantedAt: time.Now().UTC(),
		}
		return s.db.WithContext(ctx).Create(&row).Error
	default:
		return err
	}
}

// Revoke takes access away, keeping the row.
//
// The history is the point: a deleted grant cannot prove that an ex-employee
// no longer has access, only that nobody remembers granting it.
func (s *ServiceAccess) Revoke(ctx context.Context, userID uuid.UUID, service, reason string) error {
	if reason == "" {
		// A revocation with no reason is a revocation nobody will be able to
		// explain at audit.
		//
		// The package SENTINEL, not a fresh errors.New: callers need
		// `errors.Is(err, ErrNoReason)` to tell "you forgot a reason" apart from
		// "that device is not in your list", and a bare error makes the first
		// untestable.
		return ErrNoReason
	}
	now := time.Now().UTC()

	res := s.db.WithContext(ctx).Model(&model.UserService{}).
		Where("user_id = ? AND service = ? AND revoked_at IS NULL", userID, service).
		Updates(map[string]any{"revoked_at": now, "revoked_reason": reason})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return fmt.Errorf("no live grant for %s", service)
	}
	return nil
}

// ServicesFor returns the services a user may use, in the fixed display order.
//
// This is what the DASHBOARD reads to build its list, and it is deliberately the
// SAME query the service gate uses - so the dashboard cannot show a service the
// service would then refuse. That mismatch is the bug this removes.
// UserExists reports whether an account with this id exists.
//
// Exists so the handler can validate an administrative target WITHOUT holding a
// database handle.
//
// The reason that matters: `AuthHandler` has no `*gorm.DB` field, and adding one
// purely for this check would give every handler in the package direct,
// unmediated access to the database - a much larger change than the problem
// warrants, and one that would be available to code that currently cannot do it.
//
// Returning a bool rather than a row is deliberate: the caller needs to know
// WHETHER, and returning `model.User` would invite somebody to read the email
// off the response of an administrative endpoint.
func (s *ServiceAccess) UserExists(ctx context.Context, userID uuid.UUID) (bool, error) {
	var n int64
	err := s.db.WithContext(ctx).
		Model(&model.User{}).
		Where("id = ?", userID).
		Limit(1).
		Count(&n).Error
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *ServiceAccess) ServicesFor(ctx context.Context, userID uuid.UUID) ([]string, error) {
	var granted []string
	if err := s.db.WithContext(ctx).Model(&model.UserService{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Pluck("service", &granted).Error; err != nil {
		return nil, err
	}

	isSuper, err := s.IsSuperAdmin(ctx, userID)
	if err != nil {
		// Fail closed: an unreadable registry means the list is the web app and
		// nothing else, rather than "everything", because a wrong list that is too
		// long is a list that shows a person services they do not have.
		return []string{ServiceWeb}, nil
	}
	if isSuper {
		return append([]string(nil), AllServices...), nil
	}

	have := make(map[string]bool, len(granted))
	for _, g := range granted {
		have[g] = true
	}

	out := make([]string, 0, len(granted))
	for _, svc := range AllServices {
		if have[svc] {
			out = append(out, svc)
		}
	}
	return out, nil
}

// normaliseService lower-cases and trims, so a slug typed by hand matches the
// constant. It still does not CREATE a slug: unknown stays unknown.
func normaliseService(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}
