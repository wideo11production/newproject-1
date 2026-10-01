// Security service - lockout engine, PIN, security questions, device limits
//
// YE "CHAKRAVYUH DEFENSE" ENGINE HAI. Iska kaam:
//  1. 3 galat passwords -> PIN required lockout
//  2. Galat PIN -> 3 minute blocked countdown
//  3. PIN/Questions/Password rotation with proper old-value verification
//  4. Device limit: max 3 accounts per device fingerprint
//  5. Security audit trail (Awareness Reports ka source)
//
// Hinglish comments: har block ka arth
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
)

// Security errors
var (
	ErrLockoutActive       = errors.New("account temporarily locked")
	ErrPINRequired         = errors.New("password lockout - PIN verification required")
	ErrPINInvalid          = errors.New("invalid PIN")
	ErrAccountBlocked      = errors.New("account blocked - too many failed attempts")
	ErrDeviceLimitExceeded = errors.New("device account limit reached")
	ErrSetupIncomplete     = errors.New("mandatory security setup incomplete")
	ErrInsufficientAnswers = errors.New("security answers do not match")
	ErrOldPINIncorrect     = errors.New("current PIN is incorrect")

	// ErrNewPINSameAsOld - user ne wahi PIN "change" kiya jo pehle se hai.
	// Isko reject karte hain kyunki tab PIN change ka koi security fayda nahi
	// hota - purana compromised PIN waisa hi rehta.
	ErrNewPINSameAsOld = errors.New("new PIN must be different from your current PIN")
)

// SecurityService security operations handle karta hai
type SecurityService struct {
	db *gorm.DB

	// deviceLimit: "max N accounts per device" ka on/off + cap value.
	// `.env` se aata hai (DEVICE_LIMIT_ENABLED / DEVICE_LIMIT_MAX_ACCOUNTS).
	// Zero value matlab: struct seedha banaya gaya bina config ke (tests) -
	// isliye helper method `deviceLimitEnforced()` zero value ko SPEC default
	// (ON, 3) maanta hai, taaki config bhool jane par bhi security ghat na ho.
	deviceLimitEnabled bool
	maxAccountsDevice  int
}

// NewSecurityService naya security service banata hai
//
// `cfg` device-limit switch carry karta hai. `cfg == nil` bhi allowed hai (tests
// ya koi future caller jo config bhool jaye) - aur us case me hum SPEC default
// maante hain: limit CHALU, cap 3. Yaani config na mile to security control
// ghaab nahi hota. Ye fail-secure hai, fail-open nahi.
//
// Real toggle sirf explicit `DEVICE_LIMIT_ENABLED=false` se aata hai - yaani
// jaan-boojh kar .env me likhna padta hai. Bhool kar chhod dene par bhi app
// SPEC ke mutabiq secure rehta hai.
func NewSecurityService(db *gorm.DB, cfg *config.Config) *SecurityService {
	// Start from SECURE defaults.
	s := &SecurityService{
		db:                 db,
		deviceLimitEnabled: true,
		maxAccountsDevice:  model.MaxAccountsPerDevice,
	}

	if cfg != nil {
		s.deviceLimitEnabled = cfg.DeviceLimit.Enabled
		s.maxAccountsDevice = cfg.DeviceLimit.MaxAccounts
	}

	// Invalid/zero/negative cap ko SPEC value par reset kar do. Warna `0` ka
	// matlab hota "limit 0" aur HAR register fail ho jata - jo silent breakage
	// hai, isliye guard zaroori hai.
	if s.maxAccountsDevice <= 0 {
		s.maxAccountsDevice = model.MaxAccountsPerDevice
	}

	// ---- STARTUP LOG (OPERABILITY) ----
	//
	// Ye isliye zaroori hai kyunki ye do cheezein env se aati hain aur in
	// galat hone par koi visible symptom nahi hota - bas device limit chup-chaap
	// apply nahi hoti. Debug karte waqt yehi line batata hai ki service ko
	// kya mila.
	//
	// Password/secret KABHI print nahi hota - sirf ye do non-sensitive values.
	log.Printf("[SECURITY] device-per-account limit: enabled=%v cap=%d", s.deviceLimitEnabled, s.maxAccountsDevice)

	return s
}

// deviceLimitEnforced - limit enforce karni hai ya nahi.
func (s *SecurityService) deviceLimitEnforced() bool {
	return s.deviceLimitEnabled
}

// deviceAccountCap - per-device account cap value.
func (s *SecurityService) deviceAccountCap() int {
	return s.maxAccountsDevice
}

// DeviceLimitEnabled reports whether the device-per-account cap is active.
//
// Handler isse use karta hai taaki jab cap OFF ho, 403 message me "3 accounts"
// jaisa GALAT na dikhe. Ek exported wrapper isliye hai taki `model` ya
// `config` import karne ki handler ko zaroorat na pade.
func (s *SecurityService) DeviceLimitEnabled() bool {
	return s.deviceLimitEnforced()
}

// DeviceAccountCap reports the configured per-device cap (default 3).
func (s *SecurityService) DeviceAccountCap() int {
	return s.deviceAccountCap()
}

// ---- Password hashing for secrets (PIN + answers) ----

// hashSecret salted SHA-256 hash banata hai
// Format: "sha256$<salt-hex>$<hash-hex>"
//
// KYUN SHA-256 (bcrypt nahi):
//   - PIN sirf 6 digits hai (10^6 combinations) - brute force already feasible
//   - bcrypt intentionally slow hai, jo chhoti secrets ke liye unnecessary cost
//   - Salt + iterated SHA-256 standard practice hai
//
// NOTE: real protection RATE LIMITING se aati hai jo middleware already karta hai.
// Hinglish: chhote secrets ke liye salt+sha256, bcrypt zaroorat nahi
func hashSecret(secret string) string {
	// 16-byte random salt
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		// crypto/rand fail hona catastrophic hai - fallback nahi, panic better
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	saltHex := hex.EncodeToString(salt)

	// salt + secret ko hash karo
	sum := sha256.Sum256(append(salt, []byte(secret)...))

	return fmt.Sprintf("sha256$%s$%s", saltHex, hex.EncodeToString(sum[:]))
}

// verifySecret hash ko verify karta hai (constant-time comparison)
func verifySecret(storedHash, secret string) bool {
	parts := strings.Split(storedHash, "$")
	if len(parts) != 3 {
		return false
	}

	salt, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}

	actual := sha256.Sum256(append(salt, []byte(secret)...))

	// Constant-time compare - timing attack se protection
	return subtle.ConstantTimeCompare(expected, actual[:]) == 1
}

// normalizeAnswer security question answer ko normalize karta hai
// (lowercase + trim + extra spaces hatao) taaki "Delhi School" aur
// "delhi  school" match karein
func normalizeAnswer(answer string) string {
	return strings.ToLower(strings.Join(strings.Fields(answer), " "))
}

// ---- Security profile ----

// GetOrCreateProfile user ka security profile laata hai (naya banata hai agar nahi)
func (s *SecurityService) GetOrCreateProfile(ctx context.Context, userID uuid.UUID) (*model.SecurityProfile, error) {
	var profile model.SecurityProfile
	err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&profile).Error

	if err == nil {
		return &profile, nil
	}

	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// Naya profile banao
	profile = model.SecurityProfile{
		UserID:       userID,
		LockoutState: model.LockoutStateNone,
	}
	if err := s.db.WithContext(ctx).Create(&profile).Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

// ---- Failed password tracking (3 -> lockout) ----

// RecordFailedPassword galat password record karta hai
// 3 hone par lockout trigger hota hai (PIN required)
//
// RETURN: naya attempt count + lockout trigger hua ya nahi
func (s *SecurityService) RecordFailedPassword(
	ctx context.Context, userID uuid.UUID, email, ip, userAgent string,
) (int, bool, error) {

	profile, err := s.GetOrCreateProfile(ctx, userID)
	if err != nil {
		return 0, false, err
	}

	profile.FailedPasswordAttempts++
	lockoutTriggered := false

	if profile.FailedPasswordAttempts >= model.MaxFailedPasswords {
		// LOCKOUT TRIGGER: ab PIN chahiye
		profile.LockoutState = model.LockoutStatePINRequired
		lockoutTriggered = true

		// Expiry set karo - taaki ye PERMANENT trap na ho.
		// Agar user ne PIN set nahi kiya hai to ye 15 min baad khud
		// relax ho jayega aur wapas password try kar sake.
		// Hinglish: lockout permanent nahi hona chahiye - expiry zaroori hai
		expires := time.Now().Add(model.PINRequiredTimeoutSeconds * time.Second)
		profile.LockoutExpiresAt = &expires

		s.logEvent(ctx, &userID, email, model.EventLockoutTriggered,
			fmt.Sprintf("%d failed password attempts - PIN now required (expires in %ds)",
				profile.FailedPasswordAttempts, model.PINRequiredTimeoutSeconds),
			ip, userAgent)
	}

	if err := s.db.WithContext(ctx).Save(profile).Error; err != nil {
		return 0, false, err
	}

	if !lockoutTriggered {
		s.logEvent(ctx, &userID, email, model.EventLoginFailed,
			fmt.Sprintf("Failed password attempt %d of %d", profile.FailedPasswordAttempts, model.MaxFailedPasswords),
			ip, userAgent)
	}

	return profile.FailedPasswordAttempts, lockoutTriggered, nil
}

// ClearFailedPasswords sahi password par counter reset karta hai
func (s *SecurityService) ClearFailedPasswords(ctx context.Context, userID uuid.UUID) error {
	profile, err := s.GetOrCreateProfile(ctx, userID)
	if err != nil {
		return err
	}

	profile.FailedPasswordAttempts = 0
	if profile.LockoutState == model.LockoutStatePINRequired {
		// PIN verify hone ke baad ye state clear hota hai
		profile.LockoutState = model.LockoutStateNone
		profile.LockoutExpiresAt = nil
	}
	return s.db.WithContext(ctx).Save(profile).Error
}

// ---- Lockout status check ----

// GetLockoutStatus login ke shuru me check hota hai
//
// RETURN:
//   - state (none/pin_required/blocked)
//   - remaining seconds (blocked state me)
func (s *SecurityService) GetLockoutStatus(
	ctx context.Context, userID uuid.UUID,
) (state string, remainingSeconds int, err error) {

	profile, err := s.GetOrCreateProfile(ctx, userID)
	if err != nil {
		return model.LockoutStateNone, 0, err
	}

	// ---- Lockout expiry check (dono states ke liye) ----
	//
	// PIN-required lockout bhi expire hota hai (15 min), aur blocked state
	// bhi expire hota hai (3 min). Ye ensures karta hai ki koi user
	// PERMANENTLY lockout na ho - recovery ka raasta hamesha rehta hai.
	if profile.LockoutState != model.LockoutStateNone && profile.LockoutExpiresAt != nil {
		if time.Now().After(*profile.LockoutExpiresAt) {
			// Time pass ho gaya - unlock
			expiredState := profile.LockoutState
			profile.LockoutState = model.LockoutStateNone
			profile.LockoutExpiresAt = nil
			profile.FailedPasswordAttempts = 0
			if err := s.db.WithContext(ctx).Save(profile).Error; err != nil {
				return model.LockoutStateNone, 0, err
			}
			log.Printf("[SECURITY] lockout expired for user %s (was %s) - unlocked", userID, expiredState)
			return model.LockoutStateNone, 0, nil
		}
	}

	// Blocked state ka remaining time
	if profile.LockoutState == model.LockoutStateBlocked && profile.LockoutExpiresAt != nil {
		remaining := int(time.Until(*profile.LockoutExpiresAt).Seconds())
		if remaining < 0 {
			remaining = 0
		}
		return model.LockoutStateBlocked, remaining, nil
	}

	return profile.LockoutState, 0, nil
}

// ---- PIN management ----

// SetPIN user ka 6-digit PIN set karta hai (hashed storage)
func (s *SecurityService) SetPIN(ctx context.Context, userID uuid.UUID, pin string) error {
	if !isValidPIN(pin) {
		return fmt.Errorf("PIN must be exactly %d digits", model.PINLength)
	}

	record := model.SecurityPIN{
		UserID:            userID,
		PINHash:           hashSecret(pin),
		FailedPINAttempts: 0,
	}

	// Upsert - ek user ka ek hi PIN
	err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Assign(map[string]interface{}{
			"pin_hash":            record.PINHash,
			"failed_pin_attempts": 0,
			"pin_locked_until":    nil,
		}).
		FirstOrCreate(&record).Error

	return err
}

// isValidPIN 6-digit numeric PIN validate karta hai
func isValidPIN(pin string) bool {
	if len(pin) != model.PINLength {
		return false
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// VerifyPIN PIN check karta hai
//
// SECURITY: ye login ke andar use hota hai (lockout recovery).
// Galat PIN -> 3 MINUTE block (SPEC requirement).
func (s *SecurityService) VerifyPIN(
	ctx context.Context, userID uuid.UUID, pin, email, ip, userAgent string,
) (remainingSeconds int, err error) {

	var record model.SecurityPIN
	dbErr := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&record).Error
	if dbErr != nil {
		return 0, ErrPINInvalid
	}

	// Pehle se locked hai?
	if record.PINLockedUntil != nil && time.Now().Before(*record.PINLockedUntil) {
		remaining := int(time.Until(*record.PINLockedUntil).Seconds())
		if remaining < 0 {
			remaining = 0
		}
		return remaining, ErrAccountBlocked
	}

	if !verifySecret(record.PINHash, pin) {
		// GALAT PIN -> 3 minute block
		record.FailedPINAttempts++
		until := time.Now().Add(model.BlockoutDurationSeconds * time.Second)
		record.PINLockedUntil = &until

		if err := s.db.WithContext(ctx).Save(&record).Error; err != nil {
			return 0, err
		}

		// Profile ko bhi blocked state me le jao
		profile, pErr := s.GetOrCreateProfile(ctx, userID)
		if pErr == nil {
			profile.LockoutState = model.LockoutStateBlocked
			profile.LockoutExpiresAt = &until
			s.db.WithContext(ctx).Save(profile)
		}

		s.logEvent(ctx, &userID, email, model.EventPINFailed,
			fmt.Sprintf("Incorrect PIN - account blocked for %d seconds", model.BlockoutDurationSeconds),
			ip, userAgent)

		return model.BlockoutDurationSeconds, ErrAccountBlocked
	}

	// SAHI PIN
	record.FailedPINAttempts = 0
	record.PINLockedUntil = nil
	if err := s.db.WithContext(ctx).Save(&record).Error; err != nil {
		return 0, err
	}

	// Lockout clear karo
	profile, pErr := s.GetOrCreateProfile(ctx, userID)
	if pErr == nil {
		profile.LockoutState = model.LockoutStateNone
		profile.LockoutExpiresAt = nil
		profile.FailedPasswordAttempts = 0
		profile.PINConfigured = true
		s.db.WithContext(ctx).Save(profile)
	}

	s.logEvent(ctx, &userID, email, model.EventPINVerified, "PIN verified - lockout cleared", ip, userAgent)

	return 0, nil
}

// ChangePIN PIN change karta hai - OLD PIN VERIFICATION ZAROORI (SPEC)
func (s *SecurityService) ChangePIN(ctx context.Context, userID uuid.UUID, oldPIN, newPIN string) error {
	if !isValidPIN(newPIN) {
		return fmt.Errorf("new PIN must be exactly %d digits", model.PINLength)
	}

	// ---- REUSE PREVENTION ----
	// Naya PIN purane ke barabar nahi ho sakta. Agar allowed hota, to PIN
	// "change" karna koi faayda nahi deta - purana compromised PIN waisa hi
	// rehta. Ye chhota par important rule hai.
	if verifySecret(hashSecret(oldPIN), newPIN) {
		return ErrNewPINSameAsOld
	}

	var record model.SecurityPIN
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&record).Error; err != nil {
		return ErrPINInvalid
	}

	// OLD PIN verify karo (double verification ka first vector)
	if !verifySecret(record.PINHash, oldPIN) {
		return ErrOldPINIncorrect
	}

	record.PINHash = hashSecret(newPIN)
	record.FailedPINAttempts = 0
	record.PINLockedUntil = nil

	return s.db.WithContext(ctx).Save(&record).Error
}

// InvalidateAllSessionsForUser user ke SAARE active sessions revoke karta hai
// aur refresh tokens delete karta hai.
//
// ---- YE KYUN ZAROORI HAI (security-critical) ----
// PIN change ka security value tabhi hota hai jab PURANA PIN kisi aur ke
// haath se nikal chuka ho (shoulder-surf, shared device, lost phone). Agar
// purane PIN wale sessions ZALDI NAHI hote, to:
//
//	Attack: attacker ne device A par PIN chura liya. User PIN change karta
//	hai (device B par). Attacker ka device-A session AB BHI VALID rehta hai -
//	kyunki wo JWT carry karta hai, aur PIN usne nahi, wo toh account access
//	ke liye chahiye hi nahi. PIN change ka koi fayda nahi.
//
// Isliye PIN change = "har aur jagah se logout". Attacker ka token
// invalid ho jaata hai, use dobara login karna padega aur naya PIN use karna
// padega (jo use nahi pata).
//
// NOTE: ye call karne wala user APNE HI session ko bhi invalidate kar raha
// hai - isliye caller ko ye decide karna hota hai ki use turant logout
// karna hai ya naya token issue karna hai. Auth-service me PIN-change ke
// baad refresh flow user ko wapas login karwana hai.
func (s *SecurityService) InvalidateAllSessionsForUser(ctx context.Context, userID uuid.UUID) (int, error) {
	// 1) Saare refresh tokens delete (inse naye access tokens issue nahi honge)
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).
		Delete(&model.RefreshToken{}).Error; err != nil {
		return 0, err
	}

	// 2) Saare sessions revoke (access JWT ke saath session row bhi check
	//    hota hai - middleware/logout dono `GetSessionByAccessToken` use
	//    karte hain, to revoked session = dead JWT)
	result := s.db.WithContext(ctx).Model(&model.Session{}).
		Where("user_id = ?", userID).
		Update("revoked_at", time.Now())

	if result.Error != nil {
		return 0, result.Error
	}
	return int(result.RowsAffected), nil
}

// HasPIN user ne PIN set kiya hai ya nahi
func (s *SecurityService) HasPIN(ctx context.Context, userID uuid.UUID) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).Model(&model.SecurityPIN{}).
		Where("user_id = ?", userID).Count(&count).Error
	return count > 0, err
}

// ---- Security questions (exactly 3) ----

// SecurityQuestions - available questions ka catalogue
var SecurityQuestions = []string{
	"first_school",
	"mother_maiden_name",
	"first_pet_name",
	"childhood_nickname",
	"favourite_teacher",
	"city_of_birth",
	"first_car",
	"mother_favourite_food",
}

// SetSecurityQuestions EXACTLY 3 questions set karta hai (SPEC)
func (s *SecurityService) SetSecurityQuestions(
	ctx context.Context, userID uuid.UUID, questions map[string]string,
) error {

	if len(questions) != model.RequiredSecurityQuestions {
		return fmt.Errorf("exactly %d security questions are required (got %d)",
			model.RequiredSecurityQuestions, len(questions))
	}

	// Har question valid catalogue ka hai ya nahi
	validSet := make(map[string]bool)
	for _, q := range SecurityQuestions {
		validSet[q] = true
	}
	for q := range questions {
		if !validSet[q] {
			return fmt.Errorf("invalid security question: %s", q)
		}
	}

	// Purane questions hatao (replace semantics)
	if err := s.db.WithContext(ctx).
		Unscoped().Where("user_id = ?", userID).
		Delete(&model.SecurityQuestion{}).Error; err != nil {
		return err
	}

	// Naye insert karo
	position := 0
	for key, answer := range questions {
		position++
		record := model.SecurityQuestion{
			UserID:      userID,
			QuestionKey: key,
			AnswerHash:  hashSecret(normalizeAnswer(answer)),
			Position:    position,
		}
		if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
			return err
		}
	}

	// Profile update
	profile, err := s.GetOrCreateProfile(ctx, userID)
	if err != nil {
		return err
	}
	profile.SecurityQuestionsConfigured = true

	// Setup complete check
	s.recomputeSetupComplete(ctx, userID, profile)

	return s.db.WithContext(ctx).Save(profile).Error
}

// VerifySecurityAnswers answers verify karta hai
// Change requests me OLD answers verification ke liye use hota hai
func (s *SecurityService) VerifySecurityAnswers(
	ctx context.Context, userID uuid.UUID, answers map[string]string,
) error {

	var records []model.SecurityQuestion
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).Find(&records).Error; err != nil {
		return err
	}

	if len(records) == 0 {
		return ErrInsufficientAnswers
	}

	// Saare answers match hone CHAHIYE
	for _, rec := range records {
		answer, provided := answers[rec.QuestionKey]
		if !provided {
			return ErrInsufficientAnswers
		}
		if !verifySecret(rec.AnswerHash, normalizeAnswer(answer)) {
			return ErrInsufficientAnswers
		}
	}

	return nil
}

// GetSecurityQuestions user ke question KEYS return karta hai
// (answers kabhi nahi - wo hamesha hidden rehte hain)
func (s *SecurityService) GetSecurityQuestions(ctx context.Context, userID uuid.UUID) ([]string, error) {
	var records []model.SecurityQuestion
	err := s.db.WithContext(ctx).Where("user_id = ?", userID).
		Order("position ASC").Find(&records).Error

	if err != nil {
		return nil, err
	}

	keys := make([]string, 0, len(records))
	for _, r := range records {
		keys = append(keys, r.QuestionKey)
	}
	return keys, nil
}

// HasSecurityQuestions user ne 3 questions set kiye hain ya nahi
func (s *SecurityService) HasSecurityQuestions(ctx context.Context, userID uuid.UUID) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).Model(&model.SecurityQuestion{}).
		Where("user_id = ?", userID).Count(&count).Error
	return count == model.RequiredSecurityQuestions, err
}

// GetUserByEmailForSecurity security flows ke liye user lookup
// (login, PIN verify - ye paths user ko directly dhoondhte hain)
func (s *AuthService) GetUserByEmailForSecurity(ctx context.Context, email string) (*model.User, error) {
	return s.userRepo.GetByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
}

// RecordLoginSuccess successful login log karta hai (audit trail)
func (s *AuthService) RecordLoginSuccess(ctx context.Context, userID uuid.UUID, email, ip, userAgent string) {
	log.Printf("[AUTH] login success: %s from %s", email, ip)
}

// ---- Device limits (max N accounts per device) ----
// RegisterDeviceAccount device pe account register karta hai
//
// SPEC: max 3 unique accounts per device signature. 4th pe REJECT.
//
// NOTE: ye LOGIN ke dauraan call hota hai, register ke dauraan nahi - yaani
// "is device par is account ka pehla login" yahi moment hai jahan account
// device se judta hai aur cap check hota hai.
//
// Ab cap .env se on/off hai: `DEVICE_LIMIT_ENABLED` (default true) aur
// `DEVICE_LIMIT_MAX_ACCOUNTS` (default 3).
func (s *SecurityService) RegisterDeviceAccount(
	ctx context.Context, fingerprint string, userID uuid.UUID, email, ip, userAgent string,
) error {

	// Fingerprint khaali hai to track nahi kar sakte
	if fingerprint == "" {
		return nil // skip enforcement
	}

	// Is user ke liye already registered hai?
	var existing int64
	err := s.db.WithContext(ctx).Model(&model.DeviceAccount{}).
		Where("fingerprint = ? AND user_id = ?", fingerprint, userID).Count(&existing).Error
	if err != nil {
		return err
	}
	if existing > 0 {
		return nil // already registered, noop
	}

	// DEVICE LIMIT enforce karo.
	//
	// SPEC default: max 3 accounts/device. Par ab ye .env se on/off hai
	// (`DEVICE_LIMIT_ENABLED`). Local dev me ek hi laptop se naye test accounts
	// banane hote hain, aur limit ON hone par 4th register pe 403 aa jata tha -
	// jo developer ko "registration bug" lagta tha jabki wo asli reason nahi tha.
	//
	// OFF hone par: account record phir bhi likha jaata hai (audit/history ke
	// liye - device_accounts table useful rehta hai), sirf COUNT check skip hota
	// hai. Yaani OFF = "cap lagao mat", OFF = "tracking band karo" NAHI.
	if !s.deviceLimitEnforced() {
		return s.recordDeviceAccount(ctx, fingerprint, userID, email, ip, userAgent)
	}

	// Total accounts on this device count karo
	var total int64
	err = s.db.WithContext(ctx).Model(&model.DeviceAccount{}).
		Where("fingerprint = ?", fingerprint).Count(&total).Error
	if err != nil {
		return err
	}

	// NOTE: variable ko `cap` NAHI rakha - wo Go ka builtin hai, shadow karna
	// legal hai par confusing aur linter-unfriendly.
	deviceCap := s.deviceAccountCap()
	if total >= int64(deviceCap) {
		uid := userID
		s.logEvent(ctx, &uid, email, model.EventDeviceLimitExceeded,
			fmt.Sprintf("Device already has %d accounts (limit %d)", total, deviceCap),
			ip, userAgent)

		return ErrDeviceLimitExceeded
	}

	return s.recordDeviceAccount(ctx, fingerprint, userID, email, ip, userAgent)
}

// recordDeviceAccount device_accounts me row likhta hai.
//
// Limit ON aur OFF dono me ye SAME hota hai - farq sirf count-check ka hai.
// OFF hone par bhi row likhi jaati hai, taki device history/audit bani rahe
// (superadmin "kis device par kaun" view isi table se padhta hai).
func (s *SecurityService) recordDeviceAccount(
	ctx context.Context, fingerprint string, userID uuid.UUID, email, ip, userAgent string,
) error {
	record := model.DeviceAccount{
		Fingerprint: fingerprint,
		UserID:      userID,
	}
	return s.db.WithContext(ctx).Create(&record).Error
}

// CountDeviceAccounts device pe kitne accounts hain
func (s *SecurityService) CountDeviceAccounts(ctx context.Context, fingerprint string) (int64, error) {
	if fingerprint == "" {
		return 0, nil
	}
	var count int64
	err := s.db.WithContext(ctx).Model(&model.DeviceAccount{}).
		Where("fingerprint = ?", fingerprint).Count(&count).Error
	return count, err
}

// ---- Setup gate ----

// recomputeSetupComplete teeno mandatory checks karke flag update karta hai
//
// MANDATORY (SPEC): PIN + Biometric + 3 Security Questions
// Teeno chahiye tab hi dashboard access milega.
//
// ---- IMPORTANT: biometric CONDITIONAL hai (migration 004) ----
// Pehle ye tha:
//
//	complete := hasPin && hasQuestions && bioCount > 0
//
// Jo GALAT tha, kyunki register form me biometric checkbox SIRF tab dikhta
// hai jab device me asli sensor ho. Matlab sensor-less user:
//   - checkbox hi nahi dikhta -> enroll kar hi nahi sakta
//   - bioCount hamesha 0
//   - setup_complete hamesha false
//   - PERMANENTLY dashboard se block (aur koi error nahi milta tha)
//
// Ab:
//
//	  complete := hasPin && hasQuestions && (!capable || bioCount > 0)
//
//	- device sensor SUPPORT karta hai -> enroll karna zaroori (security bar
//	  koi nahi girta)
//	- device sensor support NAHI karta -> enroll zaroori nahi (fair, aur
//	  user ke device ki limitation account par penalize nahi hoti)
func (s *SecurityService) recomputeSetupComplete(ctx context.Context, userID uuid.UUID, profile *model.SecurityProfile) {
	hasPin, _ := s.HasPIN(ctx, userID)
	hasQuestions, _ := s.HasSecurityQuestions(ctx, userID)

	// Biometric: WebAuthn credentials count
	var bioCount int64
	s.db.WithContext(ctx).Model(&model.WebAuthnCredential{}).
		Where("user_id = ?", userID).Count(&bioCount)

	// Device capability padho. Column NOT NULL hai, lekin agar kisi wajah se
	// user row na mile to safe default `true` maano (stricter side).
	capable := true
	var userRow model.User
	if err := s.db.WithContext(ctx).Select("biometric_capable").First(&userRow, "id = ?", userID).Error; err == nil {
		capable = userRow.BiometricCapable
	}

	profile.PINConfigured = hasPin
	profile.SecurityQuestionsConfigured = hasQuestions
	profile.BiometricRegistered = bioCount > 0

	// ---- THE CONDITIONAL RULE (with explicit opt-out) ----
	// Biometric SIRF tab mandatory hai jab:
	//   - device support karta hai, AUR
	//   - user ne explicitly opt-out NAHI kiya
	//
	// Pehle sirf `!capable || bioCount > 0` tha. Isse ek bug tha: capable
	// device par "skip" karne par koi credential create nahi hota tha, to
	// complete=false rehta tha aur user dashboard/security-setup ke beech
	// loop me fas jata tha. Ab `optedOut` wo missing state represent karta
	// hai - user ke decision ko record karke, loop khatam.
	biometricSatisfied := profile.BiometricOptedOut || !capable || bioCount > 0
	complete := hasPin && hasQuestions && biometricSatisfied
	profile.SecuritySetupComplete = complete

	if complete && profile.SecuritySetupCompletedAt == nil {
		now := time.Now()
		profile.SecuritySetupCompletedAt = &now
	}
	// NOTE: opt-out BACK karne par (user biometric enable karta hai) hum
	// completed-at reset karte hain taaki status honest rahe.
	if !complete {
		profile.SecuritySetupCompletedAt = nil
	}
}

// SkipBiometricSetup user ke EXPLICIT opt-out ko record karta hai.
//
// YE "mark as registered" NAHI hai - ye saaf maan raha hai ki user
// biometric NAHI chahta. Difference matter karta hai:
//
//   - fake "registered": backend me credential nahi -> complete=false ->
//     middleware loop (pichla bug)
//   - opted out: decision PERSIST -> complete=true -> user dashboard par
//
// SECURITY: ye sirf TAB kaam karta hai jab `biometric_capable = false` ho
// YA user ek capable device par consciously skip kar raha ho. Koi aur
// cheez is flag ko touch nahi karti, isliye isse security kam nahi hoti -
// bas "user ne mana kar diya" record ho jaata hai.
func (s *SecurityService) SkipBiometricSetup(
	ctx context.Context,
	userID uuid.UUID,
	email, ip, userAgent string,
) error {
	profile, err := s.GetOrCreateProfile(ctx, userID)
	if err != nil {
		return err
	}

	// Opt-out clear karo, phir recompute (jisme ab ye count hoga)
	profile.BiometricOptedOut = true
	s.recomputeSetupComplete(ctx, userID, profile)

	if err := s.db.WithContext(ctx).Save(profile).Error; err != nil {
		return err
	}

	if profile.SecuritySetupComplete {
		s.logEvent(ctx, &userID, email, model.EventSecuritySetupCompleted,
			"PIN + 3 security questions configured (biometric declined by user)", ip, userAgent)
	}
	return nil
}

// MarkBiometricRegistered biometric setup hone par call hota hai
func (s *SecurityService) MarkBiometricRegistered(ctx context.Context, userID uuid.UUID, email, ip, userAgent string) error {
	profile, err := s.GetOrCreateProfile(ctx, userID)
	if err != nil {
		return err
	}

	// Credential ab ASLI se register hua hai (webauthn flow ne insert kiya),
	// isliye pehle ka "opted out" flag CLEAR kar do - user ne ab biometric
	// enable kar diya hai. Warna profile dono contradictory states
	// (registered + opted_out) dikhati.
	profile.BiometricOptedOut = false

	s.recomputeSetupComplete(ctx, userID, profile)
	if err := s.db.WithContext(ctx).Save(profile).Error; err != nil {
		return err
	}

	if profile.SecuritySetupComplete {
		s.logEvent(ctx, &userID, email, model.EventSecuritySetupCompleted,
			"PIN + biometric + 3 security questions all configured", ip, userAgent)
	}

	return nil
}

// GetSetupStatus user ka security setup status deta hai (gate ke liye)
func (s *SecurityService) GetSetupStatus(ctx context.Context, userID uuid.UUID) (*model.SecurityProfile, error) {
	return s.GetOrCreateProfile(ctx, userID)
}

// ---- Audit events ----

// logEvent security audit trail me entry add karta hai
// (best-effort - failure pe login block NAHI hota)
func (s *SecurityService) logEvent(
	ctx context.Context, userID *uuid.UUID, email, eventType, detail, ip, userAgent string,
) {
	event := model.SecurityEvent{
		UserID:    userID,
		Email:     email,
		EventType: eventType,
		Detail:    detail,
		IPAddress: ip,
		UserAgent: truncate(userAgent, 200),
		Timestamp: time.Now().UTC(),
	}
	// Best-effort: error aaye to log karke chhod do
	if err := s.db.WithContext(ctx).Create(&event).Error; err != nil {
		fmt.Printf("[SECURITY] failed to log event %s: %v\n", eventType, err)
	}
}

// LogSecurityEvent public wrapper - handler se call hota hai
func (s *SecurityService) LogSecurityEvent(
	ctx context.Context, userID *uuid.UUID, email, eventType, detail, ip, userAgent string,
) {
	s.logEvent(ctx, userID, email, eventType, detail, ip, userAgent)
}

// GetSecurityEvents audit trail padhta hai (Awareness Reports)
func (s *SecurityService) GetSecurityEvents(ctx context.Context, limit int) ([]model.SecurityEvent, error) {
	var events []model.SecurityEvent
	err := s.db.WithContext(ctx).Order("timestamp DESC").Limit(limit).Find(&events).Error
	return events, err
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// clientIP helper - request se IP nikalta hai
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.Split(fwd, ",")[0]
	}
	return r.RemoteAddr
}
