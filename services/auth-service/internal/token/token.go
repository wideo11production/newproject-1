package token

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/wideo11/auth-service/internal/config"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token expired")
)

type Claims struct {
	UserID    uuid.UUID `json:"user_id"`
	SessionID uuid.UUID `json:"session_id"`
	Email     string    `json:"email"`

	// ---- ROLE (migration 006) ----
	// Role JWT me carry hota hai taaki middleware / API guards ko har
	// request par DB hit kiye BINA role decide kar sake.
	//
	// SECURITY NOTE - ye claim AUTHZ ke liye use hota hai, isliye ye
	// IMPORTANT hai ki ye token SIGNED hai (HS256). Client role bhej kar
	// apna role badl nahi sakta - signature verify hona zaroori hai.
	// Isliye middleware me `jwtVerify()` ke baad hi role padha jayega.
	Role string `json:"role"`
	jwt.RegisteredClaims
}

type RefreshClaims struct {
	UserID    uuid.UUID `json:"user_id"`
	SessionID uuid.UUID `json:"session_id"`
	jwt.RegisteredClaims
}

type TokenService struct {
	cfg *config.JWTConfig
}

func NewTokenService(cfg *config.JWTConfig) *TokenService {
	return &TokenService{cfg: cfg}
}

// GenerateAccessToken access token banata hai.
//
// `role` claim add kiya gaya hai (migration 006) - authz decisions ke liye.
// Role token me SIGNED hota hai, isliye client ise forge nahi kar sakta.
//
// Hinglish: role bhi token me daalo - har request par DB hit na karna pade
func (s *TokenService) GenerateAccessToken(userID, sessionID uuid.UUID, email, role string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:    userID,
		SessionID: sessionID,
		Email:     email,
		Role:      role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.cfg.Issuer,
			Audience:  jwt.ClaimStrings{s.cfg.Audience},
			Subject:   userID.String(),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(s.cfg.AccessTokenTTL) * time.Minute)),
			NotBefore: jwt.NewNumericDate(now),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.SecretKey))
}

func (s *TokenService) GenerateRefreshToken(userID, sessionID uuid.UUID) (string, error) {
	now := time.Now()
	claims := RefreshClaims{
		UserID:    userID,
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.cfg.Issuer,
			Audience:  jwt.ClaimStrings{s.cfg.Audience},
			Subject:   userID.String(),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(s.cfg.RefreshTokenTTL) * 24 * time.Hour)),
			NotBefore: jwt.NewNumericDate(now),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.SecretKey))
}

func (s *TokenService) ValidateAccessToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(s.cfg.SecretKey), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, ErrInvalidToken
}

func (s *TokenService) ValidateRefreshToken(tokenString string) (*RefreshClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &RefreshClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(s.cfg.SecretKey), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	if claims, ok := token.Claims.(*RefreshClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, ErrInvalidToken
}

func (s *TokenService) GetAccessTokenTTL() int {
	return s.cfg.AccessTokenTTL * 60 // seconds
}
