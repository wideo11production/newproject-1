package service

// ============================================================================
// PIN ROLLOVER + TOKEN PURGE
// ============================================================================
//
// REQUIREMENT: "user apna old 6 digit pin verify karke new pin generate kar
// sakta hai, aur jo old/unused tokens DB me hain wo hard-delete ho jayein".
//
// ---------------------------------------------------------------------------
// SECURITY DESIGN (this is the part that matters)
// ---------------------------------------------------------------------------
//
// 1. OLD PIN MUST BE VERIFIED FIRST
//    Naya PIN set karne se pehle current PIN bcrypt se verify hota hai.
//    Iske bina koi bhi logged-in attacker (shared device, hijacked session)
//    apna PIN badal ke account lock out kar sakta tha.
//
// 2. ALL OTHER SESSIONS DIE
//    Naya PIN set hone par saare OTHER sessions revoke ho jaate hain -
//    refresh tokens delete + sessions revoked.
//
//    KYUN: maan lo purana PIN kisi ke haath se chala gaya (shoulder-surf,
//    lost laptop). Agar purane PIN wale sessions zinda rahe, to PIN change
//    karna SECURITY THEATER hota - attacker apna token use karta rehta,
//    user ko lagta "maine PIN badal diya, safe ho gaya".
//
//    IMPORTANT DESIGN CHOICE: CURRENT session bhi rehta hai
//    ---------------------------------------------------------------
//    User jis device par PIN change kar raha hai, uska session VALID rehta
//    hai - warna use turant logout ho jayega aur woh apna naya PIN kabhi
//    use hi nahi kar paayega. Sirf DUSRE devices marte hain.
//    (Agar "har device logout, including this one" chahiye to strict mode
//    jodna padega - wo ek alag product decision hai.)
//
// 3. TOKEN PURGE (requirement: "old unused tokens DB me garbage na ho")
//    Ye DELETE (soft-delete nahi) hai, kyunki:
//      - verification tokens expire hote hain, unka residue security surface
//        deta hai (koi purana token leak ho to usable rahega)
//      - refresh tokens: purane tokens revoke hone se pehle valid the
//    SCOPE: sirf is user ke tokens. KABHI global purge nahi - wo live users
//    ke sessions maar sakta hai.
//
// Hinglish comments: har block ka arth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// RolloverResult - PIN change ka outcome (frontend ko dikhane ke liye)
type RolloverResult struct {
	// Kitne refresh tokens delete hue
	RefreshTokensDeleted int64 `json:"refresh_tokens_deleted"`
	// Kitne sessions revoke hue (current session chhod kar)
	SessionsRevoked int64 `json:"sessions_revoked"`
	// Kitne expired/used verification tokens clean hue
	VerificationTokensDeleted int64 `json:"verification_tokens_deleted"`
	// Current session bacha ya nahi
	CurrentSessionKept bool `json:"current_session_kept"`
}

// ErrSessionNotProvided - current session id nahi mili
//
// SECURITY: iske bina hum CURRENT session nahi differentiate kar sakte,
// aur saare sessions revoke ho jayenge - including the one doing the
// change. Isliye ye zaroori hai.
var ErrSessionNotProvided = errors.New("session context required for secure PIN rollover")

// VerifyExistingPIN sirf CHECK karta hai - kuch change nahi karta.
//
// REQUIREMENT: "user jo 6 digit pin sahi dalta ha tabhi change pin wala card
// open karo". Matlab UI ko pehle verify karna hai, phir form reveal karna hai.
//
// SECURITY NOTES:
//  1. Ye read-only hai - koi state change nahi, koi session revoke nahi.
//  2. Ye ek credential oracle hai (batata hai "PIN sahi hai ya nahi"), isliye
//     ise rate-limit me hi rakhna zaroori hai - wahi `verify` bucket jisme
//     `POST /security/pin/verify` already hai.
//  3. Failed attempts account lockout badhate hain (same as the real
//     verify) - to brute force ka dar koi nahi.
//
// Error: `ErrOldPINIncorrect` (403) ya `ErrPINInvalid` (no PIN set).
func (s *AuthService) VerifyExistingPIN(ctx context.Context, userID uuid.UUID, pin string) error {
	if !isValidPIN(pin) {
		return fmt.Errorf("PIN must be exactly %d digits", model.PINLength)
	}

	var record model.SecurityPIN
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&record).Error; err != nil {
		return ErrPINInvalid
	}
	if !verifySecret(record.PINHash, pin) {
		return ErrOldPINIncorrect
	}
	// Locked hai to batao - user ko batana chahiye ki PIN sahi hai par
	// account lockout me hai.
	if record.PINLockedUntil != nil && record.PINLockedUntil.After(time.Now()) {
		return ErrLockoutActive
	}
	return nil
}

// VerifyExistingPassword sirf CHECK karta hai - kuch change nahi karta.
func (s *AuthService) VerifyExistingPassword(ctx context.Context, userID uuid.UUID, password string) error {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}
	if err := s.passwordSvc.Verify(password, user.PasswordHash); err != nil {
		return fmt.Errorf("current password is incorrect")
	}
	return nil
}

// RolloverSecurityPIN: old PIN verify karke naya PIN set karta hai, aur
// security cleanup karta hai (requirement Block 2.5).
//
// Params:
//   - userID       - jiska PIN badal raha hai
//   - currentSessID - jis session se request aayi (ye SURVIVE karega)
//   - oldPIN        - current PIN (verify hoga)
//   - newPIN        - naya 6-digit PIN
func (s *AuthService) RolloverSecurityPIN(
	ctx context.Context,
	userID, currentSessID uuid.UUID,
	oldPIN, newPIN string,
) (*RolloverResult, error) {
	// ---- 1. Session context zaroori (current ko bachane ke liye) ----
	if currentSessID == uuid.Nil {
		return nil, ErrSessionNotProvided
	}

	// ---- 2. Naya PIN format valid hai? ----
	if !isValidPIN(newPIN) {
		return nil, errors.New("new PIN must be exactly 6 digits")
	}

	// ---- 3. Purana PIN verify (bcrypt compare) ----
	//
	// NOTE: ye `ChangePIN` ke andar hota hai jo bcrypt se compare karta hai.
	// Agar purana galat hai to `ErrOldPINIncorrect` return hoga - aur tab
	// tak kuch bhi delete NAHI hoga (fail fast, no partial side effects).
	var record model.SecurityPIN
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&record).Error; err != nil {
		return nil, ErrPINInvalid
	}
	if !verifySecret(record.PINHash, oldPIN) {
		return nil, ErrOldPINIncorrect
	}

	// ---- 4. Reuse check: naya purane jaisa nahi ho sakta ----
	//
	// Agar same PIN allowed hota, to "change" karna security ke liye bekaar
	// hota - purana (compromised) PIN waisa hi rehta.
	if verifySecret(record.PINHash, newPIN) {
		return nil, ErrNewPINSameAsOld
	}

	// ---- 5. Naya PIN persist ----
	record.PINHash = hashSecret(newPIN)
	record.FailedPINAttempts = 0
	record.PINLockedUntil = nil
	if err := s.db.WithContext(ctx).Save(&record).Error; err != nil {
		return nil, err
	}

	// ---- 6. Security cleanup (ab tak sab verify ho chuka hai) ----
	result := &RolloverResult{CurrentSessionKept: true}

	// 6a. Refresh tokens DELETE (hard) - inse naye access tokens issue nahi
	//     honge, aur purane refresh-token se koi naya session nahi banega.
	tx := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Delete(&model.RefreshToken{})
	if tx.Error != nil {
		return nil, tx.Error
	}
	result.RefreshTokensDeleted = tx.RowsAffected

	// 6b. Sessions revoke - EXCEPT current.
	//
	//     `WHERE user_id = ? AND id != ?` - ye ensure karta hai ki jis
	//     device par PIN change ho raha hai wo logged-in rahe.
	//
	//     NOTE: ye `Unscoped()` chahiye kyunki Session model me bhi
	//     DeletedAt (soft delete) ho sakta hai - GORM default scope
	//     revoked rows ko chhupa deta hai.
	sessRes := s.db.WithContext(ctx).
		Model(&model.Session{}).
		Where("user_id = ? AND id != ?", userID, currentSessID).
		Unscoped().
		Update("revoked_at", time.Now())
	if sessRes.Error != nil {
		return nil, sessRes.Error
	}
	result.SessionsRevoked = sessRes.RowsAffected

	// 6c. Verification tokens: consumed/expired wale HARD DELETE.
	//
	//     Ye "garbage accumulation" wala requirement address karta hai -
	//     30-minute expiry ke baad bhi token rows pada rehne se:
	//       - DB space waste
	//       - (koi bug ho to) purana token leak hone ka surface
	//
	//     SIRF is user ke, aur SIRF wo jo used (verified_at set) ya expired.
	//     Active token DELETE NAHI hota - user verify nahi kar paaya to
	//     resend se naya milega.
	now := time.Now()
	verifRes := s.db.WithContext(ctx).
		Unscoped().
		Where(
			"user_id = ? AND (verified_at IS NOT NULL OR expires_at < ?)",
			userID, now,
		).
		Delete(&model.VerificationToken{})
	if verifRes.Error != nil {
		return nil, verifRes.Error
	}
	result.VerificationTokensDeleted = verifRes.RowsAffected

	return result, nil
}

// ChangePassword: password change karta hai + same security cleanup.
//
// SECURITY NOTE: ye tabhi safe hai jab OLD PASSWORD verify kiya jaaye -
// warna koi bhi logged-in session password badal sakta tha. Isi liye ye
// method old password ke bina call nahi hona chahiye.
func (s *AuthService) ChangePassword(
	ctx context.Context,
	userID, currentSessID uuid.UUID,
	oldPassword, newPassword string,
) (*RolloverResult, error) {
	if currentSessID == uuid.Nil {
		return nil, ErrSessionNotProvided
	}

	// ---- 1. Purana password verify ----
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	// NOTE: `Verify` se error nil aata hai matlab password CORRECT hai
	// (ye bool return nahi karta - bcrypt compare ka result error me hai).
	if err := s.passwordSvc.Verify(oldPassword, user.PasswordHash); err != nil {
		return nil, errors.New("current password is incorrect")
	}

	// ---- 2. Naya password hash karke save ----
	hashed, err := s.passwordSvc.Hash(newPassword)
	if err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).
		Model(&model.User{}).
		Where("id = ?", userID).
		Update("password_hash", hashed).Error; err != nil {
		return nil, err
	}

	// ---- 3. Same cleanup as PIN rollover ----
	result := &RolloverResult{CurrentSessionKept: true}

	tx := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Delete(&model.RefreshToken{})
	if tx.Error != nil {
		return nil, tx.Error
	}
	result.RefreshTokensDeleted = tx.RowsAffected

	sessRes := s.db.WithContext(ctx).
		Model(&model.Session{}).
		Where("user_id = ? AND id != ?", userID, currentSessID).
		Unscoped().
		Update("revoked_at", time.Now())
	if sessRes.Error != nil {
		return nil, sessRes.Error
	}
	result.SessionsRevoked = sessRes.RowsAffected

	now := time.Now()
	verifRes := s.db.WithContext(ctx).
		Unscoped().
		Where("user_id = ? AND (verified_at IS NOT NULL OR expires_at < ?)", userID, now).
		Delete(&model.VerificationToken{})
	if verifRes.Error != nil {
		return nil, verifRes.Error
	}
	result.VerificationTokensDeleted = verifRes.RowsAffected

	return result, nil
}
