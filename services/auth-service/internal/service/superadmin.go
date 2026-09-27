// Superadmin service - recovery accounts, device lock, session tracking
//
// Hinglish comments: har block ka arth
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/password"
)

// Superadmin errors
var (
	ErrDeviceLocked       = errors.New("this account is locked to another device")
	ErrNotSuperadmin      = errors.New("superadmin role required")
	ErrRecoveryCodeInvalid = errors.New("invalid recovery code")
	ErrAccountDeactivated = errors.New("this account has been deactivated")
)

// SuperadminService superadmin/recovery accounts aur sessions manage karta hai
type SuperadminService struct {
	db *gorm.DB
}

// NewSuperadminService naya service banata hai
func NewSuperadminService(db *gorm.DB) *SuperadminService {
	return &SuperadminService{db: db}
}

// ---------------------------------------------------------------------------
// Recovery accounts (Q4.3)
// ---------------------------------------------------------------------------

// EnsureRecoveryAccounts 2 recovery accounts ensure karta hai
//
// KYUN: Agar MAIN superadmin ke sath kuch ho jaye - account lock ho jaye,
// credential leak ho jaye, ya device kho jaye - to SIRF usi se recover
// karna possible hota hai. 2 SIDE accounts se independent access milta hai.
//
// SECURITY:
//   - Recovery accounts se main superadmin NAHI ban sakte (wo alag email hain)
//   - Har recovery account ka apna password hash hai
//   - Device lock optional hai (SSOT se control)
//
// ENV (SSOT): isliye passwords .env se aati hain, code me hardcoded nahi
//
// Hinglish: 2 side accounts banate hain taaki main superadmin ke fail
// hone par bhi access mil sake
func (s *SuperadminService) EnsureRecoveryAccounts(ctx context.Context) error {

	passwords := []string{
		os.Getenv("SUPERADMIN_RECOVERY_1_PASSWORD"),
		os.Getenv("SUPERADMIN_RECOVERY_2_PASSWORD"),
	}
	emails := []string{
		os.Getenv("SUPERADMIN_RECOVERY_1_EMAIL"),
		os.Getenv("SUPERADMIN_RECOVERY_2_EMAIL"),
	}

	for i := 0; i < model.RecoveryAccountCount; i++ {
		// Agar env me is recovery account ka password set nahi hai to skip karo
		// (user ne abhi configure nahi kiya hoga)
		if emails[i] == "" || passwords[i] == "" {
			continue
		}

		// Password hash karo (bcrypt cost 12 - same as superadmin)
		hash, err := hashRecoveryPassword(passwords[i])
		if err != nil {
			return fmt.Errorf("failed to hash recovery password %d: %w", i+1, err)
		}

		// User banao ya dhoondho
		var user model.User
		err = s.db.WithContext(ctx).
			Where("email = ?", emails[i]).First(&user).Error

		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Naya user
			user = model.User{
				ID:           uuid.New(),
				Email:        emails[i],
				PasswordHash: hash,
				FullName:     fmt.Sprintf("Superadmin Recovery %d", i+1),
				IsActive:     true,
				IsVerified:   true, // recovery accounts email verify nahi karti
			}
			if err := s.db.WithContext(ctx).Create(&user).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}

		// Recovery code generate karo (one-time use ke liye)
		code := GenerateRecoveryCode()

		// SuperadminAccount record
		record := model.SuperadminAccount{
			UserID:           user.ID,
			Email:            emails[i],
			Role:             model.RoleSuperadminRecovery,
			Slot:             i + 1,
			RecoveryCodeHash: HashRecoveryCode(code),
			IsActive:         true,
			Notes:            fmt.Sprintf("Recovery slot %d (auto-created)", i+1),
		}

		// Upsert by email
		existing := model.SuperadminAccount{}
		findErr := s.db.WithContext(ctx).
			Where("email = ?", emails[i]).First(&existing).Error

		if findErr == nil {
			record.ID = existing.ID
			record.CreatedAt = existing.CreatedAt
			if err := s.db.WithContext(ctx).Save(&record).Error; err != nil {
				return err
			}
		} else {
			if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
				return err
			}
			// Recovery code log karo (sirf first time - taaki admin se save kar sake)
			fmt.Printf("[RECOVERY] === RECOVERY CODE (SAVE THIS) ===\n")
			fmt.Printf("[RECOVERY] Account : %s\n", emails[i])
			fmt.Printf("[RECOVERY] Code     : %s\n", code)
			fmt.Printf("[RECOVERY] ==========================================\n")
		}
	}

	return nil
}

// GenerateRecoveryCode one-time recovery code banata hai
// Format: XXXX-XXXX-XXXX (readable, typeable)
func GenerateRecoveryCode() string {
	raw := make([]byte, 6)
	if _, err := rand.Read(raw); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	hexStr := strings.ToUpper(hex.EncodeToString(raw))
	return fmt.Sprintf("%s-%s-%s", hexStr[0:4], hexStr[4:8], hexStr[8:12])
}

// HashRecoveryCode code ka hash (plaintext store nahi)
func HashRecoveryCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

// hashRecoveryPassword bcrypt cost 12 se hash karta hai.
// Hinglish: recovery account ka password bhi bcrypt cost 12 me hash hota hai
// (main superadmin jaisa hi treatment - koi weak hashing nahi)
//
// NOTE: parameter ka naam "password" NAHI rakha - wo package name ko shadow
// kar deta tha aur "password.NewPasswordService" undefined ho jata tha.
func hashRecoveryPassword(plainPassword string) (string, error) {
	return password.NewPasswordService(12).Hash(plainPassword)
}

// ---------------------------------------------------------------------------
// Device lock (retina lock)
// ---------------------------------------------------------------------------

// SetDeviceLock superadmin account ko ek SPECIFIC device se lock karta hai
//
// Aapne kaha: "superadmin ke liye alag se retina lock bhi bana dena,
// usmein SSOT me yeh setting de dena ki retina jaisi abhi nahi hai to
// baad me agar laptop purchase karte hai aur retina wala lock zaroori
// hai taki koi bhi laptop ko khol na sake"
//
// Flow: device lock ON karte hi CURRENT device fingerprint capture ho jata hai.
// Uske baad ye account SIRF usi device se login kar sakta hai.
func (s *SuperadminService) SetDeviceLock(
	ctx context.Context, email, deviceFingerprint string, enabled bool,
) error {

	if enabled && deviceFingerprint == "" {
		return fmt.Errorf("device fingerprint required to enable device lock")
	}

	updates := map[string]interface{}{
		"device_locked": enabled,
		"is_active":     true,
	}
	if enabled {
		now := time.Now()
		updates["locked_device_id"] = deviceFingerprint
		updates["locked_at"] = &now
	}

	return s.db.WithContext(ctx).Model(&model.SuperadminAccount{}).
		Where("email = ?", email).
		Updates(updates).Error
}

// CheckDeviceLock login ke waqt device verify karta hai
//
// RETURN: agar account device-locked hai aur current device match nahi karti
// to ErrDeviceLocked return hota hai
func (s *SuperadminService) CheckDeviceLock(
	ctx context.Context, email, deviceFingerprint string,
) error {

	var account model.SuperadminAccount
	err := s.db.WithContext(ctx).Where("email = ?", email).First(&account).Error
	if err != nil {
		// Superadmin account nahi hai - koi restriction nahi (normal user)
		return nil
	}

	if !account.IsActive {
		return ErrAccountDeactivated
	}

	// Device lock nahi hai - allow
	if !account.DeviceLocked {
		return nil
	}

	// Device match nahi hui - DENY
	if account.LockedDeviceID != deviceFingerprint {
		return ErrDeviceLocked
	}

	return nil
}

// IsSuperadmin checks karta hai ki ye account superadmin ya recovery hai
func (s *SuperadminService) IsSuperadmin(ctx context.Context, email string) (bool, string, error) {
	var account model.SuperadminAccount
	err := s.db.WithContext(ctx).Where("email = ?", email).First(&account).Error
	if err != nil {
		return false, "", nil // normal user, error nahi
	}
	return true, account.Role, nil
}

// ---------------------------------------------------------------------------
// Session tracking (Q4.2 - "kitne time se online hai")
// ---------------------------------------------------------------------------

// StartSession naya session start karta hai
func (s *SuperadminService) StartSession(
	ctx context.Context, userID uuid.UUID, email, ip, userAgent, deviceID, deviceName, platform string,
) (*model.UserSession, error) {

	session := &model.UserSession{
		UserID:     userID,
		Email:      email,
		StartedAt:  time.Now().UTC(),
		LastSeenAt: time.Now().UTC(),
		IPAddress:  ip,
		UserAgent:  truncateStr(userAgent, 200),
		DeviceID:   deviceID,
		DeviceName: deviceName,
		Platform:   platform,
		IsActive:   true,
	}

	if err := s.db.WithContext(ctx).Create(session).Error; err != nil {
		return nil, err
	}
	return session, nil
}

// EndSession session ko close karta hai
func (s *SuperadminService) EndSession(ctx context.Context, sessionID uuid.UUID) error {
	now := time.Now().UTC()

	var session model.UserSession
	if err := s.db.WithContext(ctx).Where("id = ?", sessionID).First(&session).Error; err != nil {
		return err
	}

	duration := int64(now.Sub(session.StartedAt).Seconds())
	session.EndedAt = &now
	session.LastSeenAt = now
	session.DurationSeconds = duration
	session.IsActive = false

	return s.db.WithContext(ctx).Save(&session).Error
}

// HeartbeatSession last-activity update karta hai
// (idle sessions auto-close ho jaate hain)
func (s *SuperadminService) HeartbeatSession(ctx context.Context, sessionID uuid.UUID) error {
	now := time.Now().UTC()

	// Idle check - 30 min se zyada inactive to session close
	timeout := time.Duration(model.SessionIdleTimeoutMinutes) * time.Minute

	return s.db.WithContext(ctx).Model(&model.UserSession{}).
		Where("id = ? AND is_active = ? AND last_seen_at > ?",
			sessionID, true, now.Add(-timeout)).
		Updates(map[string]interface{}{
			"last_seen_at":     now,
			"duration_seconds": 0, // recalculated on end
		}).Error
}

// GetUserActivity user ka activity summary deta hai
// (awareness page ke liye: kitne time online, kab aaya, kab gaya)
type UserActivity struct {
	Email string `json:"email"`
	// RegisteredAt: user kab bana tha (users.created_at se)
	//
	// NOTE: ye column pehle MISSING tha - awareness page par "Registration Date"
	// dikha hi nahi sakta tha. Ab directly users table se aata hai.
	RegisteredAt *time.Time `json:"registered_at"`
	TotalSessions int64     `json:"total_sessions"`
	TotalSecondsOnline int64 `json:"total_seconds_online"`
	IsOnline           bool  `json:"is_online"`
	DistinctDevices    int64 `json:"distinct_devices"`
	FirstSeen          *time.Time `json:"first_seen"`
	LastSeen           *time.Time `json:"last_seen"`
	// IsSuperadmin/IsRecovery: role flags - superadmin panel filters me use hote hain
	IsSuperadmin bool `json:"is_superadmin"`
	IsRecovery   bool `json:"is_recovery"`
	// IsActive: account active hai ya deactivated
	IsActive bool `json:"is_active"`
}

func (s *SuperadminService) GetUserActivity(ctx context.Context, email string) (*UserActivity, error) {
	activity := &UserActivity{Email: email}

	// ---- Registration date ----
	// NOTE: ye pehle MISSING tha. users.created_at se directly aata hai,
	// isliye awareness page par "Registration Date" column populate hota hai.
	var user struct {
		CreatedAt time.Time
		IsActive  bool
	}
	if err := s.db.WithContext(ctx).Model(&model.User{}).
		Select("created_at, is_active").
		Where("email = ?", email).First(&user).Error; err == nil {
		activity.RegisteredAt = &user.CreatedAt
		activity.IsActive = user.IsActive
	}

	// ---- Superadmin / recovery role flags ----
	// Ye flags "staff vs regular user" ka answer dete hain - jo pehle
	// awareness page par MISSING tha.
	var account model.SuperadminAccount
	if err := s.db.WithContext(ctx).Where("email = ?", email).First(&account).Error; err == nil {
		activity.IsSuperadmin = account.Role == model.RoleSuperadmin
		activity.IsRecovery = account.Role == model.RoleSuperadminRecovery
	}

	type agg struct {
		TotalSessions int64
		TotalSeconds  int64
		MinSessions   *time.Time
		MaxSessions   *time.Time
	}

	var result agg
	err := s.db.WithContext(ctx).Model(&model.UserSession{}).
		Select(`COUNT(*) as total_sessions,
		        COALESCE(SUM(duration_seconds),0) as total_seconds,
		        MIN(started_at) as min_sessions,
		        MAX(started_at) as max_sessions`).
		Where("email = ?", email).
		Scan(&result).Error

	if err != nil {
		return nil, err
	}

	activity.TotalSessions = result.TotalSessions
	activity.TotalSecondsOnline = result.TotalSeconds
	activity.FirstSeen = result.MinSessions
	activity.LastSeen = result.MaxSessions

	// Currently online?
	var activeCount int64
	s.db.WithContext(ctx).Model(&model.UserSession{}).
		Where("email = ? AND is_active = ?", email, true).
		Count(&activeCount)
	activity.IsOnline = activeCount > 0

	// Distinct devices
	var deviceCount int64
	s.db.WithContext(ctx).Model(&model.UserSession{}).
		Where("email = ? AND device_id != ?", email, "").
		Distinct("device_id").
		Count(&deviceCount)
	activity.DistinctDevices = deviceCount

	return activity, nil
}

// ListAllActivity saare users ka activity deta hai (awareness page)
// ListAllActivity SAARE users ka activity deta hai (awareness page ke liye)
//
// IMPORTANT FIX: pehle ye sirf `user_sessions` se email enumerate karta tha.
// Isliye jis user ne abhi tak login NAHI kiya tha, wo LIST ME HI NAHI AATA tha -
// matlab uska registration date bhi invisible rehta tha.
// Ab base `users` table hai, isliye har user dikhta hai aur registration date
// ALWAYS populate hoti hai (session data uske upar layer hota hai).
func (s *SuperadminService) ListAllActivity(ctx context.Context, limit int) ([]UserActivity, error) {
	// ---- Base: saare users (auth DB) ----
	var emails []string
	if err := s.db.WithContext(ctx).Model(&model.User{}).
		Order("created_at DESC").
		Limit(limit).
		Pluck("email", &emails).Error; err != nil {
		return nil, err
	}

	// ---- Extra emails jo sirf sessions me hain (bina user record ke) ----
	var sessionEmails []string
	s.db.WithContext(ctx).Model(&model.UserSession{}).
		Distinct("email").
		Where("email != ?", "").
		Pluck("email", &sessionEmails)

	for _, e := range sessionEmails {
		if e == "" {
			continue
		}
		found := false
		for _, existing := range emails {
			if existing == e {
				found = true
				break
			}
		}
		if !found {
			emails = append(emails, e)
		}
	}

	// ---- Har user ka detailed activity nikalo ----
	results := make([]UserActivity, 0, len(emails))
	for _, email := range emails {
		activity, err := s.GetUserActivity(ctx, email)
		if err != nil {
			// Ek user fail ho to baaki ka data nahi dub jana chahiye
			continue
		}
		results = append(results, *activity)
	}

	return results, nil
}

// ---------------------------------------------------------------------------
// Test account cleanup (Q2.1 - production cutover button)
// ---------------------------------------------------------------------------

// PurgeTestAccounts SAARE testing accounts delete karta hai, sirf superadmin
// bachata hai. Ye PRODUCTION CUTOVER ke liye hai.
//
// SAFETY:
//   - Sirf TestAccountMarker me MARKED accounts delete hote hain
//   - Superadmin/recovery accounts KABHI delete nahi hote
//   - Dry-run mode pehle daala jata hai (deletion ke bina count batata hai)
//
// Hinglish: testing accounts hata do, superadmin bachaye
func (s *SuperadminService) PurgeTestAccounts(ctx context.Context, dryRun bool) (map[string]interface{}, error) {

	// Superadmin emails - ye KABHI delete nahi hone chahiye
	protected := []string{os.Getenv("SUPERADMIN_EMAIL")}
	for i := 1; i <= model.RecoveryAccountCount; i++ {
		if e := os.Getenv(fmt.Sprintf("SUPERADMIN_RECOVERY_%d_EMAIL", i)); e != "" {
			protected = append(protected, e)
		}
	}

	// Marked test accounts dhoondho
	var markers []model.TestAccountMarker
	err := s.db.WithContext(ctx).
		Where("is_purged = ?", false).
		Find(&markers).Error
	if err != nil {
		return nil, err
	}

	deleted := 0
	skippedProtected := 0
	emails := []string{}

	for _, m := range markers {
		// Superadmin protected hai - skip
		isProtected := false
		for _, p := range protected {
			if p != "" && p == m.Email {
				isProtected = true
				break
			}
		}
		if isProtected {
			skippedProtected++
			continue
		}

		emails = append(emails, m.Email)

		if dryRun {
			continue
		}

		// User delete karo (sessions pehle, FK integrity ke liye)
		s.db.WithContext(ctx).Unscoped().
			Where("user_id = ?", m.UserID).
			Delete(&model.UserSession{})

		// User delete
		if err := s.db.WithContext(ctx).Unscoped().
			Where("id = ?", m.UserID).Delete(&model.User{}).Error; err != nil {
			continue
		}

		// Marker update
		s.db.WithContext(ctx).Model(&model.TestAccountMarker{}).
			Where("id = ?", m.ID).
			Updates(map[string]interface{}{
				"is_purged":  true,
				"updated_at": time.Now(),
			})

		deleted++
	}

	return map[string]interface{}{
		"dry_run":           dryRun,
		"marked_test_accounts": len(markers),
		"would_delete":      len(emails),
		"deleted":           deleted,
		"skipped_protected": skippedProtected,
		"emails":            emails,
	}, nil
}

// MarkTestAccount kisi account ko "testing account" mark karta hai
func (s *SuperadminService) MarkTestAccount(
	ctx context.Context, userID uuid.UUID, email, reason string, dummyBalance float64,
) error {
	marker := model.TestAccountMarker{
		UserID:          userID,
		Email:           email,
		MarkedBy:        "superadmin",
		Reason:          reason,
		DummyBalanceINR: dummyBalance,
	}
	return s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Assign(marker).
		FirstOrCreate(&marker).Error
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// GetDeviceLockStatus device lock ka current status deta hai
func (s *SuperadminService) GetDeviceLockStatus(ctx context.Context, email string) (map[string]interface{}, error) {
	var account model.SuperadminAccount
	if err := s.db.WithContext(ctx).Where("email = ?", email).First(&account).Error; err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"email":         account.Email,
		"role":          account.Role,
		"slot":          account.Slot,
		"device_locked": account.DeviceLocked,
		"locked_at":     account.LockedAt,
		"is_active":     account.IsActive,
		"notes":         account.Notes,
	}, nil
}

// ListTestAccounts marked test accounts list karta hai
func (s *SuperadminService) ListTestAccounts(ctx context.Context) ([]model.TestAccountMarker, error) {
	var markers []model.TestAccountMarker
	err := s.db.WithContext(ctx).
		Where("is_purged = ?", false).
		Order("created_at DESC").
		Find(&markers).Error
	return markers, err
}
// GetSecurityEventsFrom security events laata hai (superadmin awareness ke liye).
// NOTE: Ye apne DB se seedha query karta hai - security service se delegate
// karne ki zarurat nahi kyunki dono ka db same hai.
func (s *SuperadminService) GetSecurityEventsFrom(ctx context.Context, limit int) ([]model.SecurityEvent, error) {
	var events []model.SecurityEvent
	err := s.db.WithContext(ctx).
		Order("timestamp DESC").
		Limit(limit).
		Find(&events).Error
	return events, err
}
