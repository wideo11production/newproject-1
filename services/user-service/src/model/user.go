package model

import (
	"time"

	"github.com/google/uuid"
)

// ProfessionalRole — user ka demographic classification field
// (user directive: role-based segmentation / adaptive toolkits).
//
// Valid values: "advocate", "lawyer", "student", "tutor",
//               "middle_income_earner", "lower_middle_income_earner",
//               "other", "" (unset).
type ProfessionalRole string

const (
	RoleAdvocate             ProfessionalRole = "advocate"
	RoleLawyer               ProfessionalRole = "lawyer"
	RoleStudent              ProfessionalRole = "student"
	RoleTutor                ProfessionalRole = "tutor"
	RoleMiddleIncomeEarner   ProfessionalRole = "middle_income_earner"
	RoleLowerMiddleEarner    ProfessionalRole = "lower_middle_income_earner"
	RoleOther                ProfessionalRole = "other"
	RoleUnset                ProfessionalRole = ""
)

type User struct {
	ID                uint             `gorm:"primarykey" json:"id"`
	UUID              uuid.UUID        `gorm:"type:uuid;not null;uniqueIndex" json:"uuid"`
	Email             string           `gorm:"uniqueIndex;not null;size:255" json:"email"`
	PasswordHash      string           `gorm:"type:text" json:"-"`
	Username          string           `gorm:"uniqueIndex;not null;size:100" json:"username"`
	Status            string           `gorm:"default:'active'" json:"status"`
	Verified          bool             `gorm:"default:false" json:"verified"`
	ProfessionalRole  ProfessionalRole `gorm:"size:50;default:'';index" json:"professional_role"`
	CreatedAt         time.Time        `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt         time.Time        `gorm:"autoUpdateTime" json:"updated_at"`
}

func (User) TableName() string {
	return "users"
}
