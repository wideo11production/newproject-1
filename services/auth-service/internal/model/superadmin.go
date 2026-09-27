// Superadmin, recovery accounts, device lock aur session tracking
//
// YE MODULE Q4 ke baaki hisse cover karta hai:
//   1. Role field (superadmin / recovery / staff / user)
//   2. 2 RECOVERY accounts - agar main superadmin ke sath kuch ho jaye
//      (account lock, credential leak, device kho jaaye) to ye 2 accounts
//      se access mil sakta hai
//   3. Device lock (aapne "retina lock" kaha) - superadmin ka login ek
//      SPECIFIC device se hi chalega, doosre laptop se nahi
//   4. Session tracking - "kitne time se online hai, kab aaya, kab gaya"
//
// Hinglish comments: har block ka arth
package model

import (
	"time"

	"github.com/google/uuid"
)

// User roles
//
// NOTE: Ye hierarchy hai - permissions role se derive hoti hain.
const (
	// RoleUser: normal user (99% users)
	RoleUser = "user"
	// RoleStaff: staff/manager - kuch extra access
	RoleStaff = "staff"
	// RoleSuperadmin: master root - full access
	RoleSuperadmin = "superadmin"
	// RoleSuperadminRecovery: RECOVERY account - full access jaisa superadmin,
	// sirf alag email se. Tab use hota hai jab main superadmin account
	// compromise ya lock ho jaye.
	RoleSuperadminRecovery = "superadmin_recovery"
)

// SuperadminAccount - superadmin/recovery account ki registry
//
// KYUN ALAG TABLE: In accounts ko special treatment chahiye -
// device lock, recovery pairing, rotation history. Ye user table se
// alag concern hai isliye alag rakha hai (user table simple rahega).
type SuperadminAccount struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Email  string    `gorm:"size:255;not null;uniqueIndex" json:"email"`

	// Role: superadmin ya superadmin_recovery
	Role string `gorm:"size:32;not null" json:"role"`

	// Slot: recovery accounts ke liye 1 ya 2 (main ka slot 0)
	// Isse pata chalta hai kaunsa recovery account hai
	Slot int `gorm:"not null;default:0" json:"slot"`

	// ---- Device lock (retina lock) ----
	//
	// DeviceLocked: agar true hai, to ye account SIRF LockedDeviceID se
	// login kar sakta hai. Doosre laptop se login REJECT.
	DeviceLocked  bool   `gorm:"not null;default:false" json:"device_locked"`
	LockedDeviceID string `gorm:"size:128" json:"-"`

	// LockedAt: kab lock kiya gaya
	LockedAt *time.Time `json:"locked_at"`

	// ---- Recovery pairing ----
	//
	// RecoveryCodeHash: ye account kisi ko recover karne ke liye jo
	// one-time code use karega uska hash. Plaintext store nahi.
	RecoveryCodeHash string `gorm:"size:128" json:"-"`

	// LastRecoveryUsedAt: last time kisi ne ye code use kiya
	LastRecoveryUsedAt *time.Time `json:"last_recovery_used_at"`

	// IsActive: account active hai ya disabled
	IsActive bool `gorm:"not null;default:true" json:"is_active"`

	// Notes: admin ke liye note (e.g., "primary", "backup-1")
	Notes string `gorm:"size:255" json:"notes"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SuperadminAccount) TableName() string {
	return "superadmin_accounts" }

// UserSession - user ki session tracking (kitne time online tha)
//
// Q4.2 me aapne kaha "kitne time se hai, kab aaya, kab gaya" - ye table
// wahi data store karti hai.
type UserSession struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Email  string    `gorm:"size:255;index" json:"email"`

	// ---- Session lifecycle ----

	// StartedAt: kab login hua
	StartedAt time.Time `gorm:"not null;index" json:"started_at"`

	// LastSeenAt: last activity (heartbeat update hota rahega)
	LastSeenAt time.Time `gorm:"not null;index" json:"last_seen_at"`

	// EndedAt: kab logout hua (nil = abhi bhi online)
	EndedAt *time.Time `json:"ended_at"`

	// DurationSeconds: total kitna time online raha (seconds)
	DurationSeconds int64 `gorm:"not null;default:0" json:"duration_seconds"`

	// ---- Context ----

	IPAddress  string `gorm:"size:64" json:"ip_address"`
	UserAgent  string `gorm:"size:200" json:"user_agent"`
	DeviceID   string `gorm:"size:128;index" json:"device_id"`
	DeviceName string `gorm:"size:128" json:"device_name"`

	// Platform: web / ios / android (future)
	Platform string `gorm:"size:32" json:"platform"`

	// IsActive: abhi online hai ya nahi
	IsActive bool `gorm:"not null;default:true;index" json:"is_active"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (UserSession) TableName() string {
	return "user_sessions" }

// IsOnline abhi online hai ya nahi
func (s *UserSession) IsOnline() bool {
	return s.IsActive && s.EndedAt == nil
}

// TestAccountMarker - testing accounts ko mark karne ke liye
//
// Aapne kaha: "production me live kare to ek button bana do jisse sab
// testing account delete hokar sirf superadmin ka account bache"
//
// Is table se hum track karte hain kaunsa account TESTING hai (dummy
// balance wala, friends ko diya gaya). Production cleanup inhi ko delete karega.
type TestAccountMarker struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"user_id"`
	Email  string    `gorm:"size:255;not null;index" json:"email"`

	// MarkedBy: kisne mark kiya (superadmin)
	MarkedBy string `gorm:"size:255" json:"marked_by"`

	// Reason: kyun mark kiya ("sandbox-friend", "demo", etc)
	Reason string `gorm:"size:255" json:"reason"`

	// DummyBalanceINR: is account pe kitna dummy paisa tha (cleanup report ke liye)
	DummyBalanceINR float64 `gorm:"type:numeric(20,2);default:0" json:"dummy_balance_inr"`

	// IsPurged: production cleanup me delete ho chuka hai?
	IsPurged bool `gorm:"not null;default:false" json:"is_purged"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (TestAccountMarker) TableName() string { return "test_account_markers" }

// Superadmin constants
const (
	// RecoveryAccountCount: kitne recovery accounts (aapne kaha 2)
	RecoveryAccountCount = 2
	// SessionHeartbeatSeconds: kitne second baad heartbeat update
	SessionHeartbeatSeconds = 60
	// SessionIdleTimeoutMinutes: itni der idle = session considered ended
	SessionIdleTimeoutMinutes = 30
)
