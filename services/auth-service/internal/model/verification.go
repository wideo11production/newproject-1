package model

import (
	"time"

	"github.com/google/uuid"
)

// VerificationToken email verification ke liye ek-time-use token store karta hai.
//
// SECURITY: TokenHash me RAW token kabhi store nahi hota - sirf uska SHA-256 hash.
// Isse agar database leak ho jaye to bhi koi attacker valid verification link
// nahi bana sakta (rainbow-table / plain-token se protected).
//
// Token plaintext sirf us moment me hota hai jab email bhej rahe hote hain -
// turant baad discard kar diya jata hai.
//
// Hinglish: raw token DB me nahi jata, sirf hash jata hai - security ke liye
type VerificationToken struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	TokenHash string    `gorm:"size:64;not null;uniqueIndex" json:"-"`

	// ExpiresAt: 30 minute TTL. Iske baad token invalid hai aur worker user ko purge kar dega.
	ExpiresAt time.Time `gorm:"not null;index" json:"expires_at"`

	// VerifiedAt: jab user link par click karta hai. Nil matlab abhi verify nahi hua.
	VerifiedAt *time.Time `json:"verified_at"`

	// Purpose: future me reuse ke liye (e.g. "email_verification", "password_reset")
	Purpose string `gorm:"size:64;not null;default:'email_verification'" json:"purpose"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (VerificationToken) TableName() string {
	return "verification_tokens"
}

// IsUsable batata hai ki token abhi valid hai ya nahi
// Used (VerifiedAt set) ya expired tokens invalid maane jaate hain
func (t *VerificationToken) IsUsable() bool {
	return t.VerifiedAt == nil && time.Now().Before(t.ExpiresAt)
}

// PurgeEmailMessage wo exact message hai jo unverified account purge hone par
// user ko bheja jata hai.
//
// IMPORTANT: Ye message strictly plain international English hai - koi Hinglish
// nahi, kyunki ye end-user ko jaata hai. (Code comments Hinglish me hain,
// user-facing content nahi - ye distinction jaan-boojh kar rakhi gayi hai.)
//
// Hinglish: ye message user ko email me jaata hai, isliye English me hai
const PurgeEmailMessage = "For security reasons, your unverified registration has been securely removed. You can now re-register a new account using this same email address as the prior records are completely purged from our systems."

// VerificationEmailSubject verification email ka subject line
const VerificationEmailSubject = "Verify your Wideo11 account"

// PurgeEmailSubject purge notification ka subject line
const PurgeEmailSubject = "Your Wideo11 registration was removed"
