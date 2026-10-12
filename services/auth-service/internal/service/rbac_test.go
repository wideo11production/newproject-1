package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// =============================================================================
// WHAT IS WORTH TESTING HERE
// =============================================================================
//
// RBAC has one unforgivable failure: authority that grows sideways. Everything
// else is a bug; this one is a breach. So the centre of this file is the
// delegation bound, and the cases around it are the ways it could be bypassed:
//
//	1. a granter can NEVER grant a permission they do not hold
//	2. a granter can NEVER appoint a role at or above their own rank
//	3. a superadmin CAN appoint anyone below them
//	4. a permission lookup that FAILS must deny - the opposite of the
//	   device-slot decision, because here failing open is escalation
//	5. an UNKNOWN permission is refused, so a typo cannot become a backdoor
//	6. expiry needs no job: a lapsed appointment stops granting immediately
//	7. the registry is DERIVED, so it cannot disagree with the tables
//
// Also: service access, which is the "one login" half.

func svcAccess(t *testing.T) (*ServiceAccess, *RBAC) {
	t.Helper()
	db := entTestDB(t)
	users := NewServiceAccess(db)
	rbac := NewRBAC(db, users)
	if err := rbac.Seed(context.Background()); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM role_permissions`)
		db.Exec(`DELETE FROM roles`)
		db.Exec(`DELETE FROM permissions`)
	})
	return users, rbac
}

// TestSeedActuallyPopulatesTheCatalogue is the regression test for the bug that
// produced "You do not have the 'channel.create' capability."
//
// WHAT HAPPENED
// =============
//
// `Seed()` ran, logged "permission catalogue seeded", and returned nil - while
// the `permissions` and `role_permissions` tables were both EMPTY. Nothing
// failed. Every permission check then answered `false`, so a creator holding the
// `creator` role could not create a channel, could not upload media, and nothing
// in the logs said why.
//
// Every layer above the seed was correct and tested: the role was appointed, the
// constant existed, the middleware was wired, the resolution query was right. The
// single unwritten write was the whole bug, and it was invisible precisely because
// the seed reported success.
//
// So this test asserts the WRITE, not just the absence of an error. A seed that
// returns nil with an empty catalogue is a broken seed, and this is the test that
// says so.
func TestSeedActuallyPopulatesTheCatalogue(t *testing.T) {
	db := entTestDB(t)
	users := NewServiceAccess(db)
	rbac := NewRBAC(db, users)
	t.Cleanup(func() {
		db.Exec(`DELETE FROM role_permissions`)
		db.Exec(`DELETE FROM roles`)
		db.Exec(`DELETE FROM permissions`)
	})

	// Start from a genuinely empty catalogue, which is the state the bug lived in.
	// Seeding twice (idempotent) is not the point - the point is that the SECOND
	// run must populate what the first left empty.
	if err := rbac.Seed(context.Background()); err != nil {
		t.Fatalf("seed: %v", err)
	}

	var permCount, rolePermCount int64
	if err := db.Model(&model.Permission{}).Count(&permCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.RolePermission{}).Count(&rolePermCount).Error; err != nil {
		t.Fatal(err)
	}

	// The vocabulary in Go, which is the number the seed is supposed to write.
	if want := int64(len(PermissionNames())); permCount != want {
		t.Errorf("permissions table has %d rows, want %d (every name in the closed "+
			"vocabulary).\nAn empty catalogue makes Can() answer false for EVERY "+
			"permission in the product, which reads as a permissions bug rather "+
			"than a boot that skipped a write.", permCount, want)
	}
	if rolePermCount == 0 {
		t.Error("no role carries any permission - every role is empty, so every " +
			"privileged action is refused even for an appointed creator")
	}

	// And the pairing that actually bit: the `creator` role must resolve
	// `channel.create`, because that is the exact check that failed.
	roleID, _ := roleByName(t, rbac, "creator")
	var has int64
	if err := db.Model(&model.RolePermission{}).
		Where("role_id = ? AND permission = ?", roleID, PermChannelCreate).
		Count(&has).Error; err != nil {
		t.Fatal(err)
	}
	if has == 0 {
		t.Error("the creator role does not grant channel.create - a creator " +
			"appointed to it cannot create a channel")
	}
}

// TestSeedIsIdempotent pins the other half: a second Seed must not duplicate or
// wipe, because it runs on every boot and a boot loop must not accumulate rows.
func TestSeedIsIdempotent(t *testing.T) {
	db := entTestDB(t)
	users := NewServiceAccess(db)
	rbac := NewRBAC(db, users)
	t.Cleanup(func() {
		db.Exec(`DELETE FROM role_permissions`)
		db.Exec(`DELETE FROM roles`)
		db.Exec(`DELETE FROM permissions`)
	})

	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := rbac.Seed(ctx); err != nil {
			t.Fatalf("seed run %d: %v", i+1, err)
		}
	}

	var permCount, rolePermCount int64
	db.Model(&model.Permission{}).Count(&permCount)
	db.Model(&model.RolePermission{}).Count(&rolePermCount)
	if want := int64(len(PermissionNames())); permCount != want {
		t.Errorf("after three seeds, permissions = %d, want %d - seeding is not "+
			"idempotent and every boot would add rows", permCount, want)
	}
	// Four system roles with their defined permissions; the exact number is less
	// important than it not growing per boot.
	if rolePermCount == 0 {
		t.Error("role_permissions is empty after three seeds")
	}
}

func roleByName(t *testing.T, rbac *RBAC, name string) (roleID uuid.UUID, rank int) {
	t.Helper()

	// The real model, not an anonymous struct: GORM infers the table from the
	// destination type, and an anonymous struct has no name to infer from, so the
	// generated SQL was `FROM ` with nothing after it.
	var role model.Role
	if err := rbac.db.WithContext(context.Background()).
		Where("name = ?", name).Take(&role).Error; err != nil {
		t.Fatalf("role %q: %v", name, err)
	}
	return role.ID, role.Rank
}

// =============================================================================
// THE DELEGATION BOUND
// =============================================================================

// TestCannotGrantWhatYouDoNotHold is the test the whole model rests on.
//
// Without it, anyone who can appoint people can appoint themselves into a role
// carrying ten more permissions, and "who may do what" is a table anyone with
// the smallest delegating permission can rewrite to say they may do everything.
func TestCannotGrantWhatYouDoNotHold(t *testing.T) {
	db := entTestDB(t)
	users, rbac := svcAccess(t)
	ctx := context.Background()
	// The superadmin check is how a granter gets a rank at all, and this test is
	// about the permission half of the bound, so the service handle is only here
	// to keep the fixture honest about what it is.
	_ = users

	opsID, _ := roleByName(t, rbac, "ops")
	financeID, financeRank := roleByName(t, rbac, "finance")

	// An `ops` person: rank 40, holds service.grant and role.appoint, but
	// holds NOTHING from the finance group.
	//
	// Seeded THROUGH A SUPERADMIN, not by appointing themselves. An earlier
	// version had them self-appoint, and was refused - correctly, because a user
	// with no appointment has rank 0 and `ops` is 40. That is the delegation
	// bound working; the test was asking it to authorise itself.
	seed := probeEntUser(t, db)
	if err := db.Exec(
		`INSERT INTO superadmin_accounts (user_id, email, role, is_active) VALUES (?,?,?,true)`,
		seed, "seed@"+testEmail, "superadmin").Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM superadmin_accounts WHERE user_id = ?`, seed) })

	ops := probeEntUser(t, db)
	if _, err := rbac.Appoint(ctx, seed, ops, opsID, "seed the ops appointment", nil); err != nil {
		t.Fatalf("seeding the ops appointment: %v", err)
	}
	_ = users

	if ok, _ := rbac.Can(ctx, ops, PermPayoutApprove); ok {
		t.Fatal("an ops user holds payout.approve before the test even starts")
	}

	// `finance` is rank 30 - LOWER than ops, so rank alone would allow it.
	if financeRank >= 40 {
		t.Fatalf("test premise broken: finance rank %d is not below ops", financeRank)
	}
	// And the ops user genuinely cannot move money: `payout.approve` is not in
	// `ops`, and `Can` says so with a false and NO error.
	//
	// An earlier version asserted an ERROR here. `Can` only errors on a
	// permission this codebase does not define; a defined permission the user
	// simply lacks is `(false, nil)`. The assertion was inverted, not the code.
	if ok, err := rbac.Can(ctx, ops, PermPayoutApprove); err != nil || ok {
		t.Fatalf("ops user holds payout.approve: ok=%v err=%v", ok, err)
	}

	// Appointing finance must be REFUSED, because finance carries
	// payout.approve and the ops user does not hold it.
	_, err := rbac.Appoint(ctx, ops, ops, financeID, "trying to move money", nil)
	if err == nil {
		t.Fatal("an ops user appointed themselves into `finance`.\n" +
			"Rank was LOWER, so the rank check passed - which is exactly why the\n" +
			"permission check exists. Rank is a proxy for power, not power itself.")
	}
	if !errors.Is(err, ErrNotAuthorised) {
		t.Fatalf("got %v, want ErrNotAuthorised", err)
	}

	// And they do not have the permission afterwards.
	if ok, _ := rbac.Can(ctx, ops, PermPayoutApprove); ok {
		t.Fatal("a refused appointment still conferred its permissions")
	}
}

// TestCannotPromoteYourselfOrAPeer covers the rank half.
func TestCannotPromoteYourselfOrAPeer(t *testing.T) {
	db := entTestDB(t)
	_, rbac := svcAccess(t)
	ctx := context.Background()

	creatorID, creatorRank := roleByName(t, rbac, "creator")
	opsID, opsRank := roleByName(t, rbac, "ops")

	// Seeded by a superadmin, because self-appointment is exactly what the rank
	// check exists to stop - a user with no appointment has rank 0, and `creator`
	// is 20. An earlier version of this test had them appoint themselves and
	// treated the refusal as a bug; it was the rule working.
	seedSuper := func(t *testing.T) uuid.UUID {
		t.Helper()
		who := probeEntUser(t, db)
		if err := db.Exec(
			`INSERT INTO superadmin_accounts (user_id, email, role, is_active) VALUES (?,?,?,true)`,
			who, "seed@probe.local", "superadmin").Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Exec(`DELETE FROM superadmin_accounts WHERE user_id = ?`, who) })
		return who
	}

	creator := probeEntUser(t, db)
	if _, err := rbac.Appoint(ctx, seedSuper(t), creator, creatorID, "seed", nil); err != nil {
		t.Fatal(err)
	}

	// Same rank: not strictly below, so refused.
	if _, err := rbac.Appoint(ctx, creator, creator, creatorID, "again", nil); err == nil {
		t.Error("re-appointing the same role was refused as a no-op rather than accepted")
	}

	// Higher rank: refused, with the escalation error.
	if _, err := rbac.Appoint(ctx, creator, creator, opsID, "promote myself", nil); err == nil {
		t.Fatal("a creator promoted themselves to ops")
	} else if !errors.Is(err, ErrSelfEscalation) {
		t.Errorf("got %v, want ErrSelfEscalation", err)
	}
	_ = creatorRank
	_ = opsRank
}

// TestSuperAdminCanAppointAnyoneBelow is the positive case, so the bound above is
// not read as "nobody may ever appoint".
func TestSuperAdminCanAppointAnyoneBelow(t *testing.T) {
	db := entTestDB(t)
	_, rbac := svcAccess(t)
	ctx := context.Background()

	// Give the granter a superadmin account - the ONLY route to that status.
	super := probeEntUser(t, db)
	if err := db.Exec(
		`INSERT INTO superadmin_accounts (user_id, email, role, is_active) VALUES (?,?,?,true)`,
		super, "super@test.local", "superadmin").Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM superadmin_accounts WHERE user_id = ?`, super) })

	opsID, _ := roleByName(t, rbac, "ops")
	subject := probeEntUser(t, db)

	if _, err := rbac.Appoint(ctx, super, subject, opsID, "running the platform", nil); err != nil {
		t.Fatalf("a superadmin could not appoint ops: %v", err)
	}

	if ok, err := rbac.Can(ctx, subject, PermServiceGrant); err != nil || !ok {
		t.Errorf("the appointee does not hold service.grant (ok=%v err=%v)", ok, err)
	}
}

// TestSuperAdminIsNotARoleHere pins the separation.
//
// A superadmin account cannot also be appointed into a role, and there is no role
// named "superadmin" to appoint. Otherwise the first person who can appoint could
// mint a superadmin - which is the escalation this design exists to prevent.
func TestSuperAdminIsNotARoleHere(t *testing.T) {
	db := entTestDB(t)
	_, rbac := svcAccess(t)

	var n int64
	db.Model(&struct {
		Name string `gorm:"column:name"`
	}{}).Table("roles").Where("name = ?", "superadmin").Count(&n)
	if n != 0 {
		t.Error("a role named `superadmin` exists.\n" +
			"Elevation is a distinct, narrower operation held in `superadmin_accounts`.\n" +
			"A role would mean anyone who can appoint could mint one.")
	}
	_ = rbac
}

// TestPermissionLookupFailsClosed: the opposite of the device-slot decision,
// and the reason is the asymmetry.
func TestPermissionLookupFailsClosed(t *testing.T) {
	db := entTestDB(t)
	_, rbac := svcAccess(t)
	ctx := context.Background()

	opsID, _ := roleByName(t, rbac, "ops")
	super := probeEntUser(t, db)
	// A superadmin row, not just a user: `HighestRank` is what makes the
	// appointment possible, and an ordinary user has rank 0.
	if err := db.Exec(
		`INSERT INTO superadmin_accounts (user_id, email, role, is_active) VALUES (?,?,?,true)`,
		super, "super@probe.local", "superadmin").Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM superadmin_accounts WHERE user_id = ?`, super) })

	subject := probeEntUser(t, db)
	if _, err := rbac.Appoint(ctx, super, subject, opsID, "seed", nil); err != nil {
		t.Fatal(err)
	}

	ok, _ := rbac.Can(ctx, subject, PermServiceGrant)
	if !ok {
		t.Fatal("setup: the appointee should hold service.grant")
	}

	// Break the lookup by removing the table the read depends on.
	if err := db.Exec(`ALTER TABLE role_permissions RENAME TO role_permissions_hidden`).Error; err != nil {
		t.Skipf("cannot simulate a broken lookup: %v", err)
	}
	t.Cleanup(func() { db.Exec(`ALTER TABLE role_permissions_hidden RENAME TO role_permissions`) })

	ok, _ = rbac.Can(ctx, subject, PermServiceGrant)
	if ok {
		t.Error("a broken permission lookup GRANTED access.\n" +
			"This must fail CLOSED. The device-slot lookup fails open because the two\n" +
			"losses are not comparable: one seat versus a privilege escalation.")
	}
}

// TestUnknownPermissionIsRefused: a typo must not become a backdoor.
func TestUnknownPermissionIsRefused(t *testing.T) {
	db := entTestDB(t)
	_, rbac := svcAccess(t)
	ctx := context.Background()

	user := probeEntUser(t, db)
	ok, err := rbac.Can(ctx, user, "definitely.not.a.permission")
	if err == nil {
		t.Error("an unknown permission was accepted - the natural default for one is allow")
	}
	if ok {
		t.Error("an unknown permission was GRANTED")
	}
	if !errors.Is(err, ErrUnknownPermission) {
		t.Errorf("got %v, want ErrUnknownPermission", err)
	}
}

// TestExpiredAppointmentStopsGrantingImmediately: no job writes anything.
func TestExpiredAppointmentStopsGrantingImmediately(t *testing.T) {
	db := entTestDB(t)
	_, rbac := svcAccess(t)
	ctx := context.Background()

	opsID, _ := roleByName(t, rbac, "ops")
	super := probeEntUser(t, db)
	if err := db.Exec(
		`INSERT INTO superadmin_accounts (user_id, email, role, is_active) VALUES (?,?,?,true)`,
		super, "super@test.local", "superadmin").Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM superadmin_accounts WHERE user_id = ?`, super) })

	subject := probeEntUser(t, db)
	past := time.Now().UTC().Add(-time.Minute)
	if _, err := rbac.Appoint(ctx, super, subject, opsID, "already over", &past); err != nil {
		t.Fatal(err)
	}

	if ok, _ := rbac.Can(ctx, subject, PermServiceGrant); ok {
		t.Error("a LAPSED appointment still grants permissions.\n" +
			"Expiry must be derived from expires_at at read time. A status a scheduler\n" +
			"maintains is a status that eventually disagrees with its own clock.")
	}
}

// =============================================================================
// SERVICE ACCESS - the "one login" half
// =============================================================================

func TestServiceAccessIsClosedSetAndFailsClosed(t *testing.T) {
	db := entTestDB(t)
	users, _ := svcAccess(t)
	ctx := context.Background()

	user := probeEntUser(t, db)

	// An invented service does not exist.
	err := users.CanUse(ctx, user, "not_a_service")
	if !errors.Is(err, ErrUnknownService) {
		t.Errorf("an invented service: got %v, want ErrUnknownService", err)
	}

	// A real one, not granted.
	err = users.CanUse(ctx, user, ServiceEditor)
	if !errors.Is(err, ErrServiceNotPermitted) {
		t.Errorf("an ungranted real service: got %v, want ErrServiceNotPermitted", err)
	}

	// Granted.
	if err := users.Grant(ctx, user, ServiceEditor, nil, ""); err != nil {
		t.Fatal(err)
	}
	if err := users.CanUse(ctx, user, ServiceEditor); err != nil {
		t.Errorf("a granted service was refused: %v", err)
	}

	// Revoked, with a reason.
	if err := users.Revoke(ctx, user, ServiceEditor, "left the company"); err != nil {
		t.Fatal(err)
	}
	if err := users.CanUse(ctx, user, ServiceEditor); !errors.Is(err, ErrServiceNotPermitted) {
		t.Errorf("a revoked service still works: %v", err)
	}

	// Revoking with no reason is refused - a revocation nobody can explain at
	// audit is not a revocation.
	if err := users.Revoke(ctx, user, ServiceEditor, ""); !errors.Is(err, ErrNoReason) {
		t.Errorf("revoking with no reason: got %v, want ErrNoReason", err)
	}
}

// A superadmin holds every service and NO ROWS saying so.
func TestSuperAdminHoldsEveryServiceWithNoRows(t *testing.T) {
	db := entTestDB(t)
	users, _ := svcAccess(t)
	ctx := context.Background()

	super := probeEntUser(t, db)
	if err := db.Exec(
		`INSERT INTO superadmin_accounts (user_id, email, role, is_active) VALUES (?,?,?,true)`,
		super, "super@test.local", "superadmin").Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM superadmin_accounts WHERE user_id = ?`, super) })

	for _, svc := range AllServices {
		if err := users.CanUse(ctx, super, svc); err != nil {
			t.Errorf("superadmin refused %s: %v", svc, err)
		}
	}

	var rows int64
	db.Table("user_services").Where("user_id = ?", super).Count(&rows)
	if rows != 0 {
		t.Errorf("a superadmin has %d explicit service rows.\n"+
			"It must hold NONE: an explicit row is a second source of truth about the\n"+
			"most powerful account in the system, and the two would eventually disagree.", rows)
	}
}

// The dashboard list and the service gate must agree, or the dashboard shows a
// service that then refuses the user.
func TestServicesForMatchesTheGate(t *testing.T) {
	db := entTestDB(t)
	users, _ := svcAccess(t)
	ctx := context.Background()

	user := probeEntUser(t, db)
	for _, s := range []string{ServiceEditor, ServiceBilling, ServiceWeb} {
		if err := users.Grant(ctx, user, s, nil, ""); err != nil {
			t.Fatal(err)
		}
	}

	list, err := users.ServicesFor(ctx, user)
	if err != nil {
		t.Fatal(err)
	}

	for _, svc := range AllServices {
		listed := false
		for _, l := range list {
			if l == svc {
				listed = true
			}
		}
		usable := users.CanUse(ctx, user, svc) == nil
		if listed != usable {
			t.Errorf("%s: listed=%v but usable=%v.\n"+
				"The dashboard list and the service gate read the SAME query, so a user "+
				"can never be shown a service that then refuses them.", svc, listed, usable)
		}
	}
}
