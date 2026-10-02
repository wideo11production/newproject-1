package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Email        string    `gorm:"uniqueIndex;size:255;not null" json:"email" validate:"required,email"`
	PasswordHash string    `gorm:"size:255;not null" json:"-"`
	// Username: public handle for the creator (e.g. "aarav").
	//
	// ADDED (migration 003): ye column pehle migration file me defined tha
	// par LIVE DB me nahi tha - schema drift tha. Migration 003 ne column
	// add kiya + existing 9 users ka backfill kiya (email ka local part).
	//
	// NULLABLE rakha hai DB-level par: legacy rows ke liye safety, aur
	// nayi registrations ke liye RegisterRequest validation enforce karti
	// hai (see below). Hard NOT NULL constraint ka rationale migration
	// file ke end me documented hai.
	//
	// UNIQUE: `idx_users_username`. Collision par registration fail hogi
	// (409/500 se handle karna zaroori - dekh service layer).
	Username string `gorm:"uniqueIndex;size:100" json:"username"`
	// BiometricCapable: is device me biometric sensor hai ya nahi.
	// Migration 004. Default true (safe/strict) - see migration comment.
	// Isse `recomputeSetupComplete` decide karta hai ki biometric enrollment
	// mandatory hai ya nahi.
	//
	// ---- GORM GOTCHA (isliye struct tag me `default:true` NAHI hai) ----
	// Pehle ye tha:
	//     BiometricCapable bool `gorm:"not null;default:true"`
	// Jo GALAT tha. GORM ka rule: jis field par `default` tag ho AUR uski
	// value zero ho (false), to GORM us column ko INSERT se HI chhaap deta
	// hai aur DB default (true) use karne deta hai. Matlab:
	//     client bheje  biometric_capable=false
	//     DB me store  true      <-- GALAT! capability lost ho gayi
	// Iska matlab tha: sensor-less user ka record bhi "capable=true" ban raha
	// tha, aur wo phir bhi permanently lock ho jata.
	//
	// FIX: struct tag se `default:true` hata diya. Ab GORM hamesha field
	// INSERT karta hai (chahe false ho). DB-level DEFAULT true migration 004
	// me set hai aur wahi raw/non-GORM inserts ke liye fallback banega -
	// bas Go struct se announce nahi hona chahiye.
	BiometricCapable bool `gorm:"not null" json:"biometric_capable"`
	// Role: 'user' (default) ya 'superadmin' (migration 006).
	// Ye AUTHZ ka source of truth hai DB me. Token me bhi role claim jata hai
	// (signed), par DB hi ultimate authority hai.
	Role string `gorm:"size:20;not null;default:user" json:"role"`
	// AvatarURL: profile image ka URL (migration 005).
	// Empty = koi avatar nahi, UI initials fallback dikhata hai.
	// SECURITY: sirf relative path ("/...") ya http(s) URL store hota hai
	// (handler validate karta hai) - `javascript:`/`data:` schemes reject
	// hote hain, warna stored XSS ho sakta hai.
	AvatarURL   string         `gorm:"size:500" json:"avatar_url"`
	FullName    string         `gorm:"size:255" json:"full_name"`
	IsActive    bool           `gorm:"default:true" json:"is_active"`
	IsVerified  bool           `gorm:"default:false" json:"is_verified"`
	LastLoginAt *time.Time     `json:"last_login_at"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Sessions []Session `gorm:"foreignKey:UserID" json:"-"`
	Devices  []Device  `gorm:"foreignKey:UserID" json:"-"`
	PINs     []PIN     `gorm:"foreignKey:UserID" json:"-"`
}

func (User) TableName() string {
	return "users"
}

type Session struct {
	ID       uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID   uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	DeviceID *uuid.UUID `gorm:"type:uuid;index" json:"device_id"`
	// SECURITY FIX: raw JWT store karna DB leak me session hijack deta hai.
	// Ab sirf SHA-256 hash (64 hex chars) store hota hai - size bhi safe.
	// Hinglish: raw token DB me nahi, sirf hash
	AccessToken string `gorm:"size:64;not null" json:"-"`
	// SECURITY FIX: same - raw refresh JWT nahi, sirf hash store hota hai
	RefreshToken string `gorm:"size:64;not null" json:"-"`
	// size:64 (migration 009) - pehle 45 tha, jo full IPv6 aur
	// multi-proxy `X-Forwarded-For` chains ko fail kar raha tha
	// ("value too long for type character varying(45)"). DB column aur ye tag
	// MATCH karne zaroori hain: agar tag 45 rahe to GORM AutoMigrate column
	// ko wapas 45 me SHRINK karta hai, jo `active_user_sessions` view
	// (migration 007) par depend karta hai -> crash loop.
	IPAddress string         `gorm:"size:64" json:"ip_address"`
	UserAgent string         `gorm:"size:512" json:"user_agent"`
	ExpiresAt time.Time      `gorm:"not null;index" json:"expires_at"`
	RevokedAt *time.Time     `json:"revoked_at"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	User   User    `gorm:"foreignKey:UserID" json:"-"`
	Device *Device `gorm:"foreignKey:DeviceID" json:"-"`
}

func (Session) TableName() string {
	return "sessions"
}

type Device struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	DeviceName  string         `gorm:"size:255" json:"device_name"`
	DeviceType  string         `gorm:"size:50" json:"device_type"` // mobile, desktop, tablet
	Platform    string         `gorm:"size:100" json:"platform"`   // iOS, Android, Windows, macOS, Linux
	Browser     string         `gorm:"size:100" json:"browser"`
	Fingerprint string         `gorm:"size:512;uniqueIndex" json:"-"`
	TrustScore  int            `gorm:"default:50" json:"trust_score"` // 0-100
	IsTrusted   bool           `gorm:"default:false" json:"is_trusted"`
	LastSeenAt  *time.Time     `json:"last_seen_at"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (Device) TableName() string {
	return "devices"
}

type PIN struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	PINHash   string         `gorm:"size:255;not null" json:"-"`
	Attempts  int            `gorm:"default:0" json:"attempts"`
	LockedAt  *time.Time     `json:"locked_at"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (PIN) TableName() string {
	return "pins"
}

type RefreshToken struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	TokenHash string     `gorm:"size:512;not null;uniqueIndex" json:"-"`
	ExpiresAt time.Time  `gorm:"not null;index" json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`
	CreatedAt time.Time  `json:"created_at"`

	// ---- Session scope (migration 013) ----
	//
	// Ye column hi logout ko device-precise banata hai. Pehle refresh token ke
	// paas sirf user_id tha, to ye PATA hi nahi chalta tha ki wo kis session se
	// hai - matlab "sirf is device ka token delete karo" database par likha
	// hi nahi ja sakta tha, aur `RevokeAllByUserID` hi ek available option
	// bacha tha. Wo user ke SAARE devices logout kar deti thi.
	//
	// NULLable hai: migration se pehle ke tokens me ye NULL hai, aur unhe
	// turant set nahi kiya jaata. Un tokens ke liye behaviour aaj jaisa hi
	// rehta hai - yaani gradual cutover, big bang nahi.
	SessionID *uuid.UUID `gorm:"type:uuid;index" json:"session_id"`

	User User `gorm:"foreignKey:UserID" json:"-"`

	// `constraint:OnDelete:CASCADE` is LOAD-BEARING, and it was missing.
	//
	// GORM creates a foreign key for this association with no delete rule - which
	// PostgreSQL treats as NO ACTION - and it names it `fk_refresh_tokens_session`,
	// which is exactly the name migration 013 looks for. Since AutoMigrate runs
	// BEFORE the SQL chain, the constraint was always already there, so 013's
	// `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...)` guard
	// skipped every time and the CASCADE never landed on any database.
	//
	// The result was a foreign key that REFUSED session deletion whenever a
	// refresh token still pointed at the session - so a session could not be
	// cleaned up, and "log out of this device" had no way to remove the
	// credentials it had issued.
	//
	// This is the shape of bug that hides best: the migration is correct, the
	// comment explains exactly why CASCADE matters, and the guard is written to
	// succeed quietly. Nothing fails. The constraint simply never appears.
	Session Session `gorm:"foreignKey:SessionID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE" json:"-"`
}

func (RefreshToken) TableName() string {
	return "refresh_tokens"
}

type LoginRequest struct {
	Email    string     `json:"email" validate:"required,email"`
	Password string     `json:"password" validate:"required,min=8,max=72"`
	Device   DeviceInfo `json:"device"`
}

type DeviceInfo struct {
	DeviceName  string `json:"device_name"`
	DeviceType  string `json:"device_type"`
	Platform    string `json:"platform"`
	Browser     string `json:"browser"`
	Fingerprint string `json:"fingerprint"`
}

type RegisterRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8,max=72"`
	// FullName OPTIONAL hai ab. Pehle `validate:"required,min=2,max=100"` tha.
	// Register form se ye field hata di gayi thi (compact card), ab phir se
	// optional rakha hai - form me nahi hai, profile me bhara ja sakta hai.
	//
	// NOTE: ye `validate` tags DEAD CODE hain - handler `ShouldBindJSON` use
	// karta hai jo sirf JSON unmarshal karta hai, koi struct-tag validator
	// run nahi hota. Tags documentation ke liye hain. Tab bhi ye accurate
	// rakhna zaroori hai, warna future me koi inhe enforce karne ki koshish
	// kare to galat sochega.
	//
	// `max=100` still rakha hai - agar koi future me naam bhare to limit safe
	// rahegi.
	FullName string `json:"full_name" validate:"omitempty,max=100"`
	// Username: NEW registrations ke liye REQUIRED (3-30 chars, letters/digits/
	// underscore/dot/dash). Ye form me bhi hai, isliye validation tag yahan
	// matter karti hai documentation ke liye - par enforce service layer me
	// hota hai (ye tags dead hain).
	Username string `json:"username" validate:"required,min=3,max=30"`
	// BiometricCapable: client batata hai ki is DEVICE me biometric sensor
	// hai ya nahi (browser ne `PublicKeyCredential` check kiya).
	//
	// WHY: security setup ka rule conditional hai -
	//   device support karta hai  -> enroll karna ZAROORI
	//   device support NAHI karta -> enroll karna zaroori nahi
	// Bina is flag ke, sensor-less users PERMANENTLY dashboard se lock ho
	// jaate the (bioCount hamesha 0 rehta). Migration 004 ne column add kiya.
	//
	// POINTER kyun: `nil` ka matlab "client ne nahi bataya" -> hum safe
	// default `true` assume karte hain (stricter side, security down-grade
	// nahi hota). `false` ka matlab "client ne confirm kiya sensor nahi hai".
	BiometricCapable *bool      `json:"biometric_capable"`
	Device           DeviceInfo `json:"device"`
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"` // seconds
	TokenType    string `json:"token_type"`
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

type PINSetupRequest struct {
	PIN string `json:"pin" validate:"required,len=6,numeric"`
}

type PINVerifyRequest struct {
	PIN string `json:"pin" validate:"required,len=6,numeric"`
}
