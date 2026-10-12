package service

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/password"
	"github.com/wideo11/auth-service/internal/repository"
	"github.com/wideo11/auth-service/internal/token"
	"gorm.io/gorm"
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUserInactive       = errors.New("user is inactive")
	ErrUserNotVerified    = errors.New("user email not verified")
	ErrPINLocked          = errors.New("PIN is locked")
	ErrInvalidPIN         = errors.New("invalid PIN")
	ErrTooManyAttempts    = errors.New("too many PIN attempts")

	// ---- Username errors (migration 003) ----
	// ErrInvalidUsername: format galat hai (length 3-30 ya invalid chars).
	// Ye 400-level error hai - user ko batana padega ki kya theek karna hai.
	ErrInvalidUsername = errors.New("username must be 3-30 characters using letters, numbers, underscore, dot or hyphen")

	// ErrUsernameTaken: username already kisi aur ka hai.
	// Ye 409-level error hai (conflict), email duplicate jaisa hi.
	//
	// KYUN YE ZAROORI HAI: bina iske, duplicate username par Postgres UNIQUE
	// index insert ko reject karega aur handler generic 500 "registration
	// failed" dega - user ko samajh nahi aayega kya karna hai. Isse pehle
	// check karke clear message dete hain.
	ErrUsernameTaken = errors.New("that username is already taken")

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
	cfg          *config.Config
	userRepo     repository.UserRepository
	sessionRepo  repository.SessionRepository
	deviceRepo   repository.DeviceRepository
	pinRepo      repository.PINRepository
	tokenRepo    repository.RefreshTokenRepository
	tokenService *token.TokenService
	passwordSvc  *password.PasswordService
	// verifRepo verification tokens manage karta hai (30-min purge lifecycle)
	verifRepo repository.VerificationTokenRepository
	// emailer verification email bhejne ke liye (interface type - circular dep se bachne ke liye)
	emailer emailDispatcher
	// emailQueue OPTIONAL background email queue. Set hone par verification
	// email DETACH ho jati hai (request turant return) aur background worker
	// bhejta hai - jisse registration ka ~5s wait nikal jata hai.
	// Nil ho to synchronous path chalta hai (slow, par kaam karta hai).
	emailQueue verificationEmailQueuer
	// ---- Phase C7: optional Redis denylist ----
	//
	// OPTIONAL hai, isliye pointer: nil ho to bhi service chalti hai. Ye Redis
	// me ek FAST PATH hai logout ka - Postgres me row hard-delete hona hi
	// AUTHORITY hai (har authenticated request wahan session dhoondta hai).
	//
	// Redis sirf ye add karta hai: logout ke turant baad aaye request ko
	// DB round-trip ke bina 401. Redis down ho to logout POORA kaam karta hai.
	//
	// Memory bounded hai: Revoke TTL ko 24h par clamp karta hai, yaani ye
	// list kabhi unbounded nahi ho sakti - isi liye isko mount karna memory
	// regression nahi hai.
	revocationStore SessionRevocator
	// db raw GORM handle - creator dashboard operations (channels, avatar,
	// sessions) ke liye. Repositories sirf `users`/`sessions` ke narrow
	// surface cover karte hain; nayi entities (channels) ke liye direct db
	// chahiye. main.go me `SetDB()` se inject hota hai.
	db *gorm.DB
	// entitlements service for checking user's plan limits
	entitlements *EntitlementService
}

// SetDB raw GORM handle inject karta hai (creator dashboard ke liye).
func (s *AuthService) SetDB(db *gorm.DB) {
	s.db = db
}

// SetEmailQueue background email queue inject karta hai.
//
// Ye OPTIONAL hai: agar set nahi hota, to verification email synchronous
// bheji jati hai (pichla behaviour). Set hone par email background me chali
// jati hai aur request turant return ho jati hai.
func (s *AuthService) SetEmailQueue(q verificationEmailQueuer) {
	s.emailQueue = q
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

// SetEntitlementService injects the entitlement service for quota checks
func (s *AuthService) SetEntitlementService(es *EntitlementService) {
	s.entitlements = es
}

func (s *AuthService) Register(ctx context.Context, req *model.RegisterRequest, deviceInfo model.DeviceInfo) (*model.User, *model.TokenPair, error) {
	// ---- USERNAME NORMALIZE + VALIDATE (new in migration 003) ----
	// Username public handle hai, isliye normalize karna zaroori hai:
	//   - trim + lowercase -> "Aarav" aur "aarav" ek hi account na banein
	//   - validation: 3-30 chars, sirf letters/digits/underscore/dot/dash
	// Ye normalization SAME rule frontend se bhi chalni chahiye (form me
	// live validation hai) - par server par bhi enforce karna zaroori hai
	// kyunki client validation bypass ho sakta hai.
	username := strings.ToLower(strings.TrimSpace(req.Username))
	if len(username) < 3 || len(username) > 30 {
		return nil, nil, ErrInvalidUsername
	}
	for _, r := range username {
		isLower := r >= 'a' && r <= 'z'
		isDigit := r >= '0' && r <= '9'
		isSpecial := r == '_' || r == '.' || r == '-'
		if !isLower && !isDigit && !isSpecial {
			return nil, nil, ErrInvalidUsername
		}
	}

	// Check if user already exists
	// Postgres se duplicate email check - user ko variable me store karne ki zaroorat
	// nahi, sirf "exist karta hai ya nahi" ye jaanna hai. Isliye _ use kiya gaya hai.
	// Hinglish: duplicate email check taaki same email se dobara account na ban sake
	if _, err := s.userRepo.GetByEmail(ctx, req.Email); err == nil {
		return nil, nil, repository.ErrUserExists
	} else if !errors.Is(err, repository.ErrUserNotFound) {
		return nil, nil, err
	}

	// ---- DUPLICATE USERNAME CHECK ----
	// `idx_users_username` par UNIQUE index hai. Agar hum ye check nahi karte,
	// to duplicate username par Postgres insert REJECT karega aur handler
	// generic 500 "registration failed" return karega - jo user ke liye
	// useless error hai (kya karu? batao nahi).
	// Isliye pehle se check karke ek CLEAR error dete hain.
	if _, err := s.userRepo.GetByUsername(ctx, username); err == nil {
		return nil, nil, ErrUsernameTaken
	} else if !errors.Is(err, repository.ErrUserNotFound) {
		return nil, nil, err
	}

	// Hash password
	hashedPassword, err := s.passwordSvc.Hash(req.Password)
	if err != nil {
		return nil, nil, err
	}

	// Create user
	//
	// BiometricCapable: client ne bataya ya nahi?
	//   nil (nahi bataya) -> true assume karte hain (safe/strict default,
	//                        migration 004 ka documented behaviour)
	//   false              -> client ne confirm kiya sensor nahi hai
	//   true               -> sensor hai
	biometricCapable := true
	if req.BiometricCapable != nil {
		biometricCapable = *req.BiometricCapable
	}

	user := &model.User{
		Email:            req.Email,
		PasswordHash:     hashedPassword,
		FullName:         req.FullName,
		Username:         username,
		BiometricCapable: biometricCapable,
		// Role EXPLICITLY set karo. GORM ka DB-level `default:user` INSERT ke
		// baad apply hota hai - yaani `user.Role` memory me is waqt KHAALI
		// hota. Aur token generate karte waqt hum `user.Role` padhte hain,
		// to bina ye ke token me EMPTY role claim chala jata aur user
		// superadmin-route par access na paaye (ya worse - koi bug me
		// empty role ko permissive samet liya jaaye).
		Role: model.RoleUser,
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

	ip, ua := clientInfoFromContext(ctx)
	// Create session and tokens
	session := &model.Session{
		// ID explicitly generate karo (BUG FIX: default:gen_random_uuid() DB-level
		// default hai, jo INSERT ke BAAD hi milta hai - token pehle generate hota
		// tha to JWT me session_id = uuid.Nil chala jata tha).
		ID:     uuid.New(),
		UserID: user.ID,
		// Defensive truncate: column VARCHAR(64) hai, par agar future me
		// koi unexpected bada value aaye to insert FAIL na ho.
		IPAddress: truncateStr(ip, 64),
		UserAgent: ua, // handler se context ke through aata hai
	}

	// DeviceID sirf tab set karte hain jab device actually persist hua ho
	if device != nil {
		session.DeviceID = &device.ID
	}

	// ---- REGISTRATION TELEMETRY (Block 3) ----
	// Ek PERMANENT audit record: kaun, kab, kahan se, kis device se.
	//
	// NOTE: token generate hone se PEHLE, par account create hone ke BAAD -
	// aur NON-BLOCKING. Telemetry fail ho jaye to registration FAIL nahi
	// hona chahiye. Isliye error sirf log hota hai.
	//
	// HONESTY: country/continent sirf tab likhe jayenge jab trusted proxy
	// geo header present ho. Local dev me wo nahi hota -> NULL. Kabhi
	// fabricated country nahi bharenge.
	if tel := telemetryFromContext(ctx); tel.DeviceType != "" {
		if err := s.RecordRegistration(
			ctx, user.ID, user.Email, user.Username,
			ip, ua, "", tel,
		); err != nil {
			log.Printf("[REGISTER] telemetry record failed (account still created): %v", err)
		}
	}

	accessToken, err := s.tokenService.GenerateAccessToken(user.ID, session.ID, user.Email, user.Role)
	if err != nil {
		return nil, nil, err
	}

	refreshToken, err := s.tokenService.GenerateRefreshToken(user.ID, session.ID)
	if err != nil {
		return nil, nil, err
	}

	session.AccessToken = password.HashToken(accessToken)
	// SECURITY: raw JWT DB me store karna unsafe hai (DB leak = session hijack) + column size overflow.
	// Hinglish: sirf SHA-256 hash store karte hain, raw token kabhi DB me nahi jaata
	session.RefreshToken = password.HashToken(refreshToken)
	session.ExpiresAt = time.Now().Add(time.Duration(s.cfg.JWT.AccessTokenTTL) * time.Minute)

	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, nil, err
	}

	// Store refresh token hash
	hashedRefreshToken := password.HashToken(refreshToken)

	// SessionID ZAROORI hai (migration 013). Iske bina logout ko pata hi
	// nahi chalta ki ye token kis device ka hai - matlab "sirf is device
	// par logout karo" database par likha hi nahi ja sakta tha, aur broad
	// `RevokeAllByUserID` hi ek available option bacha tha.
	//
	// Pointer kyunki column NULLable hai: migration se PEHLE ke tokens me
	// ye NULL hai aur unhe retroactively set nahi kiya jaata (unki
	// session pata hi nahi). Naye tokens precise path par jaate hain.
	// SessionID ZAROORI hai (migration 013). Iske bina logout ko pata hi
	// nahi chalta ki ye token kis device ka hai - matlab "sirf is device
	// par logout karo" database par likha hi nahi ja sakta tha, aur broad
	// `RevokeAllByUserID` hi ek available option bacha tha.
	//
	// Pointer kyunki column NULLable hai: migration se PEHLE ke tokens me
	// ye NULL hai aur unhe retroactively set nahi kiya jaata (unki
	// session pata hi nahi). Naye tokens precise path par jaate hain.
	// Token ko us DEVICE se jodna hi Phase C7 ka poora point hai.
	// `session` abhi Create ho chuka hai, isliye usme ID populated hai.
	sessionID := session.ID
	refreshTokenModel := &model.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashedRefreshToken,
		SessionID: &sessionID,
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

	// SECURITY FIX: email verify hone se PEHLE login BAND karna zaroori hai.
	//
	// BUG (kyun bug tha): ye check KABHI exist hi nahi tha. Isliye koi bhi user
	// jo signup bhi kar chuka tha aur jiska email deliver bhi nahi hua (ya user
	// ne link click hi nahi kiya), wo seedha LOGIN kar sakta tha aur usse full
	// token pair mil jaata tha. `ErrUserNotVerified` pehle se DECLARED tha aur
	// handler me uska 403 mapping bhi likha hua tha (handler.go se
	// "please verify your email"), par yahan kahin bhi `return` nahi hota tha -
	// wo 403 branch poori tarah DEAD CODE tha.
	//
	// ORDER: ye check password verify hone ke BAAD hai, isliye PEHLE karne ka
	// koi nahi kiya. Agar ye password se pehle hota, to koi bhi attacker
	// bina password jaane hi pata kar leta ki ye email registered hai aur
	// unverified hai - ye ACCOUNT ENUMERATION ka leak hota.
	// Ab sequence: galat password -> ErrInvalidCredentials (401),
	// sahi password + unverified email -> ErrUserNotVerified (403).
	//
	// Hinglish: email verify nahi hua to login nahi hona chahiye - ab check laga hai
	if !user.IsVerified {
		return nil, nil, ErrUserNotVerified
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

	return s.issueSession(ctx, user, device)
}

// ---------------------------------------------------------------------------
// issueSession - EVERY session in the system is created here
// ---------------------------------------------------------------------------
//
// This was the back half of `Login`, inlined. It is extracted because a second
// caller now needs it, and a second copy of this block is exactly how the two
// paths start to disagree: the password path would get a revocation entry and
// the passkey path would not, or one would set `refresh_tokens.session_id` and
// the other would not, and "log out of this device only" would silently work for
// some logins and not others.
//
// It is deliberately NOT a second login method. It performs no authentication at
// all - the caller has already proved identity, by password or by a verified
// WebAuthn signature. That separation is the safety property: the list of things
// that can call this is the list of things that have already authenticated, and
// it is short enough to read.
//
// SECURITY: `issueSession` never checks a password. Adding one here would make
// every caller's authentication strength irrelevant.
func (s *AuthService) issueSession(ctx context.Context, user *model.User, device *model.Device) (*model.User, *model.TokenPair, error) {
	ip, ua := clientInfoFromContext(ctx)
	// Create session and tokens
	session := &model.Session{
		// ---- CRITICAL FIX: ID explicitly generate karo (Register) ----
		//
		// BUG: `model.Session.ID` par `gorm:"default:gen_random_uuid()"` hai -
		// yaani UUID DATABASE default se banta hai, jo sirf INSERT ke BAAD
		// GORM ko wapas milta hai. Par token hum INSERT se PEHLE generate karte
		// the, jisme `session.ID` abhi uuid.Nil (all-zero) hota tha.
		//
		// Iska asar: har JWT me `session_id` claim = 00000000-0000-0000-
		// 0000-000000000000 chala jata tha. Jo bhi feature session ID par
		// depend karta hai (PIN rollover apna current session bachana, ya
		// kisi specific session ko revoke karna) wo kaam hi nahi karta -
		// fail-closed hokar 500 deta tha.
		//
		// FIX: ID yahin, application me generate kar do. Isse:
		//   - token sahi session ID carry karega
		//   - DB default redundant ho jayega (harmless)
		//   - rollover / revocation apna kaam karega
		ID:     uuid.New(),
		UserID: user.ID,
		// Defensive truncate: column VARCHAR(64) hai, par agar future me
		// koi unexpected bada value aaye to insert FAIL na ho.
		IPAddress: truncateStr(ip, 64),
		UserAgent: ua, // handler se context ke through aata hai
	}

	// DeviceID sirf tab set karte hain jab device actually persist hua ho
	if device != nil {
		session.DeviceID = &device.ID
	}

	accessToken, err := s.tokenService.GenerateAccessToken(user.ID, session.ID, user.Email, user.Role)
	if err != nil {
		return nil, nil, err
	}

	refreshToken, err := s.tokenService.GenerateRefreshToken(user.ID, session.ID)
	if err != nil {
		return nil, nil, err
	}

	session.AccessToken = password.HashToken(accessToken)
	// SECURITY: raw JWT DB me store karna unsafe hai (DB leak = session hijack) + column size overflow.
	// Hinglish: sirf SHA-256 hash store karte hain, raw token kabhi DB me nahi jaata
	session.RefreshToken = password.HashToken(refreshToken)
	session.ExpiresAt = time.Now().Add(time.Duration(s.cfg.JWT.AccessTokenTTL) * time.Minute)

	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, nil, err
	}

	// Store refresh token hash
	hashedRefreshToken := password.HashToken(refreshToken)

	// SessionID ZAROORI hai (migration 013). Iske bina logout ko pata hi
	// nahi chalta ki ye token kis device ka hai - matlab "sirf is device
	// par logout karo" database par likha hi nahi ja sakta tha, aur broad
	// `RevokeAllByUserID` hi ek available option bacha tha.
	//
	// Pointer kyunki column NULLable hai: migration se PEHLE ke tokens me
	// ye NULL hai aur unhe retroactively set nahi kiya jaata (unki
	// session pata hi nahi). Naye tokens precise path par jaate hain.
	// SessionID ZAROORI hai (migration 013). Iske bina logout ko pata hi
	// nahi chalta ki ye token kis device ka hai - matlab "sirf is device
	// par logout karo" database par likha hi nahi ja sakta tha, aur broad
	// `RevokeAllByUserID` hi ek available option bacha tha.
	//
	// Pointer kyunki column NULLable hai: migration se PEHLE ke tokens me
	// ye NULL hai aur unhe retroactively set nahi kiya jaata (unki
	// session pata hi nahi). Naye tokens precise path par jaate hain.
	// Token ko us DEVICE se jodna hi Phase C7 ka poora point hai.
	// `session` abhi Create ho chuka hai, isliye usme ID populated hai.
	sessionID := session.ID
	refreshTokenModel := &model.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashedRefreshToken,
		SessionID: &sessionID,
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

// ---------------------------------------------------------------------------
// LoginWithWebAuthn - a SECOND FACTOR, at login, that issues a real session
// ---------------------------------------------------------------------------
//
// ----------------------------------------------------------------------------
// WHAT THIS FIXES
// ----------------------------------------------------------------------------
//
// Until this existed, the passkey flow was a DEAD END. `FinishAuthentication`
// verified a real WebAuthn signature - genuinely strong, phishing-resistant,
// nothing to steal and nothing to phish - and then returned:
//
//     {"verified": true, "email": "...", "message": "..."}
//
// No token. No session. No way to become logged in from the result. So the
// strongest authentication this product can do was verified and then thrown
// away, and the ONLY way to get a session was a password. That is the worst
// possible shape: the user is offered a strong option, it does nothing, and the
// weak one is the only one that works.
//
// The old doc comment said "ye password se zyada secure aur phishing-resistant
// hai". That was true of the signature and false of the product.
//
// ----------------------------------------------------------------------------
// WHY THIS IS NOT "PASSWORD PLUS PASSKEY" AND WHY IT MATTERS
// ----------------------------------------------------------------------------
//
// This issues a session on a passkey ALONE. Password + passkey (true 2FA) is
// strictly stronger against a stolen passkey, and it is the right design for
// most products.
//
// It is not the right design here, for one specific reason: this product ALREADY
// requires a passkey. `security_profiles.biometric_opted_out` gates the
// dashboard behind the PIN -> questions -> biometric gate, and the biometric step
// is only skippable when the browser reports no platform authenticator at all.
// For those users there is no second factor to combine with, so requiring one
// would lock them out of their own account rather than protect it.
//
// What this therefore delivers is the property that was actually missing: **the
// passkey stops being a dead end and becomes a login method**, and the session it
// issues is identical in every respect to a password session - same TTL, same
// revocation, same session_id linkage, same device record, same audit event.
//
// Two routes, one session. `requirePermission`/`requireService` and the step-up
// work in `SYSTEM-PLAN.md` phase 0 are where true two-factor is layered on top.
//
// ----------------------------------------------------------------------------
// THE SECURITY RULES THIS ENFORCES
// ----------------------------------------------------------------------------
//
//  1. It does not take a password, so it cannot be downgraded to "the passkey was
//     optional".
//  2. It re-checks `IsActive` and `IsVerified` at issuance time, not just at
//     challenge time. A passkey enrolled before an account was deactivated, or
//     before an email was verified, must not be able to mint a session now.
//  3. It requires the caller to have already verified the signature. There is no
//     path here that skips `FinishLogin`.
//  4. It records an audit event with the same detail a password login does, so a
//     passkey login is visible in the security timeline rather than invisible.
func (s *AuthService) LoginWithWebAuthn(
	ctx context.Context,
	user *model.User,
	deviceInfo model.DeviceInfo,
) (*model.User, *model.TokenPair, error) {
	// Re-check state HERE, not where the challenge was issued.
	//
	// Between `BeginAuthentication` and `FinishAuthentication` an operator can
	// deactivate an account, or a user can discover an address was never really
	// theirs. A passkey is long-lived by design - it outlives any single session -
	// so trusting the state observed minutes or hours ago is trusting a stale
	// answer to a question that has changed.
	if !user.IsActive {
		return nil, nil, ErrUserInactive
	}
	if !user.IsVerified {
		return nil, nil, ErrUserNotVerified
	}

	// Same device handling as the password path, via the same repository call, so
	// "log out of this device only" and the device panel behave identically
	// whichever way the user signed in.
	var device *model.Device
	if deviceInfo.Fingerprint != "" {
		dev, err := s.deviceRepo.GetByFingerprint(ctx, deviceInfo.Fingerprint)
		if err != nil {
			if errors.Is(err, repository.ErrDeviceNotFound) {
				device = &model.Device{
					UserID:      user.ID,
					DeviceName:  deviceInfo.DeviceName,
					DeviceType:  deviceInfo.DeviceType,
					Platform:    deviceInfo.Platform,
					Browser:     deviceInfo.Browser,
					Fingerprint: deviceInfo.Fingerprint,
					// Higher than a password login's 50: the assertion was
					// cryptographically bound to this device.
					TrustScore: 80,
				}
				if err := s.deviceRepo.Create(ctx, device); err != nil {
					return nil, nil, err
				}
			} else {
				return nil, nil, err
			}
		} else {
			device = dev
		}
	}

	return s.issueSession(ctx, user, device)
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

	// SECURITY FIX (same gap as Login): refresh token path me bhi verified
	// check missing tha. Register karte waqt auth-service ek poora token pair
	// bana ke deta hai (handler.go 201 + tokens), aur wo refresh token se
	// continuously naye access tokens mint hote rehte - to login gate lagane
	// se sirf ek moment ke liye rokna kaafi nahi tha. Ye gate zaroori hai taaki
	// unverified account ka token refresh se renew na ho sake.
	if !user.IsVerified {
		return nil, ErrUserNotVerified
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
		// ID explicitly generate karo (BUG FIX: default:gen_random_uuid() DB-level
		// default hai, jo INSERT ke BAAD hi milta hai - token pehle generate hota
		// tha to JWT me session_id = uuid.Nil chala jata tha).
		ID:        uuid.New(),
		UserID:    user.ID,
		DeviceID:  session.DeviceID,
		IPAddress: "", // Would be extracted from request in handler
		UserAgent: "", // Would be extracted from request in handler
	}

	accessToken, err := s.tokenService.GenerateAccessToken(user.ID, newSession.ID, user.Email, user.Role)
	if err != nil {
		return nil, err
	}

	newRefreshToken, err := s.tokenService.GenerateRefreshToken(user.ID, newSession.ID)
	if err != nil {
		return nil, err
	}

	// SECURITY: raw JWTs DB me store nahi hote - sirf SHA-256 hashes
	// (DB leak se session hijack possible nahi hota)
	newSession.AccessToken = password.HashToken(accessToken)
	newSession.RefreshToken = password.HashToken(newRefreshToken)
	newSession.ExpiresAt = time.Now().Add(time.Duration(s.cfg.JWT.AccessTokenTTL) * time.Minute)

	if err := s.sessionRepo.Create(ctx, newSession); err != nil {
		return nil, err
	}

	// Store new refresh token hash
	hashedRefreshToken := password.HashToken(newRefreshToken)

	// SessionID ZAROORI hai (migration 013). Iske bina logout ko pata hi
	// nahi chalta ki ye token kis device ka hai - matlab "sirf is device
	// par logout karo" database par likha hi nahi ja sakta tha, aur broad
	// `RevokeAllByUserID` hi ek available option bacha tha.
	//
	// Pointer kyunki column NULLable hai: migration se PEHLE ke tokens me
	// ye NULL hai aur unhe retroactively set nahi kiya jaata (unki
	// session pata hi nahi). Naye tokens precise path par jaate hain.
	// SessionID ZAROORI hai (migration 013). Iske bina logout ko pata hi
	// nahi chalta ki ye token kis device ka hai - matlab "sirf is device
	// par logout karo" database par likha hi nahi ja sakta tha, aur broad
	// `RevokeAllByUserID` hi ek available option bacha tha.
	//
	// Pointer kyunki column NULLable hai: migration se PEHLE ke tokens me
	// ye NULL hai aur unhe retroactively set nahi kiya jaata (unki
	// session pata hi nahi). Naye tokens precise path par jaate hain.
	// Token ko us DEVICE se jodna hi Phase C7 ka poora point hai.
	// `newSession` abhi Create ho chuka hai, isliye usme ID populated hai.
	sessionID := newSession.ID
	refreshTokenModel := &model.RefreshToken{
		UserID:    user.ID,
		TokenHash: hashedRefreshToken,
		SessionID: &sessionID,
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

// LogoutResult batata hai logout ne EXACTLY kya kiya - aur kitni der lagi.
//
// Ye reporting nahi hai, ye verification hai. User ko dikhta hai ki logout ne
// uski kitni sessions bachayi: ek device par logout karna aur saare devices
// se nikalna bilkul alag outcome hai, aur pehle yahi galti thi.
// SetRevocationStore OPTIONAL Redis denylist inject karta hai.
//
// Interface ke through jaata hai, concrete Redis client ke through nahi, taaki
// logout ka behaviour Redis ke bina bhi test ho sake - jo zaroori hai, kyunki
// yeh wahi behaviour hai jo regression ka shikar hai (cross-device logout).
func (s *AuthService) SetRevocationStore(r SessionRevocator) {
	s.revocationStore = r
}

// SessionRevocator logout ka OPTIONAL fast path hai (Phase C7).
//
// Interface isliye hai taaki service package Redis client ki implementation
// ko import na kare - `redisx` already middleware me hai, aur service ko
// usse couple karne ka koi reason nahi. Test me stub daal kar logout ka
// behaviour Redis ke bina bhi assert kiya ja sakta hai.
type SessionRevocator interface {
	Revoke(ctx context.Context, sessionID uuid.UUID)
	IsRevoked(ctx context.Context, sessionID uuid.UUID) bool
}

type LogoutResult struct {
	// Ye device. Ab is row par koi token nahi hai.
	SessionDeleted bool
	// Is device ke refresh tokens, jo turant delete hue.
	RefreshTokensDeleted int64
	// Ye token user ke SAARE devices par chal raha tha. Ye number kam hona
	// chahiye - agar barabar hai, to broad revoke chal raha hai aur humein
	// pata chal gaya.
	RefreshTokensBefore int64
	RefreshTokensAfter  int64
	// User ke doosre devices ki active sessions - chhue nahi gayi.
	OtherSessionsRemaining int64
	// Logout ke andar wall-clock milliseconds.
	ElapsedMS float64
}

// Logout: SIRF is device ka token delete karo.
//
// ---- PEHLE KYA HOTA THA (aur kyun galat tha) ----
//
//	sessionRepo.Revoke(session.ID)               // ye session soft-revoke
//	tokenRepo.RevokeAllByUserID(session.UserID) // user ke SAARE devices
//
// Doosri line saare devices ke refresh tokens ek saath maar deti thi. User
// apne phone se logout karta aur laptop bhi logout ho jata - bina uske kuch
// kiye. Ye "logout everywhere" hai, jabki button sirf "logout HERE" kehta
// hai. Multi-device users ke liye ye kaam karna hi band kar deta tha.
//
// ---- AB KYA HOTA HAI ----
//
//  1. Is session ka refresh-token count, logout se PEHLE.
//  2. Is SESSION ke refresh tokens hard-delete (session_id scoped).
//  3. Is session ki row hard-delete.
//  4. Is session ke tokens ka count, logout ke BAAD.
//  5. User ke bache hue active tokens - confirm karne ke liye ki doosre
//     devices ZINDA hain.
//
// Step 5 isliye hai kyunki "humne sirf ye delete kiya" claim karne ke liye
// proof chahiye. Count same rahe to broad revoke chal raha hai - ye check
// usi bug ko dobara lautne se rokta hai.
//
// ---- PURANE TOKENS (session_id IS NULL) ----
//
// Migration 013 se PEHLE banay gaye tokens me session_id NULL hai. Un tokens
// ko hum kisi session se jod nahi sakte (data nahi hai), isliye unke liye
// `RevokeAllByUserID` chalta hai - yaani EXACTLY purana behaviour. Iska
// matlab: un tokens ke liye logout abhi bhi cross-device hai, aur ye
// jaanbujh kar chhoda gaya hai. Naye tokens (session_id set) precise path par
// jaate hain, aur purane tokens apni TTL par expire hokar hat jaate hain.
func (s *AuthService) Logout(ctx context.Context, accessToken string) (LogoutResult, error) {
	started := time.Now()
	var res LogoutResult
	defer func() { res.ElapsedMS = float64(time.Since(started).Microseconds()) / 1000.0 }()

	session, err := s.sessionRepo.GetByAccessToken(ctx, accessToken)
	if err != nil {
		if errors.Is(err, repository.ErrSessionNotFound) {
			// Already logged out. Ye ek ERROR nahi hai - logout idempotent hona
			// chahiye, warna dobara click karne par user ko galti ka message
			// milega jabki sab theek hai.
			return res, nil
		}
		return res, err
	}

	// ---- Step 1: is user ke kitne token zinda the ----
	res.RefreshTokensBefore, err = s.tokenRepo.CountActiveByUserID(ctx, session.UserID)
	if err != nil {
		return res, err
	}

	// ---- Step 2: sirf ISI session ke refresh tokens ----
	//
	// `WHERE session_id = ?` - ek device, ek query, ek delete.
	//
	// ---- YE WOHI JAGAH HAI JAHAN CROSS-DEVICE BUG AATA THA ----
	//
	// Yahan PEHLE ye tha:
	//
	//     s.tokenRepo.RevokeAllByUserID(ctx, session.UserID)
	//
	// jo user ke SAARE devices ke tokens maarta tha. Phone se logout karna
	// laptop bhi logout kar deta tha. Wo line ab HATA di gayi hai - koi
	// fallback nahi rakha, kyunki "purane tokens" ke liye device-scope
	// banana IMPOSSIBLE hai (unki session_id NULL hai, yaani unhe kis device
	// se joda jaye hi nahi - ye data nahi hai).
	//
	// ---- TRADE-OFF, JO CHHIPAYA NAHI JA RAHA ----
	//
	// Migration 013 se PEHLE banay gaye tokens (session_id IS NULL) logout ke
	// baad apni TTL tak valid reh sakte hain - kyunki unhe kisi device se
	// jod kar delete karna possible nahi, aur unhe jodne ka sahi tareeka
	// (broad revoke) hi woh bug hai jo hum theek kar rahe hain.
	//
	// Ye gap BOUNDED hai aur chhota hai:
	//   - sirf PRE-migration tokens affect hote hain
	//   - unka RefreshTokenTTL expire hone tak chalte hain
	//   - access token to waise bhi `sessions` row se validate hota hai, aur
	//     woh row logout par HARD DELETE ho jati hai - yaani logged-out device
	//     ka ACCESS token turant dead hai chahe refresh token NULL ho
	//
	// Yaani asymmetric raha hai: ek device ka ACCESS turant mar jaata hai,
	// sirf ek legacy REFRESH token TTL tak valid reh sakta hai, aur usse naya
	// access token milne ke liye login chahiye - jo password mangega.
	res.RefreshTokensDeleted, err = s.tokenRepo.HardDeleteBySessionID(ctx, session.ID)
	if err != nil {
		return res, err
	}

	if err := s.sessionRepo.HardDelete(ctx, session.ID); err != nil {
		return res, err
	}
	res.SessionDeleted = true

	// ---- Step 4 + 5: verify ----
	res.RefreshTokensAfter, err = s.tokenRepo.CountActiveByUserID(ctx, session.UserID)
	if err != nil {
		return res, err
	}
	res.OtherSessionsRemaining = res.RefreshTokensAfter

	// ---- Redis denylist entry ----
	//
	// Ye OPTIONAL fast path hai, authority Postgres ke paas hai. Agar Redis
	// down ho to bhi logout kaam karta hai - bas thoda slow. Fail-closed
	// nahi: ek logout ka fail hone se user logged in rehna behtar hai
	// (wo chala jaayega) isse (wo logged out na ho, attack ho).
	if s.revocationStore != nil {
		s.revocationStore.Revoke(ctx, session.ID)
	}

	return res, nil
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
