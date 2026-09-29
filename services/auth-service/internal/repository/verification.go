package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/wideo11/auth-service/internal/model"
)

// ErrVerificationTokenNotFound token nahi mila ya expire ho chuka hai
var ErrVerificationTokenNotFound = errors.New("verification token not found or expired")

// VerificationTokenRepository verification tokens manage karta hai
type VerificationTokenRepository interface {
	Create(ctx context.Context, token *model.VerificationToken) error
	GetByHash(ctx context.Context, tokenHash string) (*model.VerificationToken, error)
	// GetByHashIncludingUsed - consumed token bhi dhoondhta hai (read-only).
	// VerifyEmail ka fallback isse use hota hai taaki user ne link re-click /
	// refresh kiya ho to error ke bajaye honest "already verified" mile.
	GetByHashIncludingUsed(ctx context.Context, tokenHash string) (*model.VerificationToken, error)
	MarkVerified(ctx context.Context, tokenID uuid.UUID, userID uuid.UUID) error
	DeleteByUserID(ctx context.Context, userID uuid.UUID) error
}

type verificationTokenRepository struct {
	db *gorm.DB
}

// NewVerificationTokenRepository naya repository banata hai
func NewVerificationTokenRepository(db *gorm.DB) VerificationTokenRepository {
	return &verificationTokenRepository{db: db}
}

// Create naya verification token store karta hai
func (r *verificationTokenRepository) Create(ctx context.Context, token *model.VerificationToken) error {
	return r.db.WithContext(ctx).Create(token).Error
}

// GetByHash token hash se token dhoondta hai
// Sirf wahi token milega jo abhi tak use nahi hua aur expire bhi nahi hua
// Hinglish: expired ya used token ko valid nahi maante
func (r *verificationTokenRepository) GetByHash(ctx context.Context, tokenHash string) (*model.VerificationToken, error) {
	var token model.VerificationToken
	err := r.db.WithContext(ctx).
		Where("token_hash = ?", tokenHash).
		First(&token).Error

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrVerificationTokenNotFound
		}
		return nil, err
	}

	// Expired ya already-used token ko "not found" treat karte hain
	if !token.IsUsable() {
		return nil, ErrVerificationTokenNotFound
	}

	return &token, nil
}

// GetByHashIncludingUsed token hash se token dhoondhta hai - CHAHYE wo
// abhi use hua ho ya nahi.
//
// KYUN YE ZAROORI HAI:
// Verification token single-use hai. `GetByHash` sirf UNUSED tokens return
// karta hai (`IsUsable()` check), jo security ke liye sahi hai. Lekin use
// hone ke baad use karna CHAHTE HAIN to ye chahiye - specifically is case
// me:
//
//	user ne link click kiya -> verify ho gaya -> user ne page refresh kiya
//	-> wahi token dobara gaya -> `GetByHash` "not found" deta
//
// Yahan se service pata kar leti hai ki "haan token use ho chuka tha, aur
// user verified bhi hai" - aur honest success response de sakti hai,
// error ke bajaye. Ye koi naya account verify NAHI kar sakta - sirf
// already-verified state report karta hai.
//
// SECURITY: ye method sirf INTERNAL fallback ke liye hai. Verification ka
// actual path `GetByHash` + `MarkVerified` hai jo `IsUsable()` gate karta
// hai. Is method se koi state mutate nahi hoti - sirf read.
func (r *verificationTokenRepository) GetByHashIncludingUsed(ctx context.Context, tokenHash string) (*model.VerificationToken, error) {
	var token model.VerificationToken
	err := r.db.WithContext(ctx).
		Where("token_hash = ?", tokenHash).
		First(&token).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrVerificationTokenNotFound
		}
		return nil, err
	}
	return &token, nil
}

// MarkVerified token ko used mark karta hai aur user ko verified bana deta hai
// Do kaam ek transaction me - taaki beech me crash ho to token-used / user-unverified
// jaisa adhoora state na bache.
//
// NOTE: userID explicitly pass hota hai. Pehle maine GORM sub-query ko bind value
// ki tarah pass kiya tha ("id = ?", <subquery>) jisse Postgres par
// "syntax error at or near SELECT" aa raha tha. Ab dono IDs seedha aate hain -
// simple aur sahi SQL banta hai.
// Hinglish: userID seedha pass karte hain, sub-query se SQL bigad raha tha
func (r *verificationTokenRepository) MarkVerified(ctx context.Context, tokenID uuid.UUID, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()

		// Token ko used mark karo
		if err := tx.Model(&model.VerificationToken{}).
			Where("id = ?", tokenID).
			Update("verified_at", now).Error; err != nil {
			return err
		}

		// User ko verified banao (userID seedha use kar rahe hain)
		return tx.Model(&model.User{}).
			Where("id = ?", userID).
			Update("is_verified", true).Error
	})
}

// DeleteByUserID user ke saare verification tokens hata deta hai
// Purge ke time call hota hai taaki koi token baki na rahe
func (r *verificationTokenRepository) DeleteByUserID(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Unscoped().
		Where("user_id = ?", userID).
		Delete(&model.VerificationToken{}).Error
}

// PurgeRepository expired unverified accounts permanently delete karta hai
type PurgeRepository interface {
	// FindExpiredUnverified purane unverified users dhoondta hai
	FindExpiredUnverified(ctx context.Context, before time.Time, limit int) ([]*model.User, error)
	// HardDelete user row ko PERMANENTLY delete karta hai (soft delete nahi)
	HardDelete(ctx context.Context, userID uuid.UUID) error
}

type purgeRepository struct {
	db *gorm.DB
}

// NewPurgeRepository naya purge repository banata hai
func NewPurgeRepository(db *gorm.DB) PurgeRepository {
	return &purgeRepository{db: db}
}

// FindExpiredUnverified unverified users dhoondta hai jo "before" time se purane hain.
//
// CRITICAL: is_verified = false filter zaroori hai. Verified users kabhi purge
// nahi hone chahiye - sirf unverified (jinhone link click nahi kiya) hi delete hote hain.
// Hinglish: sirf unverified accounts purge hote hain, verified users kabhi nahi
func (r *purgeRepository) FindExpiredUnverified(ctx context.Context, before time.Time, limit int) ([]*model.User, error) {
	var users []*model.User

	err := r.db.WithContext(ctx).
		Where("is_verified = ? AND created_at < ?", false, before).
		Order("created_at ASC").
		Limit(limit).
		Find(&users).Error

	if err != nil {
		return nil, err
	}

	return users, nil
}

// HardDelete user ko PERMANENTLY delete karta hai.
//
// Unscoped() zaroori hai: GORM ka soft delete (deleted_at) normally use hota hai,
// jisse row database me chhup jati hai aur disk space nahi chhuti. Hamara requirement
// hai "permanently drop the user profile row", isliye Unscoped() se row physically
// delete hoti hai. Verification tokens bhi pehle delete ho jaate hain (FK integrity).
//
// Ye Go me GORM method hai - PostgreSQL ke kisi cron extension ki zaroorat NAHI hai,
// aur koi paid/extra infra install karne ki zaroorat nahi. Go ka background worker
// hi kaam karta hai - isse infrastructure cost zero rahegi.
// Hinglish: soft delete nahi, permanent delete - aur ye Go worker karta hai, cron DB extension nahi chahiye
func (r *purgeRepository) HardDelete(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Pehle dependent rows hatao (foreign keys se pehle, warna error aayega)
		tables := []interface{}{
			&model.VerificationToken{},
			&model.RefreshToken{},
			&model.Session{},
			&model.PIN{},
			&model.Device{},
		}

		for _, table := range tables {
			if err := tx.Unscoped().Where("user_id = ?", userID).Delete(table).Error; err != nil {
				return err
			}
		}

		// Ab user row ko permanently delete karo
		return tx.Unscoped().Where("id = ?", userID).Delete(&model.User{}).Error
	})
}
