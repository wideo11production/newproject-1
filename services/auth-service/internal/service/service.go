package service

import (
	"context"
	"errors"
	"log"
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

	// ErrUserExists repository layer ka error hai, par handler use service package
	// se reference karta hai. Ye alias dono layers ko ek jaisa rakhta hai
	// taaki handler ko repository import karne ki zaroorat na pade.
	// Hinglish: error alias - duplicate email ka signal
	ErrUserExists = repository.ErrUserExists
)

// GetUserByID returns the user record for a given ID.
// Ye accessor isliye hai kyunki handler package, service ke unexported fields
// (userRepo) ko directly access nahi kar sakta - Go encapsulation allow nahi karta.
// Field export karne ke bajaye proper accessor method diya gaya hai.
// Hinglish: encapsulation bani rehti hai, handler ko sirf ye method chahiye
func (s *AuthService) GetUserByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	return s.userRepo.GetByID(ctx, id)
}

// GetSessionByAccessToken returns the session linked to an access token.
// Access token valid hone ke baad bhi session revoke ho sakta hai,
// isliye middleware me dono check kiye jaate hain.
// Hinglish: token valid hone ke baad bhi revoked session check zaroori hai
func (s *AuthService) GetSessionByAccessToken(ctx context.Context, accessToken string) (*model.Session, error) {
	return s.sessionRepo.GetByAccessToken(ctx, accessToken)
}

// ValidateAccessToken validates a JWT access token and returns its claims.
// Wrapper taaki handler ko token package import karne ki zaroorat na pade.
// Hinglish: token validation ka simple wrapper
func (s *AuthService) ValidateAccessToken(accessToken string) (*token.Claims, error) {
	return s.tokenService.ValidateAccessToken(accessToken)
}

type AuthService struct {
	cfg           *config.Config
	userRepo      repository.UserRepository
	sessionRepo   repository.SessionRepository
	deviceRepo    repository.DeviceRepository
	pinRepo       repository.PINRepository
	tokenRepo     repository.RefreshTokenRepository
	tokenService  *token.TokenService
	passwordSvc   *password.PasswordService
	// verifRepo verification tokens manage karta hai (30-min purge lifecycle)
	verifRepo     repository.VerificationTokenRepository
	// emailer verification email bhejne ke liye (interface type - circular dep se bachne ke liye)
	emailer       emailDispatcher
}

func NewAuthService(cfg *config.Config, userRepo repository.UserRepository, sessionRepo repository.SessionRepository,
	deviceRepo repository.DeviceRepository, pinRepo repository.PINRepository,
	tokenRepo repository.RefreshTokenRepository, tokenService *token.TokenService,
	passwordSvc *password.PasswordService) *AuthService {
	return &AuthService{
		cfg:          cfg,
		userRepo:     userRepo,
		sessionRepo:  sessionRepo,
		deviceRepo:   deviceRepo,
		pinRepo:      pinRepo,
		tokenRepo:    tokenRepo,
		tokenService: tokenService,
		passwordSvc:  passwordSvc,
	}
}

// SetVerificationRepo verification token repository inject karta hai
// Isse constructor signature nahi badla, aur tests me fake repo daal sakte hain
// Hinglish: dependency injection - constructor ko chhua bina
func (s *AuthService) SetVerificationRepo(r repository.VerificationTokenRepository) {
	s.verifRepo = r
}

func (s *AuthService) Register(ctx context.Context, req *model.RegisterRequest, deviceInfo model.DeviceInfo) (*model.User, *model.TokenPair, error) {
	// Check if user already exists
	// Postgres se duplicate email check - user ko variable me store karne ki zaroorat
	// nahi, sirf "exist karta hai ya nahi" ye jaanna hai. Isliye _ use kiya gaya hai.
	// Hinglish: duplicate email check taaki same email se dobara account na ban sake
	if _, err := s.userRepo.GetByEmail(ctx, req.Email); err == nil {
		return nil, nil, repository.ErrUserExists
	} else if !errors.Is(err, repository.ErrUserNotFound) {
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

	// Verification token issue karo aur email bhejo
	// User IsVerified=false ke saath banta hai (model default), aur 30 minute
	// me link click nahi hua to purge worker user ko permanently delete kar dega.
	// Ye step fail ho jaye to bhi account ban jata hai - sirf email dobara bhejne
	// ke liye resend endpoint use ho sakta hai. Isliye error swallow karte hain.
	// Hinglish: token issue karte hain, email bhejte hain - fail hone par account valid rehta hai
	if s.verifRepo != nil {
		if plainToken, err := s.IssueVerificationToken(ctx, user.ID, user.Email); err != nil {
			log.Printf("[VERIFY] Failed to issue verification token for %s: %v", user.Email, err)
		} else if err := s.SendVerificationEmail(ctx, user, plainToken); err != nil {
			log.Printf("[VERIFY] Failed to send verification email to %s: %v", user.Email, err)
		}
	}

	// Create device - SIRF tab jab client ne asli fingerprint bheja ho.
	//
	// KYUN: devices table me "fingerprint" column par UNIQUE index hai. Jab client
	// fingerprint nahi bhejta to hum "" (empty string) insert karte the, aur doosre
	// registration par ye duplicate ho jata tha ->
	// "duplicate key value violates unique constraint idx_devices_fingerprint",
	// jisse poora signup 500 ke saath fail ho jata tha.
	//
	// Ab empty fingerprint par device row banayi hi nahi jati, aur session ka
	// DeviceID nil reh jata hai (ye optional field hai).
	// Hinglish: bina fingerprint ke device record nahi banate, warna unique index tootega
	var device *model.Device
	if deviceInfo.Fingerprint != "" {
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
			// Device ban gaya ya nahi, user ka account phir bhi valid hai -
			// isliye error swallow karte hain aur aage badh jate hain
			device = nil
		}
	}

	// Create session and tokens
	session := &model.Session{
		UserID:    user.ID,
		IPAddress: "", // Would be extracted from request in handler
		UserAgent: "", // Would be extracted from request in handler
	}

	// DeviceID sirf tab set karte hain jab device actually persist hua ho
	if device != nil {
		session.DeviceID = &device.ID
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
	hashedRefreshToken := password.HashToken(refreshToken)

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
			return nil, nil, ErrInvalidCredentials
		}
		return nil, nil, err
	}

	// Check if user is active
	if !user.IsActive {
		return nil, nil, ErrUserInactive
	}

	// Verify password
	if err := s.passwordSvc.Verify(req.Password, user.PasswordHash); err != nil {
		if errors.Is(err, password.ErrMismatch) {
			return nil, nil, ErrInvalidCredentials
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
	}
	// NOTE: is "else" ka koi device-create branch nahi hai.
	// Jab client fingerprint nahi bhejta, hum koi device row insert nahi karte.
	// Pehle yahan khaali fingerprint ("") insert hota tha, jo UNIQUE index
	// "idx_devices_fingerprint" ko toot deta tha aur doosre login par signup fail
	// ho jati thi. Device optional hai, isliye device nil rehne dena sahi hai.
	// Hinglish: fingerprint nahi hai to device record banate hi nahi

	// Create session and tokens
	session := &model.Session{
		UserID:    user.ID,
		IPAddress: "", // Would be extracted from request in handler
		UserAgent: "", // Would be extracted from request in handler
	}

	// DeviceID sirf tab set karte hain jab device actually persist hua ho
	if device != nil {
		session.DeviceID = &device.ID
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
	hashedRefreshToken := password.HashToken(refreshToken)

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
		return nil, ErrInvalidCredentials
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
		return nil, ErrInvalidCredentials
	}

	// Get user
	user, err := s.userRepo.GetByID(ctx, session.UserID)
	if err != nil {
		return nil, err
	}

	if !user.IsActive {
		return nil, ErrUserInactive
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
		return nil, err
	}

	newRefreshToken, err := s.tokenService.GenerateRefreshToken(user.ID, newSession.ID)
	if err != nil {
		return nil, err
	}

	newSession.AccessToken = accessToken
	newSession.RefreshToken = newRefreshToken
	newSession.ExpiresAt = time.Now().Add(time.Duration(s.cfg.JWT.AccessTokenTTL) * time.Minute)

	if err := s.sessionRepo.Create(ctx, newSession); err != nil {
		return nil, err
	}

	// Store new refresh token hash
	hashedRefreshToken := password.HashToken(newRefreshToken)

	refreshTokenModel := &model.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashedRefreshToken,
		ExpiresAt: time.Now().Add(time.Duration(s.cfg.JWT.RefreshTokenTTL) * 24 * time.Hour),
	}

	if err := s.tokenRepo.Create(ctx, refreshTokenModel); err != nil {
		return nil, err
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
	// Sirf "exist karta hai ya nahi" jaanna hai, isliye result discard kar dete hain
	// Hinglish: duplicate PIN setup rokne ke liye check
	if _, err := s.pinRepo.GetByUserID(ctx, userID); err == nil {
		return errors.New("PIN already setup")
	} else if !errors.Is(err, repository.ErrPINNotFound) {
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
		return ErrPINLocked
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
				return ErrTooManyAttempts
			}
			return ErrInvalidPIN
		}
		return err
	}

	// Reset attempts on successful verification
	if err := s.pinRepo.ResetAttempts(ctx, userID); err != nil {
		return err
	}

	return nil
}
