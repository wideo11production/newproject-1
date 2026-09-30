package model

// ============================================================================
// USER SETTINGS - Single Source of Truth for user preferences
// ============================================================================
//
// REQUIREMENT: "user ko baar baar settings change na karni pade - ek jagah
// set karo, har jagah same rahe (SSOT)".
//
// Isi liye ye DB me persist hota hai, localStorage me nahi. localStorage:
//   - per-device hota (phone aur laptop alag)
//   - logout pe mit jata
//   - multi-device me sync nahi hota
// DB row:
//   - ek jagah, sab devices pe same
//   - logout se bachta hai
//   - account ke saath delete hoti hai (ON DELETE CASCADE)
//
// Hinglish comments: har block ka arth

import (
	"time"

	"github.com/google/uuid"
)

// NOTE: Role constants (`RoleUser`, `RoleSuperadmin`) pehle se
// `superadmin.go` me DEFINED hain - yahan duplicate nahi banaye, kyunki Go
// me same package me do baar declare karna "redeclared" error deta hai.
//
// Ek baat dhyan dene ki: `superadmin.go` me ek TEESRA role bhi hai -
// `RoleSuperadminRecovery` ("superadmin_recovery"). Ye recovery flow ke liye
// hai. Hamare naye `users.role_check` CHECK constraint me sirf 'user' aur
// 'superadmin' allow hain - iska matlab recovery role DB level par reject
// hoga. Ye DELIBERATE hai (recovery account ko full admin nahi chahiye),
// lekin agar wo role use karna hai to constraint extend karna padega.
//
// ---- Allowed values (DB par CHECK constraint bhi hai - double safety) ----

// Theme options
const (
	ThemeDark         = "dark"         // default, current Grafana dark
	ThemeLight        = "light"        // clean light
	ThemeMidnight     = "midnight"     // deep blue-black, OLED friendly
	ThemeHighContrast = "highcontrast" // accessibility (WCAG AAA oriented)
)

// UserSettings: ek user ki saari preferences - ek row.
type UserSettings struct {
	UserID uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`

	// ---- AESTHETICS ----
	Theme  string `gorm:"size:20;not null;default:dark" json:"theme"`
	Accent string `gorm:"size:7;not null;default:#5794f2" json:"accent"`
	// IETF BCP-47 code (en, hi, es, ar...)
	Language string `gorm:"size:10;not null;default:en" json:"language"`

	// ---- FEATURE TOGGLES ----
	// NOTE: ye USER PREFERENCE hain, authorization nahi. Real content-upload
	// permission backend me upload endpoint par alag check hogi. Ye flags sirf
	// ye decide karte hain ki UI me toggle dikhana hai ya nahi.
	ContentUploadEnabled bool `gorm:"not null;default:true" json:"content_upload_enabled"`
	SubscriptionsEnabled bool `gorm:"not null;default:true" json:"subscriptions_enabled"`
	EmailNotifications   bool `gorm:"not null;default:true" json:"email_notifications"`

	// ---- Timestamps ----
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (UserSettings) TableName() string { return "user_settings" }

// ---------------------------------------------------------------------------
// Request / response DTOs
// ---------------------------------------------------------------------------

// GetSettingsResponse - settings + user identity ek saath.
//
// NOTE: `avatar_url` aur `username` yahan isliye aa rahe hain taki settings
// page ko ek hi call me sab mil jaye (SSOT principle - ek read).
type GetSettingsResponse struct {
	// ---- Identity ----
	Email     string `json:"email"`
	Username  string `json:"username"`
	FullName  string `json:"full_name"`
	AvatarURL string `json:"avatar_url"`
	Role      string `json:"role"`

	// ---- Preferences ----
	Theme                string `json:"theme"`
	Accent               string `json:"accent"`
	Language             string `json:"language"`
	ContentUploadEnabled bool   `json:"content_upload_enabled"`
	// ContentUploadAllowed - EFFECTIVE permission, ye `content_upload_enabled`
	// se alag hai (Phase B2).
	//
	// ---- WHY BOTH FIELDS ----
	// `content_upload_enabled` = "user ne toggle on/off kiya" (intent).
	// `contentUploadAllowed` = "upload sach me ho sakta hai ya nahi"
	// (intent + account active + email verified).
	//
	// Ye do alag hote hain: ek unverified user ka toggle ON dikhta hai par
	// upload allowed nahi hai. Agar UI sirf toggle dikhaye to user sochega
	// "on hai to upload hoga", aur phir 403 khaayega bina samjhe kyun.
	// Isliye dono bheje jaate hain - toggle intent dikhane ke liye, ye
	// fields reality dikhane ke liye.
	ContentUploadAllowed bool `json:"content_upload_allowed"`
	// ContentUploadReason - effective block ka reason enum
	// ("allowed" | "disabled_by_user" | "email_unverified" |
	//  "account_inactive"). Frontend ise switch karke SPECIFIC message
	// dikhata hai, na ki ek generic "upload failed".
	//
	// SECURITY: `ReasonUserNotFound` yahan kabhi nahi aayega (wo server-side
	// logging ke liye hai). Isliye ye field enum expose karna safe hai.
	ContentUploadReason  string `json:"content_upload_reason"`
	SubscriptionsEnabled bool   `json:"subscriptions_enabled"`
	EmailNotifications   bool   `json:"email_notifications"`
}

// UpdateSettingsRequest - partial update.
//
// SECURITY: ye POINTERS hain (`*string`, `*bool`) jaan-boojh kar, taki hum
// "field bheja hi nahi" aur "field bheja, value false hai" me distinguish
// kar sakein. Agar plain `string`/`bool` hote, to `false` bhejne wale
// request ko hum "field missing" samajh lete aur update skip kar dete -
// silent bug.
//
// `omitempty` + pointer ka pattern: nil = untouched, non-nil = update karo.
type UpdateSettingsRequest struct {
	Theme    *string `json:"theme"`
	Accent   *string `json:"accent"`
	Language *string `json:"language"`
	// Content upload + subscription toggles
	ContentUploadEnabled *bool `json:"content_upload_enabled"`
	SubscriptionsEnabled *bool `json:"subscriptions_enabled"`
	EmailNotifications   *bool `json:"email_notifications"`
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// ValidThemes - UI ka allowed list. Frontend aur backend SAME list use karte
// hain (taaki UI me dikhe par backend reject kare, ye mismatch na ho).
func ValidThemes() []string {
	return []string{ThemeDark, ThemeLight, ThemeMidnight, ThemeHighContrast}
}

// ValidAccents - Grafana-family accent palette.
//
// NOTE: ye hex values hi hain - user arbitrary hex nahi bhej sakta. Ye
// (a) brand consistency maintain karta hai, (b) koi malicious CSS value
// (jaise `url(...)` ya `expression()`) inject nahi ho sakta.
func ValidAccents() []struct {
	Hex  string
	Name string
} {
	return []struct {
		Hex  string
		Name string
	}{
		{"#5794f2", "Blue"},
		{"#73bf69", "Green"},
		{"#f2cc0c", "Yellow"},
		{"#f2495c", "Red"},
		{"#8ab8ff", "Sky"},
		{"#a78bfa", "Violet"},
		{"#ff9830", "Orange"},
	}
}

// IsValidTheme theme check (DB CHECK constraint ka mirror - fail fast,
// DB tak pohonchne se pehle)
func IsValidTheme(t string) bool {
	for _, v := range ValidThemes() {
		if t == v {
			return true
		}
	}
	return false
}

// IsValidAccent accent hex check - sirf wahi values jo palette me hain.
//
// SECURITY: ye allowlist hai, sirf format validation nahi. Agar ye
// "kuch bhi 6-hex" accept karta, to user `</style><script>` jaisi value
// bhej sakta tha (settings UI me accent inject ho jaata).
func IsValidAccent(hex string) bool {
	for _, a := range ValidAccents() {
		if a.Hex == hex {
			return true
		}
	}
	return false
}

// IsValidLanguage language code check.
//
// Simple whitelist (BCP-47 subset). Full BCP-47 regex zaroori nahi - hum
// sirf wo codes support karte hain jo UI me listed hain, isliye list match
// karna SAFEST hai (koi arbitrary string DB me nahi jaati).
func IsValidLanguage(code string) bool {
	supported := []string{"en", "hi", "es", "fr", "de", "pt", "ar", "ja", "zh", "ta", "te", "mr", "bn", "gu", "kn", "ml", "pa", "ur", "id", "ru"}
	for _, l := range supported {
		if l == code {
			return true
		}
	}
	return false
}

// SupportedLanguages - UI dropdown ka list (SSOT: backend se aata hai, taaki
// frontend hardcode na kare aur dono drift na karein).
func SupportedLanguages() []struct {
	Code string
	Name string
} {
	return []struct {
		Code string
		Name string
	}{
		{"en", "English"},
		{"hi", "Hindi"},
		{"es", "Español"},
		{"fr", "Français"},
		{"de", "Deutsch"},
		{"pt", "Português"},
		{"ar", "العربية"},
		{"ja", "日本語"},
		{"zh", "中文"},
		{"ta", "தமிழ்"},
		{"te", "తెలుగు"},
		{"mr", "मराठी"},
		{"bn", "বাংলা"},
		{"gu", "ગુજરાતી"},
		{"kn", "ಕನ್ನಡ"},
		{"ml", "മലയാളം"},
		{"pa", "ਪੰਜਾਬੀ"},
		{"ur", "اردو"},
		{"id", "Bahasa Indonesia"},
		{"ru", "Русский"},
	}
}
