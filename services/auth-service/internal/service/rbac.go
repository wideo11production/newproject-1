package service

// RBAC: roles, permissions, and appointments.
//
// =============================================================================
// THE RULE THIS FILE EXISTS FOR
// =============================================================================
//
//	An appointment can never grant a permission the granter does not hold.
//
// Without it, anyone who can appoint people can appoint THEMSELVES superadmin,
// and the whole model is theatre - a "who may do what" table that anyone with
// the smallest delegating permission can rewrite to say they may do everything.
//
// With it, authority can only ever flow DOWNWARD. A superadmin can appoint an
// employee who can appoint nobody. An employee cannot appoint a peer, and cannot
// appoint a role that carries more than their own.
//
// This is enforced here, in Go, and not by a CHECK constraint - because the
// check has to compare a whole role's permission set against the granter's
// EFFECTIVE set, and "effective" spans several tables.
//
// =============================================================================
// WHY SUPERADMIN IS NOT A ROLE HERE
// =============================================================================
//
// It is in `superadmin_accounts` and nowhere else.
//
// Elevation is a distinct, narrow operation: two named recovery accounts, seeded
// at boot, that exist so a locked-out superadmin can get back in. Making it a
// ROW in the role table would mean the first person who could appoint could
// mint one - which is precisely the escalation this file is built to prevent.
//
// A superadmin still goes through the same login, the same session and the same
// gates as everyone else. What they get is additional friction (step-up auth on
// privileged actions), never a bypass.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// Errors. Each one means a different thing to the person who caused it, and
// collapsing them turns a security decision into a support ticket.
var (
	// ErrNotAuthorised - the granter does not hold the power being delegated.
	ErrNotAuthorised = errors.New("you cannot grant what you do not hold")

	// ErrUnknownRole - a role that is not in this codebase.
	ErrUnknownRole = errors.New("unknown role")

	// ErrUnknownPermission - a permission that is not in the closed set.
	ErrUnknownPermission = errors.New("unknown permission")

	// ErrRoleNotDelegable - the role exists but must never be handed out.
	ErrRoleNotDelegable = errors.New("this role cannot be delegated")

	// ErrSelfEscalation - the granter tried to grant themselves more than they hold.
	ErrSelfEscalation = errors.New("cannot grant a role more powerful than your own")

	// ErrNoReason - an appointment or revocation with no justification.
	ErrNoReason = errors.New("a reason is required")
)

// Permission names.
//
// A CLOSED set, for the same reason services are: a permission invented at
// runtime is one nobody reviewed, and the natural default for an unknown
// permission is "allow".
const (
	// Content
	PermChannelCreate = "channel.create"
	PermChannelEdit   = "channel.edit"
	PermChannelDelete = "channel.delete"
	PermMediaUpload   = "media.upload"
	PermMediaDelete   = "media.delete"
	PermProjectSave   = "project.save"

	// Commerce
	PermPlanView      = "plan.view"
	PermAdsManage     = "ads.manage"
	PermPayoutView    = "payout.view"
	PermPayoutApprove = "payout.approve"

	// People
	PermUserView     = "user.view"
	PermServiceGrant = "service.grant"
	PermRoleAppoint  = "role.appoint"

	// Platform
	PermMetricsView = "metrics.view"
	PermAuditView   = "audit.view"
	// The dangerous class, tracked separately so it can be reviewed on its own.
	PermRoleAdmin = "role.admin"

	// ---- Content moderation (migration 030) ----
	//
	// Separate from `audit.view` and from `media.delete`, and deliberately so:
	//
	// `audit.view` reads the RECORD of what happened. This is the DECISION about
	// what happens next - it can release or refuse content a creator uploaded.
	// A support engineer who may read logs is not necessarily someone who should
	// be able to publish a video the AI refused.
	//
	// `media.delete` removes bytes. That is a different power, and a reviewer who
	// can already approve should not silently gain the ability to destroy, nor
	// should a cleaner gain the ability to approve.
	PermModerationReview = "moderation.review"
)

// allPermissions is the closed vocabulary, with what each one MEANS.
//
// A description is not documentation for its own sake: this string is what an
// operator reads when deciding who gets what, and a permission called
// "service.grant" with no explanation invites a guess.
var allPermissions = map[string]struct {
	Description string
	Category    string
	Delegating  bool
}{
	PermChannelCreate: {"Create a channel", "content", false},
	PermChannelEdit:   {"Edit any channel", "content", false},
	PermChannelDelete: {"Delete any channel", "content", false},
	PermMediaUpload:   {"Upload and process media", "content", false},
	PermMediaDelete:   {"Delete stored media", "content", false},
	PermProjectSave:   {"Save and export projects", "content", false},

	PermPlanView:      {"See plans and pricing", "commerce", false},
	PermAdsManage:     {"Create and manage ad campaigns", "commerce", false},
	PermPayoutView:    {"See the payout ledger", "commerce", false},
	PermPayoutApprove: {"Approve and release payouts", "commerce", false},

	PermUserView:     {"See other users", "people", false},
	PermServiceGrant: {"Grant or revoke access to a service", "people", true},
	PermRoleAppoint:  {"Appoint someone to a role you hold", "people", true},

	PermMetricsView: {"Read platform metrics", "platform", false},
	PermAuditView:   {"Read the audit trail", "platform", false},
	PermRoleAdmin:   {"Create and edit roles and their permissions", "platform", true},

	// Content moderation. Not delegating: the power to publish refused content
	// should not be something one reviewer can hand to another without an admin.
	PermModerationReview: {"Review and approve held-back content", "moderation", false},
}

// PermissionNames lists the closed vocabulary, sorted for stable output.
func PermissionNames() []string {
	out := make([]string, 0, len(allPermissions))
	for k := range allPermissions {
		out = append(out, k)
	}
	sortStrings(out)
	return out
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// System role definitions. Seeded at boot, and `is_system` so a later deploy
// cannot rename or delete them out from under existing appointments.
var systemRoles = []struct {
	Name        string
	Description string
	Rank        int
	Permissions []string
}{
	{
		// Rank 10. Can see the platform but cannot change anyone's access, which
		// is the whole point of separating this from the roles below.
		Name: "support", Description: "Read-only support access", Rank: 10,
		Permissions: []string{PermUserView, PermMetricsView, PermAuditView, PermPlanView},
	},
	{
		Name: "creator", Description: "Creates and manages their own content", Rank: 20,
		Permissions: []string{
			PermChannelCreate, PermChannelEdit, PermChannelDelete,
			PermMediaUpload, PermMediaDelete, PermProjectSave, PermAdsManage,
		},
	},
	{
		Name: "finance", Description: "Reviews and approves payouts", Rank: 30,
		Permissions: []string{PermPayoutView, PermPayoutApprove, PermPlanView, PermMetricsView},
	},
	{
		Name: "ops", Description: "Runs the platform day to day", Rank: 40,
		Permissions: []string{
			PermUserView, PermMetricsView, PermAuditView, PermServiceGrant,
			PermRoleAppoint, PermChannelEdit, PermChannelDelete, PermMediaDelete,
			// Content moderation is the job: resolving what the automated screener
			// could not decide. Given to `ops` rather than `support` because
			// `support` is read-only by design, and approving content is a write.
			PermModerationReview,
		},
	},
}

// RBAC answers "what may this person do".
type RBAC struct {
	db    *gorm.DB
	users *ServiceAccess
}

// NewRBAC builds the service.
func NewRBAC(db *gorm.DB, users *ServiceAccess) *RBAC {
	return &RBAC{db: db, users: users}
}

// Seed inserts the permission vocabulary and the system roles.
//
// Called on every boot. Idempotent by primary key: re-running updates the
// description and the rank without disturbing appointments, because a role that
// moved rank must not silently change who outranks whom mid-deployment.
func (r *RBAC) Seed(ctx context.Context) error {
	for _, name := range PermissionNames() {
		p := allPermissions[name]
		perm := model.Permission{
			Name: name, Description: p.Description,
			Category: p.Category, IsDelegating: p.Delegating,
		}
		if err := r.db.WithContext(ctx).
			Where("name = ?", name).
			Assign(perm).FirstOrCreate(&perm).Error; err != nil {
			return err
		}
	}

	for _, def := range systemRoles {
		role := model.Role{
			Name: def.Name, Description: def.Description,
			Rank: def.Rank, IsSystem: true, Delegable: true,
		}
		if err := r.db.WithContext(ctx).
			Where("name = ?", def.Name).Assign(role).FirstOrCreate(&role).Error; err != nil {
			return err
		}

		for _, p := range def.Permissions {
			rp := model.RolePermission{RoleID: role.ID, Permission: p}
			if err := r.db.WithContext(ctx).
				Where("role_id = ? AND permission = ?", role.ID, p).
				FirstOrCreate(&rp).Error; err != nil {
				return err
			}
		}
	}

	// ---- VERIFY THE CATALOGUE IS ACTUALLY THERE ----
	//
	// This is the fix for a failure that was INVISIBLE AND TOTAL.
	//
	// `Seed` logged "permission catalogue seeded" and returned nil while the
	// `permissions` and `role_permissions` tables were both EMPTY. Nothing failed
	// - no error, no crash - and the consequence was that `Can()` answered `false`
	// for every permission in the product. A creator holding the `creator` role
	// with `channel.create` in it got "You do not have the 'channel.create'
	// capability", because the JOIN that resolves the permission had nothing to
	// join to.
	//
	// The symptom looked exactly like a permissions bug, and the diagnosis took a
	// long time because every layer above the seed was correct: the role was
	// appointed, the constant existed, the middleware was wired, the query was
	// right. The only thing wrong was the one write nobody verified.
	//
	// A seed that cannot report its own success is not a seed. Counting the rows
	// it was supposed to write turns "logged success, wrote nothing" into a fatal
	// error at boot, which is the only place it CAN be fixed.
	var permCount, rolePermCount int64
	if err := r.db.WithContext(ctx).Model(&model.Permission{}).Count(&permCount).Error; err != nil {
		return fmt.Errorf("could not verify the permission catalogue: %w", err)
	}
	if err := r.db.WithContext(ctx).Model(&model.RolePermission{}).Count(&rolePermCount).Error; err != nil {
		return fmt.Errorf("could not verify the role permission grants: %w", err)
	}
	if permCount == 0 {
		return fmt.Errorf("permission catalogue is EMPTY after seeding - every permission " +
			"check would answer no. Refusing to start: an unavailable authorization " +
			"layer must read as a failure, not as a closed door nobody can diagnose")
	}
	if rolePermCount == 0 {
		return fmt.Errorf("no role carries any permission after seeding (%d permissions " +
			"exist) - every role would be empty and every privileged action refused. " +
			"Refusing to start", permCount)
	}
	return nil
}

// EffectivePermissions is every permission a user holds RIGHT NOW.
//
// A superadmin gets every permission in the vocabulary, and a synthetic marker
// for the ones outside it - so a caller can render "everything" without
// enumerating, and without the possibility of missing one.
func (r *RBAC) EffectivePermissions(ctx context.Context, userID uuid.UUID) (map[string]bool, error) {
	isSuper, err := r.users.IsSuperAdmin(ctx, userID)
	if err != nil {
		// Fail CLOSED. The opposite of the device-slot decision, and the reason
		// is the asymmetry: a service-access lookup that fails open costs one
		// seat, a PERMISSION lookup that fails open is a privilege escalation.
		return map[string]bool{}, nil
	}
	if isSuper {
		all := make(map[string]bool, len(allPermissions))
		for _, n := range PermissionNames() {
			all[n] = true
		}
		all["*"] = true
		return all, nil
	}

	// A hand-written SELECT rather than the model API, because this query spans
	// three tables and the answer is a flat permission list. Going through the
	// ORM here would mean either three queries or a struct that exists only to be
	// thrown away.
	type permRow struct {
		Permission string `gorm:"column:permission"`
	}
	var found []permRow
	// `err` is already in scope from the superadmin check above, so this is `=`
	// not `:=` - and the error is deliberately swallowed into a fail-closed
	// empty set, which is the whole point of the branch.
	scanErr := r.db.WithContext(ctx).Raw(`
		SELECT DISTINCT rp.permission
		FROM appointments a
		JOIN role_permissions rp ON rp.role_id = a.role_id
		WHERE a.user_id = ?
		  AND a.revoked_at IS NULL
		  AND (a.expires_at IS NULL OR a.expires_at > ?)
	`, userID, time.Now().UTC()).Scan(&found).Error
	if scanErr != nil {
		return map[string]bool{}, nil
	}

	out := make(map[string]bool, len(found))
	for _, p := range found {
		out[p.Permission] = true
	}
	return out, nil
}

// Can reports whether a user holds a permission.
//
// The single question every service asks. Fails closed, always.
func (r *RBAC) Can(ctx context.Context, userID uuid.UUID, permission string) (bool, error) {
	if _, ok := allPermissions[permission]; !ok {
		// An unknown permission is a caller bug, and answering "yes" to a
		// permission this codebase does not define is how a typo becomes a
		// backdoor.
		return false, fmt.Errorf("%w: %q", ErrUnknownPermission, permission)
	}
	perms, err := r.EffectivePermissions(ctx, userID)
	if err != nil {
		return false, nil
	}
	return perms["*"] || perms[permission], nil
}

// CanAny reports whether the user holds AT LEAST ONE of the permissions.
//
// For a page that needs "edit or own it" - a list the user may see entries in
// for things they created, and the creator of a thing may always act on it.
// A single all-of check would deny a creator access to their own work.
func (r *RBAC) CanAny(ctx context.Context, userID uuid.UUID, permissions ...string) (bool, error) {
	perms, err := r.EffectivePermissions(ctx, userID)
	if err != nil {
		return false, nil
	}
	if perms["*"] {
		return true, nil
	}
	for _, p := range permissions {
		if perms[p] {
			return true, nil
		}
	}
	return false, nil
}

// RoleRank is a role's delegation rank.
func (r *RBAC) RoleRank(ctx context.Context, roleID uuid.UUID) (int, error) {
	var role model.Role
	if err := r.db.WithContext(ctx).Where("id = ?", roleID).First(&role).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, fmt.Errorf("%w: %s", ErrUnknownRole, roleID)
		}
		return 0, err
	}
	return role.Rank, nil
}

// HighestRank is the highest rank the user currently holds, via any live
// appointment. A superadmin is above every system role.
func (r *RBAC) HighestRank(ctx context.Context, userID uuid.UUID) (int, error) {
	isSuper, err := r.users.IsSuperAdmin(ctx, userID)
	if err != nil {
		return 0, err
	}
	if isSuper {
		return int(^uint(0) >> 1), nil
	}

	var maxRank *int
	err = r.db.WithContext(ctx).
		Table("appointments a").
		Select("MAX(r.rank)").
		Joins("JOIN roles r ON r.id = a.role_id").
		Where("a.user_id = ? AND a.revoked_at IS NULL", userID).
		Where("(a.expires_at IS NULL OR a.expires_at > ?)", time.Now().UTC()).
		Scan(&maxRank).Error
	if err != nil {
		return 0, err
	}
	if maxRank == nil {
		return 0, nil
	}
	return *maxRank, nil
}

// HasRole checks if a user has a specific role (by name) via active appointment.
func (r *RBAC) HasRole(ctx context.Context, userID uuid.UUID, roleName string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Table("appointments a").
		Joins("JOIN roles r ON r.id = a.role_id").
		Where("a.user_id = ? AND r.name = ? AND a.revoked_at IS NULL", userID, roleName).
		Where("(a.expires_at IS NULL OR a.expires_at > ?)", time.Now().UTC()).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// Appoint gives a user a role.
//
// THE BOUND. A granter can only appoint a role STRICTLY below their own, and
// can never appoint a role whose permission set exceeds their own effective one.
// Both halves matter:
//
//	rank  - stops "an employee appoints a peer", which is how flat structures
//	         quietly grow hierarchies nobody designed.
//	permissions - stops "someone with one narrow permission appoints themselves
//	         into a role carrying ten more", which rank alone does not catch.
//
// FAILS CLOSED. A database error means the appointment does not happen.
// RoleIDByName resolves a role name to its id.
//
// Exists because registration needs to appoint the `creator` role and cannot reach
// `r.db` from another package. Case-insensitive to match `Seed`, which is what
// defines the names — a lookup that disagreed with the seeder on capitalisation
// would fail only for roles whose name happens to differ in case, which is the
// worst time to find out.
func (r *RBAC) RoleIDByName(ctx context.Context, name string) (uuid.UUID, error) {
	var role model.Role
	if err := r.db.WithContext(ctx).
		Where("lower(name) = lower(?)", name).
		First(&role).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return uuid.Nil, fmt.Errorf("%w: role %q", ErrUnknownRole, name)
		}
		return uuid.Nil, err
	}
	return role.ID, nil
}

func (r *RBAC) Appoint(
	ctx context.Context,
	granterID, userID, roleID uuid.UUID,
	reason string,
	expiresAt *time.Time,
) (*model.Appointment, error) {
	if reason == "" {
		return nil, ErrNoReason
	}

	var role model.Role
	if err := r.db.WithContext(ctx).Where("id = ?", roleID).First(&role).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("%w: %s", ErrUnknownRole, roleID)
		}
		// An unreadable role is NOT an appointment.
		return nil, err
	}
	if !role.Delegable {
		return nil, fmt.Errorf("%w: %s", ErrRoleNotDelegable, role.Name)
	}

	granterRank, err := r.HighestRank(ctx, granterID)
	if err != nil {
		return nil, err
	}

	// Superadmin has max int, so this only bites for non-superadmins - which is
	// exactly the population that must not be able to promote themselves.
	if role.Rank >= granterRank {
		return nil, fmt.Errorf("%w: %s (rank %d) is not below yours (rank %d)",
			ErrSelfEscalation, role.Name, role.Rank, granterRank)
	}

	// The second half: even a lower rank must not carry permissions the granter
	// lacks. A rank ordering alone is a proxy for power, not the thing itself.
	rolePerms, err := r.rolePermissions(ctx, roleID)
	if err != nil {
		return nil, err
	}
	granterPerms, err := r.EffectivePermissions(ctx, granterID)
	if err != nil {
		return nil, err
	}
	if !granterPerms["*"] {
		for p := range rolePerms {
			if !granterPerms[p] {
				return nil, fmt.Errorf("%w: %s includes %q, which you do not hold",
					ErrNotAuthorised, role.Name, p)
			}
		}
	}

	now := time.Now().UTC()
	var existing model.Appointment
	err = r.db.WithContext(ctx).
		Where("user_id = ? AND role_id = ? AND revoked_at IS NULL", userID, roleID).
		First(&existing).Error

	switch {
	case err == nil:
		existing.AppointedBy = &granterID
		existing.AppointedAt = now
		existing.ExpiresAt = expiresAt
		existing.RevokedAt = nil
		existing.RevokedBy = nil
		existing.RevokedReason = ""
		existing.Reason = reason
		if err := r.db.WithContext(ctx).Save(&existing).Error; err != nil {
			return nil, err
		}
		return &existing, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		appt := &model.Appointment{
			ID: uuid.New(), UserID: userID, RoleID: roleID,
			AppointedBy: &granterID, AppointedAt: now,
			ExpiresAt: expiresAt, Reason: reason,
		}
		if err := r.db.WithContext(ctx).Create(appt).Error; err != nil {
			return nil, err
		}
		return appt, nil
	default:
		// Unreadable state is not a re-appointment.
		return nil, err
	}
}

func (r *RBAC) rolePermissions(ctx context.Context, roleID uuid.UUID) (map[string]bool, error) {
	var rows []string
	err := r.db.WithContext(ctx).Model(&model.RolePermission{}).
		Where("role_id = ?", roleID).Pluck("permission", &rows).Error
	out := make(map[string]bool, len(rows))
	for _, p := range rows {
		out[p] = true
	}
	return out, err
}

// Revoke removes an appointment, keeping the row.
func (r *RBAC) Revoke(ctx context.Context, granterID, userID, roleID uuid.UUID, reason string) error {
	if reason == "" {
		return ErrNoReason
	}

	granterRank, err := r.HighestRank(ctx, granterID)
	if err != nil {
		return err
	}
	targetRank, err := r.RoleRank(ctx, roleID)
	if err != nil {
		return err
	}
	// You can revoke your own appointments and those below you - not a superior's.
	// Otherwise a junior could remove a senior's authority.
	if targetRank > granterRank {
		return fmt.Errorf("%w: cannot revoke a role above your own (rank %d)", ErrNotAuthorised, targetRank)
	}

	res := r.db.WithContext(ctx).Model(&model.Appointment{}).
		Where("user_id = ? AND role_id = ? AND revoked_at IS NULL", userID, roleID).
		Updates(map[string]any{
			"revoked_at": time.Now().UTC(), "revoked_by": granterID,
			"revoked_reason": reason,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("no live appointment for that role")
	}
	return nil
}

// Registry is the privilege list: every person, role and permission, with who
// granted it and when it ends.
//
// Read from the `privilege_registry` VIEW, not assembled here. The view is
// derived from the tables, so a registry that could be written directly would
// eventually disagree with the things it claims to summarise.
func (r *RBAC) Registry(ctx context.Context) ([]model.PrivilegeRow, error) {
	var out []model.PrivilegeRow
	err := r.db.WithContext(ctx).Table("privilege_registry").Find(&out).Error
	return out, err
}
