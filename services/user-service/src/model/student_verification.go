// StudentVerification — AURA student gate + professional registry record.
//
// Hinglish: ye model user-service ka Gate A (domain whitelist) aur Gate B
// (ID card upload + 365-day cryptographic token) ka state store karta hai.
// Ismein Student, Tutor, aur Advocate teeno roles ka verification track hota hai.
//
// Professional verification modes:
//   - Student: academic domain → Gate A instant pass
//   - Tutor: educational domain → Gate A instant pass
//   - Advocate: Bar Council domain OR Bar Association ID card → Gate A/B
//
// Money law (SYSTEM-PLAN.md R2): no monetary data stored here —
// pure verification state + cryptographic proof. Paise ka koi bhi field
// nahi rakhenge taaki audit trail clean rahe.
package model

import (
	"time"

	"github.com/google/uuid"
)

// VerificationStatus — professional verification ka state machine.
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

// DocumentType — ID document ke type.
type DocumentType string

const (
	DocTypeCollegeID  DocumentType = "college_id"
	DocTypeBarCouncil DocumentType = "bar_council_id"
	DocTypeBarCard    DocumentType = "bar_card"
	DocTypeTutorCert  DocumentType = "tutor_certificate"
	DocTypeOther      DocumentType = "other"
)

// StudentVerification — ek user ka professional verification record.
//
// Hinglish: ek user ek verification record ke paas hota hai. Agar domain
// match kare (Gate A) to instant verified_by_domain. Agar domain match na
// kare, to Gate B: document upload → pending_document → verified/rejected.
type StudentVerification struct {
	ID uint `gorm:"primarykey" json:"id"`

	// UserID — FK to users table (local uint).
	UserID uint `gorm:"not null;uniqueIndex" json:"user_id"`

	// ProfessionalRole — student, tutor, ya advocate.
	// Hinglish: ye field determine karta hai ki user ka kaun sa gate apply hoga.
	ProfessionalRole ProfessionalRole `gorm:"size:50;not null;default:''" json:"professional_role"`

	// BarAssociationID — Advocate ke liye Bar Council membership number.
	// Hinglish: advocate verify hone ke liye yeh mandatory hai. Bar Council
	// ka ID card ya online membership database se match karta hai.
	BarAssociationID string `gorm:"size:100" json:"bar_association_id,omitempty"`

	// Status — current verification state (see VerificationStatus constants).
	Status VerificationStatus `gorm:"size:30;not null;default:'pending'" json:"status"`

	// Gate A fields:
	// EmailDomain — user ka email ka domain (e.g. "iitd.ac.in").
	// Agar yeh seed list mein match kare to instant Gate A pass.
	EmailDomain string `gorm:"size:255" json:"email_domain,omitempty"`

	// Gate B fields:
	// IDDocumentURL — MinIO/S3 path to uploaded ID card image.
	IDDocumentURL string `gorm:"type:text" json:"id_document_url,omitempty"`
	// IDDocumentUploadedAt — jab document upload hua.
	IDDocumentUploadedAt *time.Time `json:"id_document_uploaded_at,omitempty"`
	// DocumentType — ID document ka type (college_id, bar_council_id, etc.)
	DocumentType DocumentType `gorm:"size:50;default:''" json:"document_type,omitempty"`

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
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
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
