// Superadmin bootstrap - master root account seeding
//
// YE CODE JAAN BOOJH KAR design kiya gaya hai:
//
// 1. PASSWORD PLAINTEXT ME STORED NAHI HAI. Sirf BCRYPT HASH hai, cost 12.
//    Isse koi binary `strings` command chala kar password nahi nikal sakta.
//    (Agar plaintext hota, to wo seedha binary me readable hota.)
//
// 2. ENV OVERRIDE KA RAASTA BHI HAI. Agar SECURITY_SUPERADMIN_PASSWORD set ho,
//    to wo use hoga aur hardcoded hash ignore hoga. Isse password rotate
//    karna possible hai bina code change kiye.
//
// 3. VERIFICATION LOG: har startup par ye check karta hai ki database ka
//    stored hash abhi bhi wahi hai ya nahi (kisi ne change kiya ya nahi).
//    Agar mismatch hua to SECURITY VIOLATION log hota hai - ye "staff trap"
//    ka backend half hai.
//
// Hinglish comments: har block ka arth
package bootstrap

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// DefaultSuperadminEmail - master root account ka email
const DefaultSuperadminEmail = "advchashampalup@gmail.com"

// DefaultSuperadminPasswordHash - password ka BCRYPT HASH (cost 12).
//
// YE PLAINTEXT NAHI HAI. Original password ka hash hai, jo:
//   - cost 12 bcrypt se bana hai
//   - database me bhi waise hi store hota hai
//   - binary me sirf hash dikhta hai, password nahi
//
// SECURITY NOTE: ye hash code me hai isliye koi ise brute-force kar sakta
// hai (bcrypt slow hai isliye aasan nahi). Isliye:
//   - SECURITY_SUPERADMIN_PASSWORD env se override kar sakte ho (recommended)
//   - Production me ye hash ROTATE karna chahiye
// Hinglish: password ka hash hai binary me, plain password nahi
const DefaultSuperadminPasswordHash = "$2a$12$dxQxGmx/hnsusyk6jliqLO0xEX9grzBnNdPNn23X6O/Ay36WCDQJ2"

// SuperadminResult - bootstrap ka outcome (reporting ke liye)
type SuperadminResult struct {
	Created  bool
	Email    string
	Verified bool
	Warning  string
}

// EnsureSuperadmin master root account ko DB me ensure karta hai.
//
// Logic:
//   1. Agar SECURITY_SUPERADMIN_PASSWORD env set hai -> uska hash banao
//   2. Nahi to default bcrypt hash use karo
//   3. Agar user exist nahi karta -> create karo (IsActive + IsVerified = true,
//      kyunki superadmin ko email verification nahi karni)
//   4. Agar user exist karta hai -> VERIFY karo ki uska stored hash
//      expected hash se match karta hai ya nahi
//
// Hinglish: superadmin account ka hamesha hona chahiye - create ya verify
func EnsureSuperadmin(ctx context.Context, db *gorm.DB) (*SuperadminResult, error) {
	result := &SuperadminResult{Email: DefaultSuperadminEmail}

	// ---- Password hash decide karo (env override > default) ----
	passwordHash := DefaultSuperadminPasswordHash

	// SECURITY: env override - agar set hai to use karo (rotation ka raasta)
	if envPassword := os.Getenv("SECURITY_SUPERADMIN_PASSWORD"); envPassword != "" {
		// Env wala password bcrypt karo - NOTE: ye log NAHI hona chahiye
		hashed, err := bcrypt.GenerateFromPassword([]byte(envPassword), 12)
		if err != nil {
			return nil, err
		}
		passwordHash = string(hashed)
		result.Warning = "superadmin password came from SECURITY_SUPERADMIN_PASSWORD env override"
		log.Println("[SUPERADMIN] Using env-override password hash (not the built-in default)")
	}

	// ---- User lookup ----
	var existing model.User
	err := db.WithContext(ctx).Where("email = ?", DefaultSuperadminEmail).First(&existing).Error

	if err != nil {
		// User nahi mila (ya error) - create karte hain
		now := time.Now()
		superadmin := &model.User{
			ID:           uuid.New(),
			Email:        DefaultSuperadminEmail,
			PasswordHash: passwordHash,
			FullName:     "Master Root (Superadmin)",
			// Superadmin ko email verify nahi karna - seed hi active hai
			IsActive:   true,
			IsVerified: true,
			CreatedAt:  now,
			UpdatedAt:  now,
		}

		if createErr := db.WithContext(ctx).Create(superadmin).Error; createErr != nil {
			return nil, createErr
		}

		result.Created = true
		result.Verified = true
		log.Printf("[SUPERADMIN] Master root account CREATED: %s", DefaultSuperadminEmail)
		return result, nil
	}

	// ---- User EXISTS: env password APPLY karo (jo pehle nahi hota tha) ----
	//
	// BUG jo is block ki wajah se tha: `passwordHash` upar env se derive
	// hota tha, par EXISTING user ke liye use KABHI DB me nahi likha jaata
	// tha - sirf naya account create karte waqt. Matlab file ke apne comment
	// ka waada ("password rotate karna possible hai bina code change kiye")
	// poore tarah se jhooth tha: env var set karne par bhi account ka
	// password nahi badalta.
	//
	// Isi wajah se setting the env var on this already-seeded account did
	// nothing at all, and the master-root password stayed at the value baked
	// into DefaultSuperadminPasswordHash - which is the whole problem that
	// variable exists to solve.
	//
	// ---- KYUN SIRF TAB APPLY HOTA HAI ----
	//
	// Sirf isliye ki stored hash abhi BHI built-in default ho. Agar kisi ne
	// app se ya DB se password rotate kar diya hai, to env var usse
	// chup-chaap overwrite kar deta - matlab admin apna naya password set
	// karta, restart hota, aur uska change chup-chaap revert ho jata.
	//
	// Ye guard us trap ko band karta hai:
	//
	//   stored == built-in default  -> env password apply karo (chahiye hua)
	//   stored != built-in default  -> chhodo, insaan ne badla hai
	//
	// Hinglish: env password tabhi lagega jab account ka hash abhi bhi wahi
	//            default hai jo code me likha hai.
	if envPassword := os.Getenv("SECURITY_SUPERADMIN_PASSWORD"); envPassword != "" {
		if existing.PasswordHash == DefaultSuperadminPasswordHash {
			if err := db.WithContext(ctx).Model(&model.User{}).
				Where("id = ?", existing.ID).
				Updates(map[string]interface{}{"password_hash": passwordHash}).Error; err != nil {
				return nil, err
			}
			log.Println("[SUPERADMIN] Password rotated to SECURITY_SUPERADMIN_PASSWORD value " +
				"(was still the built-in default)")
			result.Warning = "superadmin password rotated from built-in default to env value"
		} else if existing.PasswordHash != passwordHash {
			log.Println("[SUPERADMIN] SECURITY_SUPERADMIN_PASSWORD is set but the stored " +
				"hash already differs from the built-in default, so it was NOT applied. " +
				"Someone rotated this password deliberately; leaving it alone. Unset the " +
				"env var to silence this, or delete the env value and change it in-app.")
		}
	}

	// ---- User EXISTS: security verification ----
	//
	// KYUN: agar koi staff/manager manually is account ka password ya role
	// change kar deta hai, to humein PATA chalna chahiye. Ye "staff trap"
	// ka backend detection half hai.
	//
	// Hum check karte hain ki stored hash abhi bhi VALID hai ya corrupt/
	// manually changed kiya gaya hai.
	if existing.PasswordHash == "" {
		log.Println("[SECURITY VIOLATION] Superadmin password hash is EMPTY - " +
			"account may have been tampered with!")
		result.Warning = "superadmin password hash is empty (possible tampering)"
		return result, nil
	}

	// Password change detect karo: default hash se match nahi karta + env
	// override bhi set nahi hai => password rotate hua hai (ya tamper)
	if os.Getenv("SECURITY_SUPERADMIN_PASSWORD") == "" {
		if existing.PasswordHash != DefaultSuperadminPasswordHash {
			log.Println("[SECURITY NOTICE] Superadmin password has been CHANGED from the " +
				"built-in default. This may be an authorized rotation or tampering - " +
				"review the superadmin audit log.")
			result.Warning = "superadmin password differs from built-in default (rotated or tampered)"
		}
	}

	// Superadmin ko active + verified ensure karo
	if !existing.IsActive || !existing.IsVerified {
		if err := db.WithContext(ctx).Model(&model.User{}).
			Where("id = ?", existing.ID).
			Updates(map[string]interface{}{
				"is_active":   true,
				"is_verified": true,
			}).Error; err != nil {
			return nil, err
		}
		log.Println("[SUPERADMIN] Re-activated superadmin account (was inactive/unverified)")
	}

	result.Verified = true
	log.Printf("[SUPERADMIN] Master root account verified: %s", DefaultSuperadminEmail)
	return result, nil
}


// RegisterMasterSuperadminRole master root account ko superadmin_accounts me register karta hai.
//
// KYUN ZAROORI:
// EnsureSuperadmin sirf `users` table me row banata hai. Lekin role gate
// (`RequireSuperadminMiddleware`) `superadmin_accounts` table check karta hai.
// Agar master root yahan registered nahi hota, to wo 403 deny ho jata hai
// jabki recovery accounts pass ho jate hain - ye backwards tha.
//
// Idempotent hai - har startup pe safe se chalta hai.
//
// Hinglish: master superadmin ko role table me register karo (warna 403 milta hai)
func RegisterMasterSuperadminRole(ctx context.Context, db *gorm.DB) error {
	// Master superadmin ka user dhoondho
	var user model.User
	if err := db.WithContext(ctx).
		Where("email = ?", DefaultSuperadminEmail).First(&user).Error; err != nil {
		// User hi nahi hai to kuch nahi karna
		return err
	}

	// ---- users.role ENSURE karo ----
	//
	// BUG: ye pehle SIRF `superadmin_accounts` me row banata tha. Par authz
	// `users.role` se chalti hai:
	//
	//   - login JWT ka `role` claim `users.role` se banta hai
	//   - `RequireSuperadmin()` wahi claim padhta hai
	//
	// Matlab master root login karta to uska token `role: "user"` carry karta,
	// aur har superadmin endpoint 403 deta. `superadmin_accounts` row hone se
	// kuch nahi hota - wo table sirf provisioning/recovery track karti hai.
	//
	// Isi liye log "Master root registered with superadmin role" bolta tha jab
	// actual role `user` hi rehta tha - log jhooth bolta tha.
	//
	// Ye update har startup par chalta hai, aur idempotent hai: agar role pehle
	// se `superadmin` hai to koi write nahi hota.
	if user.Role != model.RoleSuperadmin {
		if err := db.WithContext(ctx).Model(&model.User{}).
			Where("id = ?", user.ID).
			Updates(map[string]interface{}{"role": model.RoleSuperadmin}).Error; err != nil {
			return err
		}
		log.Printf("[SUPERADMIN] users.role corrected to %q for %s "+
			"(the superadmin_accounts row alone does NOT grant access - the JWT "+
			"role claim comes from users.role)", model.RoleSuperadmin, DefaultSuperadminEmail)
	}

	// Already registered hai to no-op
	var existing model.SuperadminAccount
	err := db.WithContext(ctx).
		Where("email = ?", DefaultSuperadminEmail).First(&existing).Error

	if err == nil {
		// Exists - sirf active flag ensure karo
		return db.WithContext(ctx).Model(&model.SuperadminAccount{}).
			Where("email = ?", DefaultSuperadminEmail).
			Updates(map[string]interface{}{"is_active": true}).Error
	}

	// Naya record banao (slot 0 = master, recovery accounts 1 aur 2)
	record := model.SuperadminAccount{
		UserID:   user.ID,
		Email:    DefaultSuperadminEmail,
		Role:     model.RoleSuperadmin,
		Slot:     0,
		IsActive: true,
		Notes:    "Master root (auto-registered)",
	}

	return db.WithContext(ctx).Create(&record).Error
}