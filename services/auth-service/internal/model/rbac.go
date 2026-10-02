package model

import (
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// SERVICE ACCESS AND RBAC
// =============================================================================
//
// The requirement is in `updatedtodo.md` Session 17: one login for every
// service, and one answer to "what may this person do?".
//
// Three ideas, kept separate because they are separate questions:
//
//	UserService   - may this person OPEN this app?
//	Appointment   - what may they DO, and who gave them that?
//	RolePermission- the catalogue those appointments point at
//
// A single `users.role` column could answer the first two for one service and
// nothing for the rest, which is the problem being fixed.

// UserService is one person's access to one app.
//
// `RevokedAt` rather than a delete. "Who had access to what" has to stay
// answerable, and a deleted row cannot prove an ex-employee no longer has it -
// it only proves nobody remembers granting it.
//
// A superadmin holds NO rows here. They hold every service implicitly; an
// explicit row would be a second source of truth about the most powerful
// account in the system.
type UserService struct {
	ID      uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID  uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Service string    `gorm:"size:32;not null" json:"service"`

	GrantedBy *uuid.UUID `gorm:"type:uuid" json:"granted_by,omitempty"`
	GrantedAt time.Time  `gorm:"autoCreateTime" json:"granted_at"`

	RevokedAt     *time.Time `gorm:"index" json:"revoked_at,omitempty"`
	RevokedBy     *uuid.UUID `gorm:"type:uuid" json:"revoked_by,omitempty"`
	RevokedReason string     `gorm:"size:500" json:"revoked_reason,omitempty"`
	CreatedAt     time.Time  `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time  `gorm:"autoUpdateTime" json:"updated_at"`
}

func (UserService) TableName() string { return "user_services" }

// IsLive reports whether this grant is in force right now.
func (u UserService) IsLive() bool { return u.RevokedAt == nil }

// Role is a named bundle of permissions.
//
// `Rank` orders delegation: you may only appoint a role with a LOWER rank than
// your own. Without an ordering there is no way to express "cannot promote
// yourself", and the delegation bound would be unenforceable.
type Role struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name        string    `gorm:"size:48;not null;uniqueIndex" json:"name"`
	Description string    `gorm:"size:500" json:"description,omitempty"`
	Rank        int       `gorm:"not null;default:0" json:"rank"`

	// A SYSTEM role is defined by this codebase. Renaming or deleting one would
	// leave existing appointments pointing at a role that no longer means what it
	// did, so both are refused.
	IsSystem bool `gorm:"not null;default:false" json:"is_system"`

	// Some roles must never be delegable. Kept as data so a future role is not
	// accidentally handed out by a loop that assumes everything is delegable.
	Delegable bool `gorm:"not null;default:true" json:"delegable"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Role) TableName() string { return "roles" }

// Permission is one thing a person may do.
//
// The name is the primary key and comes from a CLOSED set in Go. A permission
// that can be invented at runtime is one nobody has reviewed, and the natural
// default for an unknown permission is "allow".
type Permission struct {
	Name string `gorm:"size:64;primaryKey" json:"name"`

	Description string `gorm:"size:500;not null" json:"description"`
	Category    string `gorm:"size:24;not null;default:'general'" json:"category"`

	// A permission that hands out OTHER permissions is the dangerous class, and
	// is tracked separately so it can be reviewed on its own.
	IsDelegating bool `gorm:"not null;default:false" json:"is_delegating"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (Permission) TableName() string { return "permissions" }

// RolePermission grants a permission to a role.
type RolePermission struct {
	RoleID     uuid.UUID `gorm:"type:uuid;primaryKey" json:"role_id"`
	Permission string    `gorm:"size:64;primaryKey" json:"permission"`
}

func (RolePermission) TableName() string { return "role_permissions" }

// Appointment is one person holding one role.
//
// `Reason` is NOT NULL in the schema. A row with no reason is a row nobody will
// be able to explain at audit, and "why does this person have this" is the
// first question asked about any privilege in the system.
//
// `ExpiresAt` makes time-limited authority the DEFAULT. An open-ended
// appointment is indistinguishable from a permanent one, and that difference is
// exactly what a review needs to see.
type Appointment struct {
	ID     uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	RoleID uuid.UUID `gorm:"type:uuid;not null;index" json:"role_id"`

	AppointedBy *uuid.UUID `gorm:"type:uuid" json:"appointed_by,omitempty"`
	AppointedAt time.Time  `gorm:"autoCreateTime" json:"appointed_at"`

	ExpiresAt *time.Time `gorm:"index" json:"expires_at,omitempty"`

	RevokedAt     *time.Time `gorm:"index" json:"revoked_at,omitempty"`
	RevokedBy     *uuid.UUID `gorm:"type:uuid" json:"revoked_by,omitempty"`
	RevokedReason string     `gorm:"size:500" json:"revoked_reason,omitempty"`

	Reason string `gorm:"size:500;not null" json:"reason"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Appointment) TableName() string { return "appointments" }

// IsLive reports whether this appointment confers authority right now.
//
// Derived from the clock, never stored as a status: a status that has to be
// kept in step with `expires_at` is a status that eventually is not, and an
// appointment that reads as live after it expired is the worst kind of stale
// flag - it keeps granting access nobody meant to give.
func (a Appointment) IsLive(now time.Time) bool {
	if a.RevokedAt != nil {
		return false
	}
	return a.ExpiresAt == nil || a.ExpiresAt.After(now)
}

// PrivilegeRow is one line of the registry: a person, a role, a permission.
type PrivilegeRow struct {
	UserID       uuid.UUID  `gorm:"column:user_id" json:"user_id"`
	Email        string     `gorm:"column:email" json:"email"`
	Role         string     `gorm:"column:role" json:"role"`
	Rank         int        `gorm:"column:rank" json:"rank"`
	Permission   string     `gorm:"column:permission" json:"permission"`
	Category     string     `gorm:"column:category" json:"category"`
	IsDelegating bool       `gorm:"column:is_delegating" json:"is_delegating"`
	AppointedBy  *uuid.UUID `gorm:"column:appointed_by" json:"appointed_by,omitempty"`
	AppointedAt  *time.Time `gorm:"column:appointed_at" json:"appointed_at,omitempty"`
	ExpiresAt    *time.Time `gorm:"column:expires_at" json:"expires_at,omitempty"`
	Reason       string     `gorm:"column:reason" json:"reason"`
	IsSuperAdmin bool       `gorm:"column:is_superadmin" json:"is_superadmin"`
}
