package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/email"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/password"
	"github.com/wideo11/auth-service/internal/repository"
)

// IssueVerificationToken naya verification token banata hai, uska hash DB me
// store karta hai, aur plain token return karta hai (sirf email bhejne ke liye).
//
// SECURITY: Raw token DB me KABHI store nahi hota. DB me sirf SHA-256 hash jaata
// hai. Raw token sirf is function ke return value me hota hai aur turant email
// me chala jata hai.
//
// Ye token 30 minute me expire hoga (config se TTL).
//
// Hinglish: raw token DB me nahi jata, sirf hash - aur token 30 minute me expire hota hai
func (s *AuthService) IssueVerificationToken(ctx context.Context, userID uuid.UUID, emailAddr string) (string, error) {
	// 1) 32 random bytes ka secure token banao
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("failed to generate verification token: %w", err)
	}

	// Base64URL encode karo (email link me safe hai - koi URL-breaking char nahi)
	plainToken := base64.RawURLEncoding.EncodeToString(raw)

	// 2) TTL config se lo (SSOT - hardcoded nahi)
	ttl := time.Duration(s.cfg.Verification.TTLMinutes) * time.Minute
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}

	// 3) PEHLE purane pending tokens hata do.
	// ORDER MATTER: ye Create() se PEHLE hona zaroori hai. Agar ise baad me
	// karte to ye naya token bhi delete kar deta, aur table hamesha khaali
	// rehta - verification link kabhi kaam nahi karta.
	// Hinglish: naya token banane se pehle purane tokens saaf karte hain
	if err := s.verifRepo.DeleteByUserID(ctx, userID); err != nil {
		log.Printf("[VERIFY] Failed to clear old tokens for user %s: %v", userID, err)
	}

	// 4) Sirf HASH store karo, raw token nahi
	record := &model.VerificationToken{
		UserID:    userID,
		TokenHash: password.HashToken(plainToken),
		ExpiresAt: time.Now().Add(ttl),
		Purpose:   "email_verification",
	}

	if err := s.verifRepo.Create(ctx, record); err != nil {
		return "", err
	}

	log.Printf("[VERIFY] Issued verification token for %s (expires in %v)", emailAddr, ttl)
	return plainToken, nil
}

// BuildVerificationURL clickable verification link banata hai
// Hinglish: email me bhejne wala clickable link
func (s *AuthService) BuildVerificationURL(plainToken string) string {
	base := s.cfg.Verification.BaseURL
	if base == "" {
		base = "http://localhost:3000"
	}
	// Trim trailing slash to avoid double slash
	for len(base) > 0 && base[len(base)-1] == '/' {
		base = base[:len(base)-1]
	}
	return fmt.Sprintf("%s/auth/verify?token=%s", base, plainToken)
}

// SendVerificationEmail verification email bhejta hai
func (s *AuthService) SendVerificationEmail(ctx context.Context, user *model.User, plainToken string) error {
	if s.emailer == nil {
		// Email dispatcher nahi hai - silently skip, account phir bhi bana rahega
		return nil
	}

	verifyURL := s.BuildVerificationURL(plainToken)
	ttl := s.cfg.Verification.TTLMinutes
	if ttl <= 0 {
		ttl = 30
	}

	// ---- 6-DIGIT DISPLAY CODE ----
	// Ye code email ke HTML part me blurred + double-click-reveal block me
	// dikhta hai.
	//
	// IMPORTANT - HONEST NOTE: ye code DISPLAY-ONLY hai abhi. Ye VERIFICATION
	// LINK ka short display form hai, alag koi independent verify mechanism
	// nahi. Backend me abhi "code" column/lookup nahi hai, to is code se
	// verify karna KAAM NAHI karega - sirf LINK se verify hota hai.
	// (Kabhi bhi isse "6-digit se verify hota hai" mat samjhein.)
	//
	// VERIFY KA ASLI RASTA: email me diya gaya LINK. Ye har client me
	// chalta hai aur yehi reliable path hai.
	//
	// Is code ka practical use: user ko type karne ke liye ek short,
	// typeable reference milta hai (kuch users screenshot me note karte
	// hain). Real verify ke liye link use karo.
	displayCode := shortDisplayCode(plainToken)

	return s.emailer.SendVerificationEmail(user.Email, user.FullName, verifyURL, displayCode, ttl)
}

// shortDisplayCode token se ek chhota 6-digit code banata hai.
//
// NOTE (cryptography): ye koi cryptographic derivation NAHI hai. Ye token ke
// numeric characters ko fold karke 6 digit deta hai - sirf DISPLAY ke liye.
// Isse kabhi actual verification mat karo (isliye VerifyEmail me iska use
// nahi hai). Real verification hamesha full token se hoti hai.
//
// Hinglish: token ka display-only 6-digit shorthand. Sirf dikhane ke liye.
func shortDisplayCode(token string) string {
	// Token ke sab digits collect karo (hex token me 0-9 a-f hote hain,
	// hum sirf numeric chars lete hain taaki output hamesha digit rahe).
	var digits []rune
	for _, r := range token {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) == 0 {
		return "000000"
	}
	// Repeat until we have >= 6 digits (token me digits kam ho sakte hain)
	for len(digits) < 6 {
		digits = append(digits, digits...)
	}
	// Pehle 6 digits
	return string(digits[:6])
}

// VerifyEmail verification link click hone par call hota hai.
//
// Flow: raw token hash karo -> hash se DB me dhoondho -> token mark verified
// + user ko is_verified=true. Invalid/expired token par error.
//
// Hinglish: link click hua to token verify ho jata hai aur user verified ban jata hai
func (s *AuthService) VerifyEmail(ctx context.Context, plainToken string) (*model.User, error) {
	if plainToken == "" {
		return nil, repository.ErrVerificationTokenNotFound
	}

	// Raw token ko hash karke dhoondhte hain (DB me hash stored hai)
	tokenHash := password.HashToken(plainToken)
	record, err := s.verifRepo.GetByHash(ctx, tokenHash)
	if err != nil {
		return nil, err
	}

	// Token + user ko verified mark karo (transactional).
	// userID token record se aa raha hai - dobara query nahi karte.
	// Hinglish: dono updates ek transaction me
	if err := s.verifRepo.MarkVerified(ctx, record.ID, record.UserID); err != nil {
		return nil, err
	}

	// Updated user fetch karke return karte hain
	user, err := s.userRepo.GetByID(ctx, record.UserID)
	if err != nil {
		return nil, err
	}

	log.Printf("[VERIFY] Email verified for %s", user.Email)
	return user, nil
}

// emailDispatcherAdapter service ko email.Dispatcher se connect karta hai
// Ye interface use karte hain taaki service package email package import na kare
// (circular dependency se bachne ke liye)
type emailDispatcher interface {
	SendVerificationEmail(to, fullName, verifyURL, code string, ttlMinutes int) error
}

// SetEmailer email dispatcher set karta hai
func (s *AuthService) SetEmailer(e emailDispatcher) {
	s.emailer = e
}

// ensure email package referenced (compile-time check)
var _ = email.PurgeMessage
