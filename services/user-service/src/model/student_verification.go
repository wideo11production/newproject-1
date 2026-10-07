// StudentVerification — AURA student gate ka dual-gate verification record.
//
// Hinglish: ye model user-service ka Gate A (domain whitelist) aur Gate B
// (ID card upload + 365-day cryptographic token) ka state store karta hai.
// Iska primary purpose verification status track karna — discount logic
// billing-service ke StudentIdentity model pe hi rehta hai, lekin yeh
// record dono services ke beech bridge bana ke khada hota hai.
//
// Dual-Gate Logic:
//
//   Gate A (Automatic Academic Check):
//     - User ka email domain seed list mein match hone par instant verified.
//     - Status = "verified_by_domain"
//     - Token = nil (domain alone sufficient, lekin 365-day token mint karo
//       taaki cross-service proof-of-issuance rahe).
//
//   Gate B (Document Fallback):
//     - ID card image upload → cryptographic token with 365-day expiry.
//     - Status = "pending_document" → admin/manual review → "verified" or "rejected"
//     - Token expiry hote hi verification auto-invalid (re-apply zaroori).
//
// Money law (SYSTEM-PLAN.md R2): no monetary data stored here —
// pure verification state + cryptographic proof. Paise ka koi bhi field
// nahi rakhenge taaki audit trail clean rahe.
package model

import (
	"time"

	"github.com/google/uuid"
)

// VerificationStatus — student verification ka state machine.
type VerificationStatus string

const (
	// VerificationPending — user ne apply nahi kiya ya document pending review.
	VerificationPending VerificationStatus = "pending"
	// VerificationVerifiedByDomain — Gate A: email domain seed list se match.
	VerificationVerifiedByDomain VerificationStatus = "verified_by_domain"
	// VerificationPendingDocument — Gate B: document uploaded, manual review pending.
	VerificationPendingDocument VerificationStatus = "pending_document"
	// VerificationVerified — Gate B: manual review complete, document approved.
	VerificationVerified VerificationStatus = "verified"
	// VerificationRejected — document rejected, domain bhi match nahi hua.
	VerificationRejected VerificationStatus = "rejected"
	// VerificationExpired — 365-day token expire ho gaya, re-verify zaroori.
	VerificationExpired VerificationStatus = "expired"
)

// StudentVerification — ek user ka student verification record.
//
// Hinglish: ek user ek verification record ke paas hota hai. Agar domain
// match kare (Gate A) to instant verified_by_domain. Agar domain match na
// kare, to Gate B: document upload → pending_document → verified/rejected.
type StudentVerification struct {
	ID uint `gorm:"primarykey" json:"id"`

	// UserID — FK to users table (local uint).
	UserID uint `gorm:"not null;uniqueIndex" json:"user_id"`

	// Status — current verification state (see VerificationStatus constants).
	Status VerificationStatus `gorm:"size:30;not null;default:'pending'" json:"status"`

	// Gate A fields:
	// EmailDomain — user ka email ka domain (e.g. "iitd.ac.in").
	// Agar yeh seed list mein match kare to instant Gate A pass.
	EmailDomain string `gorm:"size:255" json:"email_domain,omitempty"`

	// Gate B fields:
	// IDDocumentURL — MinIO/S3 path to uploaded college ID card image.
	IDDocumentURL string `gorm:"type:text" json:"id_document_url,omitempty"`
	// IDDocumentUploadedAt — jab document upload hua.
	IDDocumentUploadedAt *time.Time `json:"id_document_uploaded_at,omitempty"`

	// VerificationToken — 365-day cryptographic JWT.
	// Gate A ya Gate B dono mein mint hota hai. Cross-service proof-of-issuance.
	VerificationToken string `gorm:"type:text" json:"verification_token,omitempty"`

	// TokenExpiresAt — absolute 365-day expiry boundary.
	// Expiry hone par status "expired" ho jata hai.
	TokenExpiresAt *time.Time `json:"token_expires_at,omitempty"`

	// ReviewedBy — admin ID jo manually review kare (Gate B fallback path).
	ReviewedBy *uint `json:"reviewed_by,omitempty"`
	// ReviewedAt — jab review complete hua.
	ReviewedAt *time.Time `json:"reviewed_at,omitempty"`

	// RejectionReason — agar rejected hai to reason (audit + retry guide).
	RejectionReason string `gorm:"type:text" json:"rejection_reason,omitempty"`

	UUID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex;default:gen_random_uuid()" json:"uuid"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (StudentVerification) TableName() string {
	return "student_verifications"
}

// IsVerified — convenience method: verification active + token valid.
func (sv *StudentVerification) IsVerified() bool {
	if sv == nil {
		return false
	}
	if sv.Status != VerificationVerifiedByDomain && sv.Status != VerificationVerified {
		return false
	}
	if sv.TokenExpiresAt == nil {
		return false
	}
	return time.Now().Before(*sv.TokenExpiresAt)
}
