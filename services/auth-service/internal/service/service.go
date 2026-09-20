package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/password"
	"github.com/wideo11/auth-service/internal/repository"
	"github.com/wideo11/auth-service/internal/token"
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUserInactive       = errors.New("user is inactive")
	ErrUserNotVerified    = errors.New("user email not verified")
	ErrPINLocked          = errors.New("PIN is locked")
	ErrInvalidPIN         = errors.New("invalid PIN")
	ErrTooManyAttempts    = errors.New("too many PIN attempts")
)

type AuthService struct {
	cfg           *config.Config
	userRepo      repository.UserRepository
	sessionRepo   repository.SessionRepository
	deviceRepo    repository.DeviceRepository
	pinRepo       repository.PINRepository
	tokenRepo     repository.RefreshTokenRepository
	tokenService  *token.TokenService
	passwordSvc   *password.PasswordService
}

func NewAuthService(cfg *config.Config, userRepo repository.UserRepository, sessionRepo repository.SessionRepository,
	deviceRepo repository.DeviceRepository, pinRepo repository.PINRepository,
	tokenRepo repository.RefreshTokenRepository, tokenService *token.TokenService,
	passwordSvc *password.PasswordService) *AuthService {
	return &AuthService{
		cfg:           cfg,
		userRepo:      userRepo,
		sessionRepo:   sessionRepo,
		deviceRepo:    deviceRepo,
		pinRepo:       pinRepo,
		tokenRepo:     tokenRepo,
		tokenService:  tokenService,
		passwordSvc:   passwordSvc,
	}
}

func (s *AuthService) Register(ctx context.Context, req *model.RegisterRequest, deviceInfo model.DeviceInfo) (*model.User, *model.TokenPair, error) {
	// Check if user already exists
	existingUser, err := s.userRepo.GetByEmail(ctx, req.Email)
	if err == nil {
		return nil, nil, repository.ErrUserExists
	}
	if !errors.Is(err, repository.ErrUserNotFound) {
		return nil, nil, err
	}

	// Hash password
	hashedPassword, err := s.passwordSvc.Hash(req.Password)
	if err != nil {
		return nil, nil, err
	}

	// Create user
	user := &model.User{
		Email:        req.Email,
		PasswordHash: hashedPassword,
		FullName:     req.FullName,
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, nil, err
	}

	// Create device
	device := &model.Device{
		UserID:      user.ID,
		DeviceName:  deviceInfo.DeviceName,
		DeviceType:  deviceInfo.DeviceType,
		Platform:    deviceInfo.Platform,
		Browser:     deviceInfo.Browser,
		Fingerprint: deviceInfo.Fingerprint,
		TrustScore:  50,
	}

	if err := s.deviceRepo.Create(ctx, device); err != nil {
		// Continue even if device creation fails - user is still created
	}

	// Create session and tokens
	session := &model.Session{
		UserID:    user.ID,
		DeviceID:  &device.ID,
		IPAddress: "", // Would be extracted from request in handler
		UserAgent: "", // Would be extracted from request in handler
	}

	accessToken, err := s.tokenService.GenerateAccessToken(user.ID, session.ID, user.Email)
	if err != nil {
		return nil, nil, err
	}

	refreshToken, err := s.tokenService.GenerateRefreshToken(user.ID, session.ID)
	if err != nil {
		return nil, nil, err
	}

	session.AccessToken = accessToken
	session.RefreshToken = refreshToken
	session.ExpiresAt = time.Now().Add(time.Duration(s.cfg.JWT.AccessTokenTTL) * time.Minute)

	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, nil, err
	}

	// Store refresh token hash
	hashedRefreshToken, err := s.passwordSvc.Hash(refreshToken)
	if err != nil {
		return nil, nil, err
	}

	refreshTokenModel := &model.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashedRefreshToken,
		ExpiresAt: time.Now().Add(time.Duration(s.cfg.JWT.RefreshTokenTTL) * 24 * time.Hour),
	}

	if err := s.tokenRepo.Create(ctx, refreshTokenModel); err != nil {
		return nil, nil, err
	}

	// Update user last login
	if err := s.userRepo.UpdateLastLogin(ctx, user.ID); err != nil {
		// Continue even if this fails
	}

	tokenPair := &model.TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    s.tokenService.GetAccessTokenTTL(),
		TokenType:    "Bearer",
	}

	return user, tokenPair, nil
}

func (s *AuthService) Login(ctx context.Context, req *model.LoginRequest, deviceInfo model.DeviceInfo) (*model.User, *model.TokenPair, error) {
	// Get user by email
	user, err := s.userRepo.GetByEmail(ctx, req.Email)
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			return nil, nil, repository.ErrInvalidCredentials
		}
		return nil, nil, err
	}

	// Check if user is active
	if !user.IsActive {
		return nil, nil, repository.ErrUserInactive
	}

	// Verify password
	if err := s.passwordSvc.Verify(req.Password, user.PasswordHash); err != nil {
		if errors.Is(err, password.ErrMismatch) {
			return nil, nil, repository.ErrInvalidCredentials
		}
		return nil, nil, err
	}

	// Get or create device
	var device *model.Device
	if deviceInfo.Fingerprint != "" {
		device, err = s.deviceRepo.GetByFingerprint(ctx, deviceInfo.Fingerprint)
		if err != nil {
			if errors.Is(err, repository.ErrDeviceNotFound) {
				device = &model.Device{
					UserID:      user.ID,
					DeviceName:  deviceInfo.DeviceName,
					DeviceType:  deviceInfo.DeviceType,
					Platform:    deviceInfo.Platform,
					Browser:     deviceInfo.Browser,
					Fingerprint: deviceInfo.Fingerprint,
					TrustScore:  50,
				}
				if err := s.deviceRepo.Create(ctx, device); err != nil {
					return nil, nil, err
				}
			} else {
				return nil, nil, err
			}
		}
	} else {
		// Create new device without fingerprint
		device = &model.Device{
			UserID:      user.ID,
			DeviceName:  deviceInfo.DeviceName,
			DeviceType:  deviceInfo.DeviceType,
			Platform:    deviceInfo.Platform,
			Browser:     deviceInfo.Browser,
			TrustScore:  50,
		}
		if err := s.deviceRepo.Create(ctx, device); err != nil {
			return nil, nil, err
		}
	}

	// Create session and tokens
	session := &model.Session{
		UserID:    user.ID,
		DeviceID:  &device.ID,
		IPAddress: "", // Would be extracted from request in handler
		UserAgent: "", // Would be extracted from request in handler
	}

	accessToken, err := s.tokenService.GenerateAccessToken(user.ID, session.ID, user.Email)
	if err != nil {
		return nil, nil, err
	}

	refreshToken, err := s.tokenService.GenerateRefreshToken(user.ID, session.ID)
	if err != nil {
		return nil, nil, err
	}

	session.AccessToken = accessToken
	session.RefreshToken = refreshToken
	session.ExpiresAt = time.Now().Add(time.Duration(s.cfg.JWT.AccessTokenTTL) * time.Minute)

	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, nil, err
	}

	// Store refresh token hash
	hashedRefreshToken, err := s.passwordSvc.Hash(refreshToken)
	if err != nil {
		return nil, nil, err
	}

	refreshTokenModel := &model.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashedRefreshToken,
		ExpiresAt: time.Now().Add(time.Duration(s.cfg.JWT.RefreshTokenTTL) * 24 * time.Hour),
	}

	if err := s.tokenRepo.Create(ctx, refreshTokenModel); err != nil {
		return nil, nil, err
	}

	// Update user last login
	if err := s.userRepo.UpdateLastLogin(ctx, user.ID); err != nil {
		// Continue even if this fails
	}

	tokenPair := &model.TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    s.tokenService.GetAccessTokenTTL(),
		TokenType:    "Bearer",
	}

	return user, tokenPair, nil
}

func (s *AuthService) RefreshToken(ctx context.Context, req *model.RefreshTokenRequest) (*model.TokenPair, error) {
	// Validate refresh token
	refreshClaims, err := s.tokenService.ValidateRefreshToken(req.RefreshToken)
	if err != nil {
		if errors.Is(err, token.ErrExpiredToken) {
			return nil, errors.New("refresh token expired")
		}
		return nil, repository.ErrInvalidCredentials
	}

	// Get session from refresh token
	session, err := s.sessionRepo.GetByRefreshToken(ctx, req.RefreshToken)
	if err != nil {
		if errors.Is(err, repository.ErrSessionNotFound) {
			return nil, errors.New("refresh token not found or revoked")
		}
		return nil, err
	}

	// Check if session belongs to the user in token
	if session.UserID != refreshClaims.UserID {
		return nil, repository.ErrInvalidCredentials
	}

	// Get user
	user, err := s.userRepo.GetByID(ctx, session.UserID)
	if err != nil {
		return nil, err
	}

	if !user.IsActive {
		return nil, repository.ErrUserInactive
	}

	// Revoke old session and refresh token
	if err := s.sessionRepo.Revoke(ctx, session.ID); err != nil {
		return nil, err
	}

	if err := s.tokenRepo.RevokeAllByUserID(ctx, user.ID); err != nil {
		return nil, err
	}

	// Create new session
	newSession := &model.Session{
		UserID:    user.ID,
		DeviceID:  session.DeviceID,
		IPAddress: "", // Would be extracted from request in handler
		UserAgent: "", // Would be extracted from request in handler
	}

	accessToken, err := s.tokenService.GenerateAccessToken(user.ID, newSession.ID, user.Email)
	if err != nil {
		return nil, nil, err
	}

	newRefreshToken, err := s.tokenService.GenerateRefreshToken(user.ID, newSession.ID)
	if err != nil {
		return nil, nil, err
	}

	newSession.AccessToken = accessToken
	newSession.RefreshToken = newRefreshToken
	newSession.ExpiresAt = time.Now().Add(time.Duration(s.cfg.JWT.AccessTokenTTL) * time.Minute)

	if err := s.sessionRepo.Create(ctx, newSession); err != nil {
		return nil, nil, err
	}

	// Store new refresh token hash
	hashedRefreshToken, err := s.passwordSvc.Hash(newRefreshToken)
	if err != nil {
		return nil, nil, err
	}

	refreshTokenModel := &model.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashedRefreshToken,
		ExpiresAt: time.Now().Add(time.Duration(s.cfg.JWT.RefreshTokenTTL) * 24 * time.Hour),
	}

	if err := s.tokenRepo.Create(ctx, refreshTokenModel); err != nil {
		return nil, nil, err
	}

	tokenPair := &model.TokenPair{
		AccessToken:  accessToken,
		RefreshToken: newRefreshToken,
		ExpiresIn:    s.tokenService.GetAccessTokenTTL(),
		TokenType:    "Bearer",
	}

	return tokenPair, nil
}

func (s *AuthService) Logout(ctx context.Context, accessToken string) error {
	session, err := s.sessionRepo.GetByAccessToken(ctx, accessToken)
	if err != nil {
		if errors.Is(err, repository.ErrSessionNotFound) {
			return nil // Already logged out
		}
		return err
	}

	if err := s.sessionRepo.Revoke(ctx, session.ID); err != nil {
		return err
	}

	if err := s.tokenRepo.RevokeAllByUserID(ctx, session.UserID); err != nil {
		return err
	}

	return nil
}

func (s *AuthService) SetupPIN(ctx context.Context, userID uuid.UUID, req *model.PINSetupRequest) error {
	// Check if PIN already exists
	existingPIN, err := s.pinRepo.GetByUserID(ctx, userID)
	if err == nil {
		return errors.New("PIN already setup")
	}
	if !errors.Is(err, repository.ErrPINNotFound) {
		return err
	}

	// Hash PIN
	hashedPIN, err := s.passwordSvc.Hash(req.PIN)
	if err != nil {
		return err
	}

	pin := &model.PIN{
		UserID:   userID,
		PINHash:  hashedPIN,
		Attempts: 0,
	}

	return s.pinRepo.Create(ctx, pin)
}

func (s *AuthService) VerifyPIN(ctx context.Context, userID uuid.UUID, req *model.PINVerifyRequest) error {
	pin, err := s.pinRepo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, repository.ErrPINNotFound) {
			return errors.New("PIN not setup")
		}
		return err
	}

	// Check if PIN is locked
	if pin.LockedAt != nil {
		return repository.ErrPINLocked
	}

	// Verify PIN
	if err := s.passwordSvc.Verify(req.PIN, pin.PINHash); err != nil {
		if errors.Is(err, password.ErrMismatch) {
			// Increment attempts
			if err := s.pinRepo.IncrementAttempts(ctx, userID); err != nil {
				return err
			}

			// Check if max attempts reached
			if pin.Attempts+1 >= 5 {
				if err := s.pinRepo.Lock(ctx, userID); err != nil {
					return err
				}
				return repository.ErrTooManyAttempts
			}
			return repository.ErrInvalidPIN
		}
		return err
	}

	// Reset attempts on successful verification
	if err := s.pinRepo.ResetAttempts(ctx, userID); err != nil {
		return err
	}

	return nil
}