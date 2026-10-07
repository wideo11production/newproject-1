package model

import "time"

// StudentIdentity — AURA student discount verification record.
//
// Hinglish: ye table AURA student gate ka state hai. Degree/ID
// image upload (manual review) → status 'verified' + 365-day
// identity token. Educational-content violation par 'revoked'
// — discount permanently void, plan normal pricing par switch.
//
// Money law (SYSTEM-PLAN.md R2): penalty 25% of plan price in
// MINOR UNITS (decimal) — float kabhi nahi.
type StudentIdentity struct {
	// ID is the row's own id.
	ID uint `gorm:"primarykey" json:"id"`
	// UserID is the billing-side uint (identity adapter se aaya).
	// Unique: ek user, ek student record.
	UserID uint `gorm:"not null;uniqueIndex" json:"user_id"`
	// IsVerifiedStudent - discount eligibility flag. Revoked par
	// false ho jata hai (one-time).
	IsVerifiedStudent bool `gorm:"not null;default:false" json:"is_verified_student"`
	// DegreeDocumentURL - MinIO path to uploaded degree/ID image.
	// Manual review ke liye reference.
	DegreeDocumentURL string `gorm:"type:text" json:"degree_document_url"`
	// IdentityToken - 365-day signed JWT proof. Revoked par clear.
	IdentityToken string `gorm:"type:text" json:"identity_token"`
	// IdentityTokenExpiresAt - token 365-day absolute lifecycle end.
	// Expire hone par verification auto-invalid (manual re-review
	// chahiye).
	IdentityTokenExpiresAt *time.Time `json:"identity_token_expires_at"`
	// Status: 'pending' | 'verified' | 'revoked' | 'rejected'.
	Status string `gorm:"size:20;not null;default:'pending'" json:"status"`
	// ReviewedBy - admin who approved (manual review path).
	ReviewedBy uint `json:"reviewed_by"`
	// ReviewedAt - kab manual review hua.
	ReviewedAt *time.Time `json:"reviewed_at"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Student identity statuses — model-level (repository + service dono use karte hain).
// Hinglish: ye constants model package mein hain kyunki repository
// (model.StudentStatusVerified) aur service dono check karte hain.
// Agar service mein rakhe to repository compile nahi karega.
const (
	StudentStatusPending  = "pending"
	StudentStatusVerified = "verified"
	StudentStatusRevoked  = "revoked"
	StudentStatusRejected = "rejected"
)

func (StudentIdentity) TableName() string {
	return "student_identities"
}
