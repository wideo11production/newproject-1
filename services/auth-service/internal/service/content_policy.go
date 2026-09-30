package service

// ============================================================================
// CONTENT UPLOAD POLICY  -  Phase B2 (gap #4)
// ============================================================================
//
// WHAT THE GAP ACTUALLY WAS
// -------------------------
// `user_settings.content_upload_enabled` (migration 007) ek REAL column hai,
// aur settings API usse read + update dono karti hai. Lekin KISI code me isse
// ENFORCE nahi kiya gaya tha - koi upload endpoint ise check nahi karta tha.
//
// Matlab user toggle OFF karta, UI turant update ho jaati thi, aur kuch bhi
// hota nahi tha. Ye "persisted but inert" state hai - jo settings page
// (toggle dikhata hai) aur backend (ignore karta hai) ke beech ka mismatch
// banata hai. User ko feature on hai dikhta hai jabki wo karta kuch nahi.
//
// WHY A SEPARATE FILE
// -------------------
// Ye ek POLICY hai, enforcement nahi. Iska kaam sirf ye decide karna hai ki
// "is user ko content upload allowed hai ya nahi, aur agar nahi to KYON".
// Ye jaan-boojh kar handler se alag rakha gaya hai taaki:
//   1. Uski jagah TRUTH_SOURCE ban rahe - har upload entry point isi ek
//      function se guzre, na ki har handler apna alag `if` likhe
//   2. Reasons ENUMERATED ho sakein, taaki frontend ek toggle ka nahi,
//      specific reason dikha sake ("uploads paused" vs "account inactive")
//   3. Ye testable ho bina HTTP layer ke - pure logic, koi DB write nahi
//
// IMPORTANT SCOPE NOTE
// -------------------
// Is file me koi upload endpoint NAHI hai, kyunki content domain abhi exist
// nahi karta (koi `videos` table nahi, transcoding-service local
// `/tmp/uploads` se padhta hai aur MinIO se wired nahi hai). Isliye ye
// policy abhi tak kisi route par call nahi ho rahi.
//
// Jab content upload surface banaaya jaayega, uske HAR entry point par
// `RequireContentUpload` call hona chahiye - ye policy uska gate hai.
// Bina gate ke naya upload endpoint likhna ye gap dobara khol dena hai.
//
// ---- AVATAR/COVER ISSE JAAN-BUJH KAR GATE NAHI HOTE ----
// Avatar aur channel cover PROFILE ASSETS hain, content nahi. Agar
// `content_upload_enabled = false` par avatar block kar diya jaaye to user
// apni profile photo nahi badal paayega - jo galat behaviour hai aur
// confusing bug banayega ("maine upload on kiya tha phir bhi avatar nahi
// ja raha"). Ye do alag capabilities hain aur inhe alag rakhna zaroori hai.
//
// Hinglish: ye sirf "allow hai ya nahi" decide karta hai, enforce karne wala
// code iske upar banega

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// UploadDecisionReason - upload kyun ya kyun nahi allowed.
//
// Ye enum jaan-boojh kar string hai (DB ke liye nahi, API ke liye) - frontend
// ise switch karke user ko SPECIFIC message de sakta hai, na ki ek generic
// "upload failed".
type UploadDecisionReason string

const (
	// ReasonAllowed - sab theek hai.
	ReasonAllowed UploadDecisionReason = "allowed"

	// ReasonDisabledByUser - user ne khud toggle off kiya hai.
	//
	// Ye SABSE important reason hai, isliye alag rakha hai: ye user ki apni
	// marzi hai (jaise "pause my uploads"), koi error nahi. Isliye isko 403
	// de sakte hain par message reassuring honi chahiye, scary nahi.
	ReasonDisabledByUser UploadDecisionReason = "disabled_by_user"

	// ReasonAccountInactive - `users.is_active = false`.
	//
	// Ye alag rakhna zaroori hai: user ne toggle off NAHI kiya, balki admin
	// ne account deactivate kiya. User ko "resume uploads" button dikhana
	// galat hoga - wo kaam karega hi nahi. Message mein admin-contact
	// hona chahiye.
	ReasonAccountInactive UploadDecisionReason = "account_inactive"

	// ReasonEmailUnverified - user ne email verify nahi ki.
	//
	// Ye bhi deliberate gate hai: verified email bina content upload karne
	// dena spam aur impersonation dono easy banata hai. Default `true` hai
	// migration 007 me, isliye naye users ke liye ye pehla blocker hota hai.
	ReasonEmailUnverified UploadDecisionReason = "email_unverified"

	// ReasonUserNotFound - user hi nahi mila.
	//
	// SECURITY: ye reason DELIBERATELY alag hai, aur ise kabhi bhi client ko
	// nahi bhejna chahiye. Ye sirf server-side logging ke liye hai - client
	// ko generic `not_authenticated` dikhna chahiye, warna ye ek existence
	// oracle ban jayega (valid UUID vs invalid UUID ka distinction).
	ReasonUserNotFound UploadDecisionReason = "user_not_found"
)

// UploadDecision - policy ka nateeja.
type UploadDecision struct {
	Allowed bool
	// Reason - enum, so the client can branch on it.
	Reason UploadDecisionReason
	// Message - human readable, safe to show a user.
	//
	// NOTE: `ReasonUserNotFound` par ye message DELIBERATELY generic hai -
	// "user does not exist" bolna existence leak hota hai.
	Message string
}

// decideUpload - PURE decision function.
//
// Ye jaan-boojh kar DB se alag rakha gaya hai, taaki ye bina database ke
// test ho sake. `IsContentUploadAllowed` sirf teen values DB se padh kar isko
// call karta hai.
//
// ---- WHY THIS MATTERS ----
// Authorization logic ko DB ke peeche chhupane ka matlab hai ki uska test
// likhna mushkil ho jata hai, aur uske bina woh khud bhi verified nahi hota.
// Ye function pure hai: teen bool input, ek struct output. Iske liye
// database, network, ya container ki zaroorat nahi - to saare edge cases
// (inactive + unverified + disabled, sab ek saath) exhaustively test ho
// sakte hain.
//
// ---- ORDER IS DELIBERATE ----
// Check order user ko SABSE actionable message dikhata hai:
//  1. inactive      -> "contact support"   (admin ne band kiya)
//  2. unverified    -> "verify your email"  (user khud kar sakta hai)
//  3. disabled      -> "turn uploads on"     (user ki apni marzi)
//
// Agar order alag hota (jaise toggle pehle), to inactive user ko "resume
// uploads" dikhta jabki usse wo button kuch nahi karega - user confuse hota
// aur support call aata.
//
// ---- FAIL-CLOSED BY DEFAULT ----
// Teenon false milte hain tab bhi ek defined reason return hota hai, `allowed`
// kabhi implicit true nahi hota.
func decideUpload(isActive, isVerified, contentUploadEnabled bool) UploadDecision {
	if !isActive {
		return UploadDecision{
			Allowed: false,
			Reason:  ReasonAccountInactive,
			Message: "Your account is inactive. Contact support to reactivate it.",
		}
	}

	if !isVerified {
		return UploadDecision{
			Allowed: false,
			Reason:  ReasonEmailUnverified,
			Message: "Verify your email address before uploading content.",
		}
	}

	if !contentUploadEnabled {
		return UploadDecision{
			Allowed: false,
			Reason:  ReasonDisabledByUser,
			Message: "Content uploads are turned off in your settings.",
		}
	}

	return UploadDecision{Allowed: true, Reason: ReasonAllowed, Message: "ok"}
}

// IsContentUploadAllowed checks whether a user may upload content.
//
// This is the SINGLE SOURCE OF TRUTH for the `content_upload_enabled` toggle.
// Every content-upload entry point must go through this (or `RequireContentUpload`).
//
// ---- WHY FOUR SEPARATE DB READS AND NOT ONE JOIN ----
// `user_settings` aur `users` alag tables hain, aur ek read me dono laane ke
// liye join chahiye hota. But `GetOrCreateSettings` already handles "row
// nahi hai" case (default `true` banata hai), aur `users` read to har upload
// par authentication ke liye already ho chuka hota hai.
//
// Ye function deliberately STANDALONE hai - koi existing cached state par
// depend nahi karta. Reason: ye ek AUTHORIZATION decision hai, aur stale
// cached data se allow/deny galat hona security bug hai. Performance ke liye
// isko cache karna ho to cache ko `users.is_active` jaise
// security-critical fields pe KABHI nahi rakhna chahiye.
//
// NOTE: ye read-only hai - koi row create/update nahi karta. Isliye ise
// "hasn't opened settings yet" state par bhi sahi behave karta hai:
// `GetOrCreateSettings` default `true` deta hai, jo migration 007 ke
// `DEFAULT true` se match karta hai.
func (s *AuthService) IsContentUploadAllowed(
	ctx context.Context,
	userID uuid.UUID,
) (*UploadDecision, error) {
	// ---- 1. User exists and is active? ----
	//
	// `Select` sirf zaroori columns - full user row (bcrypt hash, etc.)
	// load karne ki zaroorat nahi hai authorization ke liye, aur wo PII
	// ko memory me ghera hota hai.
	var user struct {
		ID         uuid.UUID
		IsActive   bool
		IsVerified bool
	}
	err := s.db.WithContext(ctx).
		Model(&model.User{}).
		Select("id", "is_active", "is_verified").
		Where("id = ?", userID).
		First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// SECURITY: message generic rakha hai - "account does not exist"
			// bolne se ye endpoint UUID-existence oracle ban jata hai.
			return &UploadDecision{
				Allowed: false,
				Reason:  ReasonUserNotFound,
				Message: "Sign in again to continue.",
			}, nil
		}
		// Real DB error - propagate. Isko "not allowed" me convert karna
		// galat hota: ek transient DB glitch user ko permission-denied
		// dikha dega, jo debugging mushkil banata hai. Fail closed rahega
		// kyunki caller's `RequireContentUpload` error par block karta hai.
		return nil, err
	}

	// ---- 2. The toggle itself ----
	//
	// `GetOrCreateSettings` se reuse hota hai taaki "row nahi hai" case ka
	// behaviour ek hi jagah defined rahe (default `true`), aur ye function
	// settings ki copy na banaye.
	settings, err := s.GetOrCreateSettings(ctx, userID)
	if err != nil {
		return nil, err
	}

	// ---- 3. Pure decision ----
	decision := decideUpload(user.IsActive, user.IsVerified, settings.ContentUploadEnabled)
	return &decision, nil
}

// ErrContentUploadDisabled - upload policy ne allow nahi kiya.
//
// Ye ek SENTINEL error hai, taaki handler `errors.Is()` se reason extract kar
// sake aur sahi HTTP status de sake (403, na ki 500).
var ErrContentUploadDisabled = errors.New("content upload not permitted")

// RequireContentUpload - gate helper.
//
// Isko upload handler ke SABSE PEHLE call karna hai, koi side effect karne
// se PEHLE (jaise presigned URL issue karna, ya DB me row insert karna).
//
// Return contract:
//   - (nil, nil)         -> allowed, aage badho
//   - (decision, nil)    -> blocked, `decision.Reason` batata hai KYON
//   - (nil, err)         -> infra error (DB down). Ye bhi BLOCK karta hai -
//     fail closed. Upload allow karna is state me unsafe
//     hai, kyunki hum jaante hi nahi ki settings kya hain.
func (s *AuthService) RequireContentUpload(
	ctx context.Context,
	userID uuid.UUID,
) (*UploadDecision, error) {
	decision, err := s.IsContentUploadAllowed(ctx, userID)
	if err != nil {
		// Infra failure -> fail CLOSED, with a generic reason so the client
		// is not told "the database is down" (that is an information leak
		// and helps an attacker fingerprint infrastructure).
		return &UploadDecision{
			Allowed: false,
			Reason:  ReasonAccountInactive,
			Message: "Could not verify upload permissions. Please try again.",
		}, err
	}
	return decision, nil
}

// StatusCodeForDecision - HTTP status map.
//
// ---- WHY 403 AND NOT 401 ----
// 401 ka matlab "log in karo". User logged in hai - uski marzi se toggle off
// hai. 403 ("forbidden") sahi hai. Galat status bhejne se frontend galat
// message dikha sakta hai (jaise "session expired" jabki wo valid hai).
//
// NOTE: `ReasonUserNotFound` par 401 bhejte hain, 403 nahi - kyunki wo case
// actually "authenticated token ke baad bhi user nahi mila" hai, jo
// effectively stale-session hai. Aur message generic rehta hai.
func StatusCodeForDecision(d UploadDecision) int {
	switch d.Reason {
	case ReasonAllowed:
		return 200
	case ReasonUserNotFound:
		return 401
	case ReasonAccountInactive, ReasonEmailUnverified, ReasonDisabledByUser:
		return 403
	default:
		// Unknown reason -> fail closed with 403. Naya reason add karna ho to
		// is switch ko update karna padega, jo deliberate hai: silently
		// fall through karke kuch allow kar dena security bug hota hai.
		return 403
	}
}
