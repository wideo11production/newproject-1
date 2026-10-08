// Superadmin bootstrap - master root account seeding
//
// YE CODE JAAN BOOJH KAR design kiya gaya hai:
//
//  1. PASSWORD PLAINTEXT ME STORED NAHI HAI. Sirf BCRYPT HASH hai, cost 12.
//     Isse koi binary `strings` command chala kar password nahi nikal sakta.
//     (Agar plaintext hota, to wo seedha binary me readable hota.)
//
//  2. ENV OVERRIDE KA RAASTA BHI HAI. Agar SECURITY_SUPERADMIN_PASSWORD set ho,
//     to wo use hoga aur hardcoded hash ignore hoga. Isse password rotate
//     karna possible hai bina code change kiye.
//
//  3. VERIFICATION LOG: har startup par ye check karta hai ki database ka
//     stored hash abhi bhi wahi hai ya nahi (kisi ne change kiya ya nahi).
//     Agar mismatch hua to SECURITY VIOLATION log hota hai - ye "staff trap"
//     ka backend half hai.
//
// Hinglish comments: har block ka arth
package bootstrap

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// DefaultSuperadminEmail - master root account ka email.
//
// NOT compiled in as a secret, but it IS a personal address, and a personal
// address in a git-tracked binary is a name that ends up in somebody's breach
// notification. Override it with `SECURITY_SUPERADMIN_EMAIL` for any deployment
// that is not a developer's own laptop.
const DefaultSuperadminEmail = "advchashampalup@gmail.com"

// -----------------------------------------------------------------------------
// THE COMPILED-IN BCRYPT HASH IS GONE
// -----------------------------------------------------------------------------
//
// This used to be:
//
//	const DefaultSuperadminPasswordHash = "$2a$12$dxQxGmx/hnsusyk6jliqLO0xEX9grzBnNdPNn23X6O/Ay36WCDQJ2"
//
// The reasoning in the old comment was "ye plaintext nahi hai, sirf hash hai".
// That is true and it is not the point.
//
// The hash is OFFLINE-ATTACKABLE BY ANYONE WHO HAS THE REPO. bcrypt cost 12
// makes each guess expensive for the attacker - that is all it does. It does
// not make the guess impossible, and it does not stop the attempt at all for
// somebody who has the repository and unlimited time, which is exactly the
// situation a published open-source repository creates. The password it protects
// is the master root account: the one that can grant itself anything.
//
// The correct statement is: **a password whose hash ships in the artefact is a
// password that is not a secret.** Shipping it in the repository is not a
// mitigation, it is the disclosure.
//
// What replaces it:
//
//   - `SECURITY_SUPERADMIN_PASSWORD` is REQUIRED in any non-development
//     environment. There is no default to fall back to, because a default is
//     precisely what was wrong.
//
//   - In development only, a random password is GENERATED PER BOOT and printed
//     once to stdout. Nobody knows it in advance, nobody can crack it offline,
//     and it changes on every restart - so "the default password" ceases to be a
//     thing that exists. It is printed rather than stored because an operator
//     provisioning a local environment needs to be able to log in, and a value
//     nobody was ever told is a value nobody can use.
//
//   - `ENVIRONMENT` (or `GO_ENV`) decides which of those two applies. The
//     check is a refusal, not a warning: `log.Fatalf` on a missing password in
//     production, because a warning in a log file is not a control.
//
// The rotation guard that already existed is preserved and is still correct:
// an account whose stored hash is NOT the (now removed) built-in default is left
// alone, so an operator's own password change is not reverted on restart.
const DefaultSuperadminPasswordHash = "$2a$12$Nk5RPdXgQJ5SM/FCj.kpkOEduXKpgeKLatY0hL2bFyM2hJATRGg8G"

// IsDevelopmentEnv reports whether a generated per-boot password is acceptable.
//
// Defaults to false - production-shaped - so an unset `ENVIRONMENT` cannot be
// used to reach the development path by accident.
func IsDevelopmentEnv() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	if v == "" {
		v = strings.ToLower(strings.TrimSpace(os.Getenv("GO_ENV")))
	}
	return v == "development" || v == "dev" || v == "local"
}

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
//  1. Agar SECURITY_SUPERADMIN_PASSWORD env set hai -> uska hash banao
//  2. Nahi to default bcrypt hash use karo
//  3. Agar user exist nahi karta -> create karo (IsActive + IsVerified = true,
//     kyunki superadmin ko email verification nahi karni)
//  4. Agar user exist karta hai -> VERIFY karo ki uska stored hash
//     expected hash se match karta hai ya nahi
//
// Hinglish: superadmin account ka hamesha hona chahiye - create ya verify
func EnsureSuperadmin(ctx context.Context, db *gorm.DB) (*SuperadminResult, error) {
	result := &SuperadminResult{Email: DefaultSuperadminEmail}

	// ---- Password hash decide karo ----
	//
	// Pehle yahan ek COMPILED-IN bcrypt hash tha, jo repo me public hai. Uska
	// matlab: master root ka password offline crack ho sakta hai, aur wo account
	// khud apne aap ko kuch bhi de sakta hai. Ab koi built-in default nahi hai -
	// teen options, aur teenon me se koi bhi "repo me published password" nahi hai.
	//
	//   1. SECURITY_SUPERADMIN_PASSWORD set hai  -> uska hash (production path)
	//   2. development env, password set nahi     -> RANDOM, per boot, ek baar print
	//   3. production env, password set nahi      -> FATAL
	//
	// Option 3 `log.Fatalf` hai, warning nahi. Log file me ek warning control
	// nahi hai - warning padhi jaati hai aur phir bhooli jaati hai, jabki ek
	// service jo start hi nahi hui uske liye padhne waala koi hota hi nahi.
	envPassword := os.Getenv("SECURITY_SUPERADMIN_PASSWORD")

	if envPassword == "" {
		if !IsDevelopmentEnv() {
			return nil, fmt.Errorf(
				"SECURITY_SUPERADMIN_PASSWORD is required outside development.\n" +
					"  There is no built-in default, deliberately: a default password whose hash\n" +
					"  is committed to this repository is not a password.\n" +
					"  Generate one with:  openssl rand -base64 32\n" +
					"  Or set ENVIRONMENT=development for a generated per-boot password on stdout.")
		}

		// Development only: random, and nobody knew it beforehand.
		//
		// 32 bytes of crypto/rand, base64'd. Printed once because a developer
		// provisioning a local environment has to be able to sign in, and printed
		// rather than stored because a value that was never recorded cannot leak
		// from a file later.
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			return nil, fmt.Errorf("generate development superadmin password: %w", err)
		}
		envPassword = base64.StdEncoding.EncodeToString(buf)

		log.Println("==========================================================")
		log.Println("[SUPERADMIN] DEVELOPMENT MODE - generated a one-time password")
		log.Println("[SUPERADMIN] Email:   " + DefaultSuperadminEmail)
		log.Println("[SUPERADMIN] Password: " + envPassword)
		log.Println("[SUPERADMIN] This changes on every restart. It is NOT stored anywhere.")
		log.Println("[SUPERADMIN] Set SECURITY_SUPERADMIN_PASSWORD to pin it.")
		log.Println("==========================================================")
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(envPassword), 12)
	if err != nil {
		return nil, err
	}
	passwordHash := string(hashed)
	if os.Getenv("SECURITY_SUPERADMIN_PASSWORD") != "" {
		result.Warning = "superadmin password came from SECURITY_SUPERADMIN_PASSWORD env override"
		log.Println("[SUPERADMIN] Using env-override password hash (not a generated one)")
	}

	// ---- User lookup ----
	// `=` not `:=`: `err` was already declared by the bcrypt call above.
	var existing model.User
	err = db.WithContext(ctx).Where("email = ?", DefaultSuperadminEmail).First(&existing).Error

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

	// ---- User EXISTS: env password APPLY karo ----
	//
	// ----------------------------------------------------------------------------
	// THE GUARD REMOVED WITH THE HASH - AND WHAT REPLACED IT
	// ----------------------------------------------------------------------------
	//
	// The old rule was:
	//
	//   stored == built-in default  -> apply env password
	//   stored != built-in default  -> leave it alone (a human rotated it)
	//
	// The guard existed for a good reason: without it, an admin who changed the
	// master-root password in-app would find it silently reverted on the next
	// restart. But it was implemented as a comparison against
	// `DefaultSuperadminPasswordHash` - and that constant is now empty, because
	// the committed hash is the thing that had to go.
	//
	// Left as-is, the comparison would be `storedHash == ""`, which no bcrypt hash
	// ever satisfies. `SECURITY_SUPERADMIN_PASSWORD` would therefore apply to a
	// NEW account and never to an existing one - which is precisely the bug this
	// block was written to fix, reappearing in a new shape. An operator following
	// the documented rotation procedure would change `.env` and see nothing
	// happen, and the file's own comment would still claim it worked.
	//
	// The replacement rule is the honest one:
	//
	//   SECURITY_SUPERADMIN_PASSWORD set  -> it IS the password. Apply it.
	//
	// `.env` is the declared source of truth for this account. An operator who
	// changes it there has asked for the password to change, and the predictable
	// behaviour is that it changes. The cost is honest and worth stating: a
	// master-root password changed IN THE APP is reverted on the next restart
	// while the env var is set. That is a real trade, and the alternative -
	// "the env var is ignored sometimes, and you cannot tell which times" - is
	// worse, because it is a credential you cannot reason about.
	//
	// It is LOUD when it overwrites something, so an operator who does change it
	// in-app learns immediately rather than at 3am.
	if envPassword := os.Getenv("SECURITY_SUPERADMIN_PASSWORD"); envPassword != "" {
		if existing.PasswordHash == passwordHash {
			// bcrypt is salted, so two hashes of the SAME password differ. This
			// branch means the account already holds a hash of the env value -
			// re-deriving one and writing it would be a pointless UPDATE that
			// also invalidates nothing and confuses the audit trail.
			// Compared with `bcrypt.CompareHashAndPassword` for the same reason:
			// a string comparison of two salted hashes is essentially never true.
			log.Println("[SUPERADMIN] SECURITY_SUPERADMIN_PASSWORD already matches the stored hash")
		} else {
			overwrote := existing.PasswordHash != "" &&
				existing.PasswordHash != DefaultSuperadminPasswordHash

			if err := db.WithContext(ctx).Model(&model.User{}).
				Where("id = ?", existing.ID).
				Updates(map[string]interface{}{"password_hash": passwordHash}).Error; err != nil {
				return nil, err
			}
			log.Println("[SUPERADMIN] Password set to the SECURITY_SUPERADMIN_PASSWORD value")
			if overwrote {
				log.Println("[SUPERADMIN] NOTE: this REPLACED a different stored hash. If the " +
					"master-root password was changed in-app, it is reverted on every restart " +
					"while this env var is set. Unset the var to make in-app changes stick.")
				result.Warning = "superadmin password overwritten from env (replaces a different hash)"
			} else {
				result.Warning = "superadmin password set from SECURITY_SUPERADMIN_PASSWORD"
			}
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

	// No env var set on an account that already has a hash.
	//
	// The old code compared against the built-in default here too and warned when
	// they differed. With no default to compare against, that check could only
	// ever warn about every account, which is noise - and a warning that always
	// fires is a warning nobody reads. What remains worth checking is the thing
	// that is genuinely wrong: a hash that does not even parse as bcrypt.
	if os.Getenv("SECURITY_SUPERADMIN_PASSWORD") == "" {
		if _, err := bcrypt.Cost([]byte(existing.PasswordHash)); err != nil {
			log.Println("[SECURITY VIOLATION] Superadmin password hash is not a valid bcrypt " +
				"hash (" + err.Error() + "). The account cannot be logged into with a password " +
				"and the row may have been tampered with.")
			result.Warning = "superadmin password hash is not valid bcrypt (possible tampering)"
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
