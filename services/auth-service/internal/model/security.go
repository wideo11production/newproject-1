// Security subsystem - models
//
// YE POORI SECURITY CHAIN EK SAATH design ki gayi hai kyunki ye sab ek
// dusre se JUDAI hui hain (lockout state, PIN, questions, device limits
// sab ek hi flow me kaam karte hain). Adhoora lockout system karna worse
// hota hai - isliye ek hi unit me banaya ja raha hai.
//
// FLOW (jispar ye base karta hai):
//   1. 3 galat passwords -> lockout_state = "pin_required"
//   2. User se 6-digit PIN puchha jata hai
//   3. Galat PIN ek baar -> 3 MINUTE countdown warning + blocked
//   4. Sahi PIN -> login allow
//   5. Login ke baad MANDATORY security setup (biometric + PIN + 3 questions)
//      complete hone tak DASHBOARD BLOCKED
//
// Hinglish comments: har block ka arth
package model

import (
	"time"

	"github.com/google/uuid"
)

// Lockout states - user ka current security state
const (
	// LockoutStateNone - normal, koi restriction nahi
	LockoutStateNone = "none"
	// LockoutStatePINRequired - 3 galat password hue, ab PIN chahiye
	LockoutStatePINRequired = "pin_required"
	// LockoutStateBlocked - galat PIN, ab 3 minute countdown
	LockoutStateBlocked = "blocked"
)

// SecurityProfile - per-user security state (1:1 with user)
//
// WHY SEPARATE TABLE (User me fields nahi rakhe):
// Ye security state BOHOT baar update hota hai (har failed attempt), jabki
// User table slow-changing hai. Alag table se user row ka write load
// kam rehta hai - production me contention avoid hoti hai.
type SecurityProfile struct {
	// UserID primary key - ek user ka ek profile
	UserID uuid.UUID `gorm:"type:uuid;primary_key" json:"user_id"`

	// ---- Lockout / failed attempt tracking ----

	// FailedPasswordAttempts: consecutive galat passwords ka count.
	// 3 hone par lockout trigger hota hai.
	FailedPasswordAttempts int `gorm:"not null;default:0" json:"failed_password_attempts"`

	// LockoutState: none / pin_required / blocked
	LockoutState string `gorm:"size:32;not null;default:'none'" json:"lockout_state"`

	// LockoutExpiresAt: blocked state kab khatam hoga (3 min countdown).
	// Nil ka matlab - abhi lock nahi hai.
	LockoutExpiresAt *time.Time `json:"lockout_expires_at"`

	// ---- Mandatory enrollment tracking ----

	// PINConfigured: user ne 6-digit PIN set kiya hai ya nahi
	PINConfigured bool `gorm:"not null;default:false" json:"pin_configured"`

	// BiometricRegistered: user ne WebAuthn credential register kiya hai ya nahi
	BiometricRegistered bool `gorm:"not null;default:false" json:"biometric_registered"`

	// SecurityQuestionsConfigured: 3 questions set hain ya nahi.
	// NOTE: ye boolean hai par backend me actual count bhi verify hota hai
	// (exactly 3) - boolean sirf quick check ke liye.
	SecurityQuestionsConfigured bool `gorm:"not null;default:false" json:"security_questions_configured"`

	// SecuritySetupComplete: SAARI mandatory cheezein complete hain.
	// Jab tak ye false hai, dashboard access BLOCKED hai.
	SecuritySetupComplete bool `gorm:"not null;default:false" json:"security_setup_complete"`

	// SecuritySetupCompletedAt: kab complete hua
	SecuritySetupCompletedAt *time.Time `json:"security_setup_completed_at"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SecurityProfile) TableName() string { return "security_profiles" }

// SecurityPIN - 6-digit hidden PIN (HASHED, never plaintext)
type SecurityPIN struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"user_id"`

	// PINHash: PIN ka salted hash. Plaintext KABHI store nahi hota.
	// Format: "sha256$<salt-hex>$<hash-hex>"
	// SHA-256 use kar rahe hain (bcrypt nahi) kyunki PIN sirf 6 digits
	// (10^6 combinations) hai - bcrypt slow-by-design hai aur yahan
	// unnecessary cost hai. Salt + SHA-256 industry standard hai chhoti
	// secrets ke liye. Note: production me rate limiting MUST hai
	// (jo humne already hai) - warna 10^6 brute force possible hai.
	PINHash string `gorm:"size:128;not null" json:"-"`

	// FailedPINAttempts: galat PIN ka count
	FailedPINAttempts int `gorm:"not null;default:0" json:"failed_pin_attempts"`

	// PINLockedUntil: PIN lock kab tak
	PINLockedUntil *time.Time `json:"pin_locked_until"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SecurityPIN) TableName() string { return "security_pins" }

// SecurityQuestion - exactly 3 per user (SPEC requirement)
type SecurityQuestion struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`

	// QuestionKey: question ka stable identifier
	// (jaise "first_school", "mother_maiden_name") - UI me label map hota hai
	QuestionKey string `gorm:"size:64;not null" json:"question_key"`

	// AnswerHash: normalized answer ka salted SHA-256 hash
	// NOTE: answers bhi normalize karte hain (lowercase + trim) taaki
	// "Delhi " aur "delhi" same match karein
	AnswerHash string `gorm:"size:128;not null" json:"-"`

	// Position: 1, 2, ya 3 (exactly three)
	Position int `gorm:"not null" json:"position"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SecurityQuestion) TableName() string { return "security_questions" }

// DeviceAccount - device fingerprint se account mapping
//
// DEVICE LIMIT (SPEC): max 3 unique accounts per device signature.
// Is table se count karte hain. 4th account banane par reject.
type DeviceAccount struct {
	ID uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`

	// Fingerprint: device ka unique signature
	//
	// CRITICAL SCHEMA FIX: pehle yahan `uniqueIndex` tha jo device ko sirf
	// EK account rakhne par majboor karta tha - yaani 3-account limit hi
	// kaam hi nahi kar sakta tha (2nd insert se hi unique violation).
	// Ab sirf (fingerprint, user_id) pair unique hai:
	//   - ek user ek device pe sirf ek baar register hoga (dedup)
	//   - par ek device pe 3 ALAG users aa sakte hain (jo chahiye tha)
	Fingerprint string `gorm:"size:128;not null;uniqueIndex:idx_fingerprint_user,priority:1" json:"fingerprint"`

	// UserID: is device pe jo account hai
	UserID uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_fingerprint_user,priority:2" json:"user_id"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (DeviceAccount) TableName() string { return "device_accounts" }

// SecurityEvent - security audit trail
//
// YE "AWARENESS REPORTS" ka backend source hai - superadmin dashboard
// par ye events dikhte hain.
type SecurityEvent struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID *uuid.UUID `gorm:"type:uuid;index" json:"user_id,omitempty"`
	Email  string     `gorm:"size:255;index" json:"email,omitempty"`

	// EventType: LOGIN_FAILED / LOCKOUT_TRIGGERED / PIN_FAILED /
	// DEVICE_LIMIT_EXCEEDED / CONFIG_TAMPER / SECURITY_SETUP_COMPLETED
	EventType string `gorm:"size:64;not null;index" json:"event_type"`

	// Detail: human readable description
	Detail string `gorm:"size:500" json:"detail"`

	IPAddress string `gorm:"size:64" json:"ip_address"`
	UserAgent string `gorm:"size:200" json:"user_agent"`

	// Timestamp: microsecond precision - "when exactly" track karne ke liye
	Timestamp time.Time `gorm:"not null;index" json:"timestamp"`

	CreatedAt time.Time `json:"created_at"`
}

func (SecurityEvent) TableName() string { return "security_events" }

// Security event types (constants - typos avoid karne ke liye)
const (
	EventLoginFailed            = "LOGIN_FAILED"
	EventLoginSuccess           = "LOGIN_SUCCESS"
	EventLockoutTriggered       = "LOCKOUT_TRIGGERED"
	EventPINFailed              = "PIN_FAILED"
	EventPINVerified            = "PIN_VERIFIED"
	EventDeviceLimitExceeded    = "DEVICE_LIMIT_EXCEEDED"
	EventConfigTamper           = "CONFIG_TAMPER"
	EventSecuritySetupCompleted = "SECURITY_SETUP_COMPLETED"
	EventSecuritySetupBlocked   = "SECURITY_SETUP_BLOCKED"
)

// Security setup constants
const (
	// MaxFailedPasswords: 3 galat passwords -> lockout
	MaxFailedPasswords = 3
	// BlockoutDurationSeconds: galat PIN ke baad 3 MINUTE ka countdown
	BlockoutDurationSeconds = 180
	// PINRequiredTimeoutSeconds: PIN-required lockout bhi EXPIRE hota hai.
	//
	// KYUN ZAROORI (availability safety net):
	// Agar user ne abhi PIN SET nahi kiya hai, aur uske 3 passwords galat ho
	// gaye, to wo PIN verify nahi kar sakta - aur wo PERMANENTLY locked out ho
	// jayega. Ye ek serious availability bug hota.
	// Isliye PIN-required lockout bhi 15 minute baad expire ho jata hai, jisse
	// user wapas password try kar sakta hai (ya recovery flow use kar sakta hai).
	PINRequiredTimeoutSeconds = 900
	// MaxAccountsPerDevice: ek device pe max 3 accounts (SPEC)
	MaxAccountsPerDevice = 3
	// RequiredSecurityQuestions: exactly 3 questions (SPEC)
	RequiredSecurityQuestions = 3
	// PINLength: 6-digit PIN
	PINLength = 6
)
