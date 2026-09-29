package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"net/url"
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

// BuildVerificationURLWithEmail verification link banata hai jisme email bhi
// query param ke roop me hota hai.
//
// KYUN: `/auth/verify` page par RESEND panel hota hai (token expire / 429 par).
// Agar link me email carried hota hai to wo panel PRE-FILLED ho jaata hai aur
// user ko email dobara type nahi karni padti.
//
// SECURITY: ye sirf UX convenience hai, koi auth decision nahi. Token hi
// proof hai; email param ke baghair bhi verification kaam karta hai. Aur ye
// email wo HI hai jispar email bheja gaya tha - koi sensitive leak nahi
// (user khud usi inbox me link click kar raha hai).
//
// Email ko `url.QueryEscape` karna ZAROORI hai - `@` aur `+` jaise chars
// URL me safe nahi hote (plus `+` space ban jata hai).
func (s *AuthService) BuildVerificationURLWithEmail(plainToken, emailAddr string) string {
	base := s.cfg.Verification.BaseURL
	if base == "" {
		base = "http://localhost:3000"
	}
	for len(base) > 0 && base[len(base)-1] == '/' {
		base = base[:len(base)-1]
	}
	if emailAddr == "" {
		return fmt.Sprintf("%s/auth/verify?token=%s", base, plainToken)
	}
	return fmt.Sprintf(
		"%s/auth/verify?token=%s&email=%s",
		base,
		plainToken,
		url.QueryEscape(emailAddr),
	)
}

// SendVerificationEmail verification email bhejta hai
func (s *AuthService) SendVerificationEmail(ctx context.Context, user *model.User, plainToken string) error {
	if s.emailer == nil {
		// Email dispatcher nahi hai - silently skip, account phir bhi bana rahega
		return nil
	}

	// Link me email bhi carry karo taaki /auth/verify page ka resend panel
	// pre-filled ho (user ko email dobara type nahi karni padti).
	verifyURL := s.BuildVerificationURLWithEmail(plainToken, user.Email)
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

	// ---- SUCCESS LOG (pehle missing tha) ----
	// Pehle yahan koi "email bhej diya" log nahi tha. Sirf FAILURE log hota
	// tha (`[VERIFY] Failed to send...`). Iska matlab: agar email bhejne me
	// error nahi aaya to log me KUCH nahi dikhta - aur hum "bheja gaya" aur
	// "bheja hi nahi" me differentiate hi nahi kar paate the.
	//
	// Ab har successful send par ek line log hota hai jisme:
	//   - recipient
	//   - verify URL ka BASE (localhost ya real domain)
	//   - token expiry
	// Ye debugging ke liye critical hai, kyunki verification link
	// localhost jaisa base URL point karta hai to bade problem hote hain
	// (email PHONE pe kholne par link dead ho jata hai).
	//
	// NOTE: token value LOG nahi hota (secret hai). Sirf base URL log hota
	// hai jo secret nahi hai.
	log.Printf("[VERIFY] Verification email queued to=%s base_url=%s expires_in=%dm",
		user.Email, s.cfg.Verification.BaseURL, ttl)

	// ---- FAST PATH: background queue (preferred) ----
	//
	// Agar queue set hai (main.go me `SetEmailQueue` se inject hota hai), to
	// email DETACH kar do - request turant return ho jati hai aur worker
	// email bhejta hai. Yehi wo fix hai jo registration ka ~5s wait hata deta
	// hai.
	//
	// FALLBACK: queue nil hai ya bhar gaya hai -> synchronous path pe girte
	// hain, taaki email kabhi DROP na ho. (Rare fallback, bas slow ho jata
	// hai - jo email bhejne se behtar hai.)
	if s.emailQueue != nil {
		if queued := s.emailQueue.QueueVerificationEmail(
			user.Email, user.FullName, verifyURL, displayCode, ttl,
		); queued {
			return nil
		}
		log.Printf("[VERIFY] Queue unavailable, falling back to synchronous send for %s", user.Email)
	}

	// ---- SLOW PATH: synchronous (fallback / queue disabled) ----
	err := s.emailer.SendVerificationEmail(user.Email, user.FullName, verifyURL, displayCode, ttl)
	if err != nil {
		log.Printf("[VERIFY] SendVerificationEmail returned error for %s: %v", user.Email, err)
		return err
	}

	log.Printf("[VERIFY] SMTP accepted message for %s (link: %s)", user.Email, verifyURL)
	return nil
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
		// ---- FALLBACK: token pehle consume ho chuka hai kya? ----
		// `GetByHash` sirf UNUSED tokens return karta hai (`IsUsable()`
		// check karta hai). Ab consumed token ko raw lookup se dhoondhte hain.
		//
		// USER-FACING PROBLEM jo ye solve karta hai:
		//   Email link click kiya -> account verified -> user ne page
		//   REFRESH kiya (ya email dobara khola, ya back-forward kiya) ->
		//   wahi token dobara gaya -> "not found or expired" ERROR dikha,
		//   jabki account actually verified hai. User confuse hota hai ki
		//   verification fail hui.
		//
		// SECURITY: ye koi naya account verify nahi kar sakta. Ye sirf
		// ALREADY-verified state report karta hai - koi state change nahi
		// hota, sirf ek honest success response milta hai.
		if used, uErr := s.verifRepo.GetByHashIncludingUsed(ctx, tokenHash); uErr == nil && used.VerifiedAt != nil {
			// Token use ho chuka hai -> user verified hai ya nahi check karo
			if existing, eErr := s.userRepo.GetByID(ctx, used.UserID); eErr == nil && existing.IsVerified {
				log.Printf("[VERIFY] Re-click on consumed token for %s - already verified, returning success", existing.Email)
				return existing, nil
			}
		}
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

// verificationEmailQueuer - OPTIONAL interface.
//
// Ye tab implement hota hai jab emailer background queue deta hai
// (`email.Dispatcher`). Type assertion se pata lagta hai ki queue available
// hai ya nahi - agar nahi, to code synchronous path par chalta hai (jo bhi
// theek hai, bas slow).
//
// Ye design isliye "optional interface" hai taki email package aur service
// package ka coupling kam rahe, aur test stubs (jo sirf
// `SendVerificationEmail` implement karte hain) bhi chal sakein.
type verificationEmailQueuer interface {
	QueueVerificationEmail(to, fullName, verifyURL, code string, ttlMinutes int) bool
}

// VerificationTTLMinutes configured TTL minutes me return karta hai.
//
// Resend handler ko ye chahiye taaki response me bata sake ki naya token
// kitni der valid rahega. Config 0 ya negative hua to default 30 (jo
// IssueVerificationToken bhi use karta hai).
func (s *AuthService) VerificationTTLMinutes() int {
	ttl := s.cfg.Verification.TTLMinutes
	if ttl <= 0 {
		return 30
	}
	return ttl
}

// ResendVerificationForUser unverified user ko naya verification token issue
// karta hai aur email bhejta hai.
//
// IMPORTANT: ye `IssueVerificationToken` internally call karta hai, jisme
// PEHLE `verifRepo.DeleteByUserID` hota hai. Matlab:
//   - purana / expired / already-used token DELETE ho jata hai
//   - sirf naya token valid rehta hai
//
// Isse requirement "resend click karne par purana token bhi delete ho jaye"
// naturally satisfy hoti hai - alag se kuch karne ki zaroorat nahi.
//
// Ye method sirf UNVERIFIED users ke liye call hona chahiye (verified users
// ko naye token ki zaroorat nahi - wo login kar sakte hain).
//
// Hinglish: naya token banao, purana delete karo, email bhejo
func (s *AuthService) ResendVerificationForUser(ctx context.Context, user *model.User) error {
	if user == nil {
		return fmt.Errorf("user is nil")
	}
	if user.IsVerified {
		return fmt.Errorf("user already verified")
	}

	// Same code path as registration - purana token delete + naya issue.
	plainToken, err := s.IssueVerificationToken(ctx, user.ID, user.Email)
	if err != nil {
		return err
	}

	// Email bhejo. Iska error PROPAGATE karna zaroori hai - warna user ko
	// "email bhej diya" dikhega jabki actually bheja nahi gaya.
	return s.SendVerificationEmail(ctx, user, plainToken)
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
