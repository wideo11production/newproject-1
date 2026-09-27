// Payout identity service - dedup + verification
//
// YE REVENUE PROTECTION HAI. Device cap ek user ke 3 accounts ko same device
// se limit karta hai. Lekin agar 3 accounts alag devices se bane aur sabka
// payout EK HI UPI/bank me jaye, to cap bypass ho jata hai.
//
// Iska hal: PAYOUT IDENTITY DEDUP - ek UPI/bank identity sirf ek account
// se link ho sakti hai (database UNIQUE index se enforced).
//
// Hinglish comments: har block ka arth
package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"newproject/services/billing-service/src/model"
)

// Payout errors
var (
	ErrPayoutIdentityInUse = errors.New("this payout identity is already linked to another account")
	ErrInvalidPayoutType   = errors.New("invalid payout method type")
	ErrMissingPayoutField  = errors.New("required payout field is missing")
	ErrPayoutLimitReached  = errors.New("maximum payout methods reached for this account")
	ErrPayoutNotVerified   = errors.New("payout identity is not verified")
)

// PayoutIdentityService payout identities manage karta hai
type PayoutIdentityService struct {
	db *gorm.DB
	// kycEngine: automated bank validation (optional - nil ho to KYC skip)
	kycEngine *KycEngine
}

// NewPayoutIdentityService naya service banata hai
//
// kycEngine pass karne se ADD hi naye payout AUTOMATICALLY verify ho jate hain.
func NewPayoutIdentityService(db *gorm.DB, kycEngine *KycEngine) *PayoutIdentityService {
	return &PayoutIdentityService{db: db, kycEngine: kycEngine}
}

// NormalizePayoutIdentity payout identity ko standard form me le aata hai
//
// RULES:
//   - UPPER case
//   - Trim + collapse internal whitespace
//   - UPI: "user@bank" -> "USER@BANK"
//   - Bank: "account@ifsc" -> "ACCOUNT@IFSC"
//
// KYUN: taaki "User@Bank" aur " user@bank " ek hi identity count hon.
// Agar nahi kiya to user 2 accounts se same UPI lekar dedup bypass kar lega.
//
// Hinglish: normalization - taaki same identity alag spelling me bhi same lage
func NormalizePayoutIdentity(payoutType, identifier string) string {
	cleaned := strings.ToUpper(strings.Join(strings.Fields(identifier), ""))
	return cleaned
}

// PayoutRequest - user ka payout add karne ka request
//
// NOTE: json tags ZAROORI hain. Bina inke Go ka encoding/json snake_case
// ("account_holder_name") ko CamelCase field ("AccountHolderName") se match
// NAHI karta - aur silently zero value chala jata tha (400 error).
// Ye wahi class ka bug hai jo JWT config me tha.
// Hinglish: json tags ke bina fields bind nahi hote
type PayoutRequest struct {
	Type string `json:"type"`
	// UPI ke liye
	UPI string `json:"upi"`
	// Bank ke liye
	AccountHolderName string `json:"account_holder_name"`
	AccountNumber     string `json:"account_number"`
	IFSC              string `json:"ifsc"`
	// Wire ke liye
	SWIFTBIC string `json:"swift_bic"`
	Account  string `json:"account"`
}

// AddPayoutIdentity naya payout identity add karta hai
//
// DEDUP LOGIC:
//   1. Normalize karo
//   2. Check karo ki ye identity already kisi account se linked hai?
//      - HAAN -> REJECT (ErrPayoutIdentityInUse)
//      - NAHI -> insert karo
//
// NOTE: Database me bhi UNIQUE index hai, isliye race condition me bhi
// duplicate insert nahi ho sakta - application layer aur DB dono guard karte hain.
func (s *PayoutIdentityService) AddPayoutIdentity(
	ctx context.Context, userID uuid.UUID, req PayoutRequest,
) (*model.PayoutIdentity, error) {

	// ---- Validate type ----
	if req.Type != model.PayoutTypeUPI &&
		req.Type != model.PayoutTypeBank &&
		req.Type != model.PayoutTypeWire {
		return nil, ErrInvalidPayoutType
	}

	// ---- Build identity per type ----
	var normalized, display string
	record := &model.PayoutIdentity{
		UserID: userID,
		Type:   req.Type,
		Status: "pending", // verification baad me hogi
	}

	switch req.Type {
	case model.PayoutTypeUPI:
		if strings.TrimSpace(req.UPI) == "" {
			return nil, fmt.Errorf("%w: upi id required", ErrMissingPayoutField)
		}
		normalized = NormalizePayoutType(model.PayoutTypeUPI, req.UPI)
		display = maskIdentity(req.UPI, 3, 4)
		record.NormalizedIdentity = normalized
		record.DisplayIdentity = display

	case model.PayoutTypeBank:
		if strings.TrimSpace(req.AccountNumber) == "" || strings.TrimSpace(req.IFSC) == "" {
			return nil, fmt.Errorf("%w: account number and IFSC required", ErrMissingPayoutField)
		}
		// Bank identity = ACCOUNT@IFSC
		normalized = NormalizePayoutType(model.PayoutTypeBank,
			req.AccountNumber+"@"+req.IFSC)
		display = maskIdentity(req.AccountNumber, 2, 2)
		record.NormalizedIdentity = normalized
		record.DisplayIdentity = display
		record.AccountHolderName = strings.TrimSpace(req.AccountHolderName)
		record.AccountNumber = strings.TrimSpace(req.AccountNumber)
		record.IFSC = strings.ToUpper(strings.TrimSpace(req.IFSC))

	case model.PayoutTypeWire:
		if strings.TrimSpace(req.SWIFTBIC) == "" || strings.TrimSpace(req.Account) == "" {
			return nil, fmt.Errorf("%w: SWIFT/BIC and account required", ErrMissingPayoutField)
		}
		normalized = NormalizePayoutType(model.PayoutTypeWire,
			req.SWIFTBIC+"@"+req.Account)
		display = maskIdentity(req.Account, 2, 2)
		record.NormalizedIdentity = normalized
		record.DisplayIdentity = display
		record.SWIFTBIC = strings.ToUpper(strings.TrimSpace(req.SWIFTBIC))
	}

	// ---- DEDUP CHECK (core protection) ----
	existing, err := s.findByIdentity(ctx, normalized)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if existing != nil {
		if existing.UserID == userID {
			// Same user ne ye already add kiya hai - idempotent
			return existing, nil
		}
		// DOOSRE account se linked hai - REJECT
		return nil, fmt.Errorf("%w (linked to another account since %s)",
			ErrPayoutIdentityInUse,
			existing.CreatedAt.Format("2006-01-02"))
	}

	// ---- Limit check ----
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.PayoutIdentity{}).
		Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return nil, err
	}
	if count >= model.MaxPayoutIdentityPerUser {
		return nil, ErrPayoutLimitReached
	}

	// ---- Insert ----
	// NOTE: DB UNIQUE index bhi hai, isliye agar do requests race karein
	// to ek fail hoga - aur hum usse clean error me convert karenge.
	if err := s.db.WithContext(ctx).Create(record).Error; err != nil {
		// Unique violation = duplicate identity
		if isUniqueViolation(err) {
			return nil, ErrPayoutIdentityInUse
		}
		return nil, err
	}

	// Pehla payout method primary bana do
	if count == 0 {
		s.db.WithContext(ctx).Model(&model.PayoutIdentity{}).
			Where("id = ?", record.ID).Update("is_primary", true)
		record.IsPrimary = true
	}

	// ---- AUTOMATED KYC (no admin input required) ----
	//
	// Naya payout identity add hote hi turant KYC chalti hai. Agar validation
	// pass ho jaati hai to status AUTOMATICALLY "pending" se "verified" ho
	// jaata hai - admin ke kuch karne ki zarurat NAHI.
	//
	// NOTE: pehle ye step MISSING tha, isliye har payout manually admin se
	// verify karna padta tha (ya hota hi nahi).
	if s.kycEngine != nil {
		if result, kycErr := s.kycEngine.RunKYC(ctx, record.ID); kycErr == nil {
			if result.Verified {
				// Verification pass -> status AUTOMATICALLY "verified"
				record.Status = KYCStatusVerified
				record.VerifiedAt = result.VerifiedAt
			} else {
				record.Status = KYCStatusRejected
				record.KYCReason = result.Reason
			}
			record.KYCProvider = result.Provider
			record.KYCRiskScore = result.RiskScore
		} else {
			// KYC error - status pending hi rahega (fail safe)
			log.Printf("[KYC] auto-verification error for payout %s: %v", record.ID, kycErr)
		}
	}

	return record, nil
}

// NormalizePayoutType type-aware normalization
func NormalizePayoutType(payoutType, identifier string) string {
	cleaned := strings.ToUpper(strings.Join(strings.Fields(identifier), ""))
	switch payoutType {
	case model.PayoutTypeBank:
		// Sirf alphanumerics rakho (dashes/spaces hatao)
		return strings.NewReplacer("-", "", " ", "").Replace(cleaned)
	default:
		return cleaned
	}
}

// findByIdentity normalized identity se dhoondta hai
func (s *PayoutIdentityService) findByIdentity(
	ctx context.Context, normalized string,
) (*model.PayoutIdentity, error) {

	var record model.PayoutIdentity
	err := s.db.WithContext(ctx).
		Where("normalized_identity = ?", normalized).
		First(&record).Error

	if err != nil {
		return nil, err
	}
	return &record, nil
}

// VerifyPayoutIdentity payout identity verify karta hai (admin action)
func (s *PayoutIdentityService) VerifyPayoutIdentity(
	ctx context.Context, id uuid.UUID,
) (*model.PayoutIdentity, error) {

	now := time.Now()

	if err := s.db.WithContext(ctx).Model(&model.PayoutIdentity{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":      "verified",
			"verified_at": &now,
		}).Error; err != nil {
		return nil, err
	}

	var record model.PayoutIdentity
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// GetVerifiedPayout user ka verified primary payout deta hai
// Payout tabhi ja sakta hai jab identity VERIFIED ho
func (s *PayoutIdentityService) GetVerifiedPayout(
	ctx context.Context, userID uuid.UUID,
) (*model.PayoutIdentity, error) {

	var record model.PayoutIdentity
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND status = ?", userID, "verified").
		Order("is_primary DESC, created_at ASC").
		First(&record).Error

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPayoutNotVerified
		}
		return nil, err
	}
	return &record, nil
}

// ListPayouts user ke saare payout methods list karta hai
func (s *PayoutIdentityService) ListPayouts(
	ctx context.Context, userID uuid.UUID,
) ([]model.PayoutIdentity, error) {

	var records []model.PayoutIdentity
	err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("is_primary DESC, created_at ASC").
		Find(&records).Error
	return records, err
}

// DeletePayout payout method delete karta hai
func (s *PayoutIdentityService) DeletePayout(ctx context.Context, userID, id uuid.UUID) error {
	return s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		Delete(&model.PayoutIdentity{}).Error
}

// maskIdentity identity ko display ke liye mask karta hai
// e.g. "user@okhdfcbank" -> "us***nk@ok**********"
func maskIdentity(s string, keepStart, keepEnd int) string {
	runes := []rune(s)
	if len(runes) <= keepStart+keepEnd {
		return strings.Repeat("*", len(runes))
	}
	return string(runes[:keepStart]) +
		strings.Repeat("*", len(runes)-keepStart-keepEnd) +
		string(runes[len(runes)-keepEnd:])
}

// isUniqueViolation Postgres unique constraint violation detect karta hai
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint") ||
		strings.Contains(msg, "duplicate key value")
}
