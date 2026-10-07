// StudentVerificationService — AURA student gate dual-gate verification engine.
//
// Hinglish: ye service user-service ka Gate A (domain whitelist) aur
// Gate B (ID card upload + 365-day token) ka business logic implement karta
// hai. Revenue split, discount logic, aur educational content interceptor
// billing-service / upload-service ke paas hain — ye SIRF verification
// state machine aur cryptographic token issue karta hai.
//
// Gate A (Automatic Academic Check):
//   User ke email domain seed list mein hai → instant verified_by_domain.
//
// Gate B (Document Fallback):
//   Domain match nahi hua → ID card upload → pending_document → manual review
//   → verified ya rejected. Token has 365-day absolute expiry (user directive).
//
// Token minting: HMAC-SHA256 JWT with `degree_verified` + `user_id` + `exp`.
// Secret user-service ke config se aayega (JWT_SECRET_KEY env var).
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"newproject/services/user-service/src/model"
	"newproject/services/user-service/src/repository"
)

var (
	ErrInvalidEmail      = errors.New("invalid email address")
	ErrDomainNotAcademic = errors.New("domain not in academic seed list")
)

// StudentVerificationEngine — dual-gate student verification orchestrator.
//
// Hinglish: ye struct repository + JWT secret + token TTL rakhta hai.
// Har method ek gate ya state transition hai.
type StudentVerificationEngine struct {
	repo       repository.StudentVerificationRepository
	userRepo   repository.UserRepository
	jwtSecret  []byte
	tokenTTL   time.Duration
}

// NewStudentVerificationEngine — constructor.
//
// jwtSecret: shared secret for signing 365-day verification tokens.
// tokenTTL: typically 365 * 24h (StudentIdentityTokenTTL in billing-service).
func NewStudentVerificationEngine(
	repo repository.StudentVerificationRepository,
	userRepo repository.UserRepository,
	jwtSecret []byte,
	tokenTTL time.Duration,
) *StudentVerificationEngine {
	return &StudentVerificationEngine{
		repo:      repo,
		userRepo:  userRepo,
		jwtSecret: jwtSecret,
		tokenTTL:  tokenTTL,
	}
}

// StudentIdentityTokenTTL — 365-day absolute lifecycle (matches billing-service).
const StudentIdentityTokenTTL = 365 * 24 * time.Hour

// VerifyStudentGateA — Gate A: instant domain check.
//
// Agar user ka email academic domain pe match kare to instant verification.
// Token mint kiya jata hai (365-day). Status = verified_by_domain.
//
// Hinglish: yehi function AURA student gate ka "automatic academic check"
// hai — user directive ke hisaab se, agar email academic institution se
// hai to automatically verified.
func (e *StudentVerificationEngine) VerifyStudentGateA(ctx context.Context, userID uint) (*model.StudentVerification, error) {
	user, err := e.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("gate A: user lookup failed: %w", err)
	}

	domain := extractUserDomain(user.Email)
	if domain == "" || !model.IsAcademicDomain(user.Email) {
		return nil, ErrDomainNotAcademic
	}

	now := time.Now().UTC()
	exp := now.Add(e.tokenTTL)
	token, err := e.mintVerificationToken(userID, exp)
	if err != nil {
		return nil, fmt.Errorf("gate A: token mint failed: %w", err)
	}

	sv := &model.StudentVerification{
		UserID:            userID,
		Status:            model.VerificationVerifiedByDomain,
		EmailDomain:       domain,
		VerificationToken: token,
		TokenExpiresAt:    &exp,
		UUID:              uuid.New(),
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	if err := e.repo.Create(ctx, sv); err != nil {
		// If record already exists, update it instead.
		existing, getErr := e.repo.GetByUserID(ctx, userID)
		if getErr == nil {
			existing.Status = sv.Status
			existing.EmailDomain = domain
			existing.VerificationToken = token
			existing.TokenExpiresAt = &exp
			existing.UpdatedAt = now
			if updateErr := e.repo.Update(ctx, existing); updateErr != nil {
				return nil, updateErr
			}
			return existing, nil
		}
		return nil, fmt.Errorf("gate A: repo create failed: %w", err)
	}

	return sv, nil
}

// SubmitIDDocument — Gate B: ID card upload fallback.
//
// Agar Gate A fail hua, user ID card image upload karta hai.
// Status = pending_document. 365-day token mint karo (document review
// ke baad verified status tak).
//
// Hinglish: ye function document URL set karta hai (actual file upload
// MinIO/S3 pe parallel hoga — yeh sirf URL reference store karta hai).
func (e *StudentVerificationEngine) SubmitIDDocument(ctx context.Context, userID uint, documentURL string, documentType string) (*model.StudentVerification, error) {
	if strings.TrimSpace(documentURL) == "" {
		return nil, errors.New("document URL is required")
	}

	// Verify user exists.
	if _, err := e.userRepo.GetByID(ctx, userID); err != nil {
		return nil, fmt.Errorf("gate B: user lookup failed: %w", err)
	}

	now := time.Now().UTC()
	exp := now.Add(e.tokenTTL)
	token, err := e.mintVerificationToken(userID, exp)
	if err != nil {
		return nil, fmt.Errorf("gate B: token mint failed: %w", err)
	}

	// Try to get existing record.
	sv, err := e.repo.GetByUserID(ctx, userID)
	if err != nil {
		if !errors.Is(err, repository.ErrStudentVerificationNotFound) {
			return nil, fmt.Errorf("gate B: repo get failed: %w", err)
		}
		// Create new record.
		sv = &model.StudentVerification{
			UserID:            userID,
			Status:            model.VerificationPendingDocument,
			IDDocumentURL:     documentURL,
			IDDocumentUploadedAt: &now,
			VerificationToken: token,
			TokenExpiresAt:    &exp,
			UUID:              uuid.New(),
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if err := e.repo.Create(ctx, sv); err != nil {
			return nil, fmt.Errorf("gate B: repo create failed: %w", err)
		}
		return sv, nil
	}

	// Update existing record.
	sv.Status = model.VerificationPendingDocument
	sv.IDDocumentURL = documentURL
	sv.IDDocumentUploadedAt = &now
	sv.VerificationToken = token
	sv.TokenExpiresAt = &exp
	sv.UpdatedAt = now
	if err := e.repo.Update(ctx, sv); err != nil {
		return nil, fmt.Errorf("gate B: repo update failed: %w", err)
	}
	return sv, nil
}

// ApproveDocumentVerification — admin/manual review approval (Gate B).
// Status → verified, token refresh to full 365-day.
func (e *StudentVerificationEngine) ApproveDocumentVerification(ctx context.Context, userID uint, reviewedByID uint) (*model.StudentVerification, error) {
	sv, err := e.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	exp := now.Add(e.tokenTTL)
	token, err := e.mintVerificationToken(userID, exp)
	if err != nil {
		return nil, fmt.Errorf("approve: token mint failed: %w", err)
	}

	sv.Status = model.VerificationVerified
	sv.VerificationToken = token
	sv.TokenExpiresAt = &exp
	sv.ReviewedBy = &reviewedByID
	sv.ReviewedAt = &now
	sv.RejectionReason = ""
	sv.UpdatedAt = now

	if err := e.repo.Update(ctx, sv); err != nil {
		return nil, fmt.Errorf("approve: repo update failed: %w", err)
	}
	return sv, nil
}

// RejectDocumentVerification — admin/manual review rejection.
// Status → rejected. User can re-apply by uploading a new document.
func (e *StudentVerificationEngine) RejectDocumentVerification(ctx context.Context, userID uint, reviewedByID uint, reason string) (*model.StudentVerification, error) {
	sv, err := e.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	sv.Status = model.VerificationRejected
	sv.VerificationToken = ""
	sv.TokenExpiresAt = nil
	sv.ReviewedBy = &reviewedByID
	sv.ReviewedAt = &now
	sv.RejectionReason = reason
	sv.UpdatedAt = now

	if err := e.repo.Update(ctx, sv); err != nil {
		return nil, fmt.Errorf("reject: repo update failed: %w", err)
	}
	return sv, nil
}

// CheckStudentStatus — returns verification status + token validity.
// Agar token expire ho gaya hai to status auto-update to "expired".
//
// Hinglish: ye function billing-service / upload-service ke liye use hota
// hai — "kya ye student abhi verified hai?" puchne ke liye.
func (e *StudentVerificationEngine) CheckStudentStatus(ctx context.Context, userID uint) (*model.StudentVerification, bool) {
	sv, err := e.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, false
	}

	// Auto-expire: agar token expiry ho gaya hai.
	if sv.TokenExpiresAt != nil && time.Now().After(*sv.TokenExpiresAt) {
		if sv.Status == model.VerificationVerifiedByDomain || sv.Status == model.VerificationVerified {
			sv.Status = model.VerificationExpired
			sv.VerificationToken = ""
			_ = e.repo.Update(ctx, sv) // best-effort update
		}
	}

	verified := sv.IsVerified()
	return sv, verified
}

// extractUserDomain — email se domain part nikal (lowercase, trimmed).
func extractUserDomain(email string) string {
	at := strings.LastIndex(email, "@")
	if at == -1 || at == len(email)-1 {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(email[at+1:]))
}

// mintVerificationToken — 365-day JWT (proof-of-issuance).
// Claims: degree_verified=true, user_id, issuer, exp, iat.
//
// Hinglish: ye token billing-service ke StudentIdentity.VerificationToken
// ya usi jaisa hota hai — isliye cross-service proof ban sakta hai.
func (e *StudentVerificationEngine) mintVerificationToken(userID uint, exp time.Time) (string, error) {
	now := time.Now().UTC()
	claims := struct {
		DegreeVerified bool `json:"degree_verified"`
		UserID         uint `json:"user_id"`
		jwt.RegisteredClaims
	}{
		DegreeVerified: true,
		UserID:         userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "user-service-student-gate",
			Subject:   fmt.Sprintf("student:%d", userID),
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.NewString(),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(e.jwtSecret)
}
