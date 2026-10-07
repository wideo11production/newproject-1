package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

// ---------------------------------------------------------------------------
// AURA Student Gate service — verification state, identity token,
// and the educational-violation penalty law.
//
// Hinglish: ye service discount eligibility, 365-day token mint,
// aur content-violation penalty (25% plan price) handle karta hai.
// Upload interception (educational category check) ALAG service
// (upload-service interceptor) karega — ye sirf billing side
// penalty + revocation deta hai jab violator flag aaye.
// ---------------------------------------------------------------------------

// Student identity statuses — ALIASES of model.StudentStatusXxx.
// Hinglish: ye constants model package mein hain; yahan sirf
// reference rakhte hain taaki service code mein `StudentStatusVerified`
// jaisa short name chalta rahe (model.StudentStatusVerified bhi chalega,
// par short alias codebase-wide consistency ke liye).
const (
	StudentStatusPending  = model.StudentStatusPending
	StudentStatusVerified = model.StudentStatusVerified
	StudentStatusRevoked  = model.StudentStatusRevoked
	StudentStatusRejected = model.StudentStatusRejected
)

// StudentIdentityTokenTTL - 365-day absolute lifecycle (Gate B).
const StudentIdentityTokenTTL = 365 * 24 * time.Hour

var (
	ErrNoActiveSubscription = errors.New("no_active_subscription")
)

// StudentService - AURA student gate business logic.
type StudentService struct {
	repo   repository.StudentIdentityRepository
	subRepo repository.SubscriptionRepository
	planRepo repository.SubscriptionPlanRepository
}

// NewStudentService builds the student gate engine.
func NewStudentService(
	repo repository.StudentIdentityRepository,
	subRepo repository.SubscriptionRepository,
	planRepo repository.SubscriptionPlanRepository,
) *StudentService {
	return &StudentService{repo: repo, subRepo: subRepo, planRepo: planRepo}
}

// IsVerifiedStudent - discount eligibility. 365-day token exp &&
// status verified && flag true. This is what feeds
// DiscountEligibility.IsVerifiedStudent into GetPlanForUser.
//
// Hinglish: ye function boolean return karta hai kyunki
// educational-violation penalty ka amount alag hi nikalta
// hai — eligibility sirf ek gate check hai.
func (s *StudentService) IsVerifiedStudent(ctx context.Context, userID uint) bool {
	return s.repo.IsVerified(ctx, userID)
}

// GrantVerification - admin manual review (degree/ID image dekha
// kar) hone par verification grant karta hai. 365-day identity
// token mint hota hai.
//
// `jwtSecret` the shared JWT_SECRET_KEY (auth-service se). Token
// signing key bank nahi, sirf proof-of-issuance.
func (s *StudentService) GrantVerification(ctx context.Context, userID uint, reviewedBy uint, jwtSecret []byte) (*model.StudentIdentity, error) {
	now := time.Now().UTC()
	token, err := mintStudentIdentityToken(userID, jwtSecret)
	if err != nil {
		return nil, err
	}
	exp := now.Add(StudentIdentityTokenTTL)
	si := &model.StudentIdentity{
		UserID:                 userID,
		IsVerifiedStudent:      true,
		Status:                 StudentStatusVerified,
		IdentityToken:          token,
		IdentityTokenExpiresAt: &exp,
		ReviewedBy:             reviewedBy,
		ReviewedAt:             &now,
	}
	if err := s.repo.Upsert(ctx, si); err != nil {
		return nil, err
	}
	return si, nil
}

// mintStudentIdentityToken - 365-day degree proof JWT.
//
// Claim set deliberately DISTINCT from session JWT: koi
// session_id, koi service claim nahi, sirf degree_verified +
// user_id + exp. Isliye is token ko session ke saath confuse
// nahi kiya ja sakta.
func mintStudentIdentityToken(userID uint, secret []byte) (string, error) {
	claims := struct {
		DegreeVerified bool `json:"degree_verified"`
		UserID         uint `json:"user_id"`
		jwt.RegisteredClaims
	}{
		DegreeVerified: true,
		UserID:         userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "billing-service-student-gate",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(StudentIdentityTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// ValidateStudentIdentityToken - token parse + expiry + issuer
// verify. Returns the embedded userID.
func ValidateStudentIdentityToken(tokenStr string, secret []byte) (userID uint, err error) {
	claims := struct {
		DegreeVerified bool `json:"degree_verified"`
		UserID         uint `json:"user_id"`
		jwt.RegisteredClaims
	}{}
	_, err = jwt.ParseWithClaims(tokenStr, &claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return secret, nil
	})
	if err != nil {
		return 0, err
	}
	if !claims.DegreeVerified {
		return 0, fmt.Errorf("token not degree-verified")
	}
	return claims.UserID, nil
}

// CalculateStudentRevocationPenalty - 25% of plan price.
//
// Hinglish: jab ek verified student educational content ke bajaye
// other category upload kare, to use jis plan par discount
// mila tha uska 25% penalty jama karta hai (standard pricing
// par phir se switch). Money math yahan (Go) hota hai — React
// kabhi nahi karega (PROGRESS.md iron rule).
func CalculateStudentRevocationPenalty(plan *model.SubscriptionPlan) decimal.Decimal {
	return money(plan.Price.Mul(
		decimal.NewFromInt(DiscountPercent).Div(decimal.NewFromInt(100)),
	))
}

// RevocationPenaltyForUser - user ke current subscription plan ka
// 25% penalty. Penalty sirf tab banta hai jab student revocation
// hoti hai (verification status false ho jaye to discount stop,
// lekin jo discount pehle mila tha — uska 25% wapas lena hai).
func (s *StudentService) RevocationPenaltyForUser(ctx context.Context, userID uint) (decimal.Decimal, error) {
	sub, err := s.subRepo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return decimal.Decimal{}, ErrNoActiveSubscription
		}
		return decimal.Decimal{}, err
	}
	if sub == nil {
		return decimal.Decimal{}, ErrNoActiveSubscription
	}
	plan, err := s.planRepo.GetByID(ctx, sub.PlanID)
	if err != nil {
		return decimal.Decimal{}, err
	}
	return CalculateStudentRevocationPenalty(plan), nil
}

// RevokeForEducationalViolation - content interceptor ne fire kiya.
//
// Step B ka billing-side: flag false + token clear. Account-bar +
// email warning + invoice creation agle slice mein (upload-service
// interceptor + email-service + auth-service lock ke saath).
func (s *StudentService) RevokeForEducationalViolation(ctx context.Context, userID uint) error {
	return s.repo.RevokeByUserID(ctx, userID)
}
