package handler

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
	"github.com/wideo11/auth-service/internal/token"
	"github.com/wideo11/auth-service/src/redis"
)

type AuthHandler struct {
	authService *service.AuthService
	// securitySvc lockout/PIN/device-limit enforce karta hai.
	// Login me inject hota hai. Nil ho to security features gracefully skip hoti hain.
	securitySvc *service.SecurityService
	// trialDevices is the one-trial-per-BROWSER cap. Kept apart from
	// `entitlements` because the two answer different questions on different
	// schedules: entitlements are about what a PAID plan allows, this is about
	// whether a FREE offer has already been collected. See
	// `internal/service/trial_device.go` for why it is keyed on a browser and
	// not on an IP.
	trialDevices *service.TrialDeviceService
	// storage - direct-to-MinIO avatar uploads (presigned URLs).
	//
	// Nil ho sakta hai agar storage config missing hai. Handlers us case me
	// saaf 503 return karte hain (crash nahi) - user ko pata chalega ki
	// upload available nahi hai, blank screen nahi milega.
	storage *service.StorageService

	// securityNotifier sends PIN-change, password-change and welcome emails.
	//
	// A separate field from `authService`'s own emailer because this one carries
	// SECURITY events, not transaction mail: it must keep working when transactional
	// mail is disabled, because the alert nobody receives is the one that mattered.
	//
	// Nil-safe. Every call site checks, and a missing notifier means no email rather
	// than a failed request - a 500 on a successful PIN change would be a worse
	// outcome than a silent one, and the change itself has already been persisted.
	securityNotifier SecurityNotifier

	// rbac / serviceAccess - "who may do what", backed by migration 017.
	//
	// Attached by `SetRBAC` rather than through the constructor, because main.go
	// builds the handler before it has a database.
	//
	// Nil is treated as FAIL CLOSED everywhere they are read: an authorization
	// layer that was never wired must refuse privileged routes, never permit them.
	// See `requirePermission` and `requireService`.
	rbac          *service.RBAC
	serviceAccess *service.ServiceAccess

	// subscriptions - channel subscribe/unsubscribe and the DERIVED count.
	//
	// Separate from authService because it is a different bounded context: channels
	// have no auth semantics, and the derived count has to be the only path to a
	// subscriber number. Nil is tolerated - reads fall back to the database.
	media *service.MediaService

	// comments owns the comment thread under an asset. Its own service rather than
	// a method chain off `media`, because a comment is about a viewer's interaction
	// and not about the asset's pipeline - and folding the two would put an
	// authorisation check and a transcode state machine in the same file.
	//
	// Nil is tolerated: the comment routes answer 503 rather than panicking, so a
	// deployment without a comment store fails loudly on the ONE thing that needs it
	// instead of on every media request.
	comments *service.CommentService

	// transcode hands a stored asset to the transcoding service. May be nil, in
	// which case an upload is recorded and the transcode is not queued - never a
	// failed upload.
	transcode *service.TranscodeClient

	// billingClient calls billing-service for student violation penalties.
	// May be nil - in which case compliance violations are blocked by auth-service
	// but the 25% penalty/revocation is NOT forwarded to billing-service.
	// This is fail-open for the upload (upload was already blocked) but
	// fail-closed for the financial penalty (better to not charge than to
	// charge through an unconfigured client).
	billingClient *service.BillingClient

	// deviceSlots is the lifetime plan's device allowance. Read-only here; the
	// enforcement happens in the register path (see DeviceSlotService).
	deviceSlots *service.DeviceSlotService

	// entitlements - what this user may do. Server-side authority for every quota.
	entitlements *service.EntitlementService

	// subscriptions - channel subscribe/unsubscribe and the DERIVED count.
	//
	// Separate from authService because it is a different bounded context: channels
	// have no auth semantics, and the derived count has to be the only path to a
	// subscriber number. Nil is tolerated - reads fall back to the database.
	subscriptions *service.ChannelSubscriptionService

	// mfaChallengeStore holds short-lived MFA challenges for PIN-as-2FA at login
	mfaChallengeStore *redis.MFAChallengeStore
}

// SetStorageService storage service inject karta hai (constructor dependency
// cycle se bachne ke liye setter pattern, baaki services jaisa).
func (h *AuthHandler) SetStorageService(st *service.StorageService) {
	h.storage = st
}

// SetSubscriptionService channel-subscription service inject karta hai.
//
// Setter, same reason as the others: the constructor would have to grow another
// parameter for a service that has no bearing on authentication.
func (h *AuthHandler) SetSubscriptionService(svc *service.ChannelSubscriptionService) {
	h.subscriptions = svc
}

// SetMediaService wires the media pipeline (migration 015's media_assets).
func (h *AuthHandler) SetMediaService(m *service.MediaService) {
	h.media = m
}

// SetCommentService wires the comment thread under an asset.
func (h *AuthHandler) SetCommentService(c *service.CommentService) {
	h.comments = c
}

// MediaService returns the wired media pipeline, or nil if none was set.
//
// Exists so the bootstrap can attach the object store to the media service after
// storage is built, without reaching into the handler's fields. Returning nil
// rather than panicking: a deployment with no media configured is legitimate, and
// the caller checks.
func (h *AuthHandler) MediaService() *service.MediaService {
	return h.media
}

// SetEntitlementService wires the plan ledger.
func (h *AuthHandler) SetEntitlementService(e *service.EntitlementService) {
	h.entitlements = e
}

// SetTrialDeviceService attaches the one-trial-per-browser cap.
//
// A setter for the same reason as `SetEntitlementService`: `main.go` builds the
// handler before it has a database, and threading one more argument through every
// constructor call would be a wide diff for no benefit.
//
// The nil check in `Register` is what makes an unwired cap safe, and it is worth
// stating which direction: an unwired cap GRANTS every trial rather than refusing
// to sign anybody up. For a promotion that is the correct failure — the cost is
// some free trials, and the alternative is an outage.
func (h *AuthHandler) SetTrialDeviceService(s *service.TrialDeviceService) {
	h.trialDevices = s
}

// SetMFAChallengeStore wires the MFA challenge store for PIN-as-2FA at login
func (h *AuthHandler) SetMFAChallengeStore(s *redis.MFAChallengeStore) {
	h.mfaChallengeStore = s
}

// SetTranscodeClient wires the transcoding handoff.
func (h *AuthHandler) SetTranscodeClient(t *service.TranscodeClient) {
	h.transcode = t
}

// SetBillingClient wires the billing-service student violation penalty client.
//
// Optional: nil means student violation penalties are NOT forwarded to
// billing-service. The upload is still blocked by the compliance check;
// only the 25% penalty revocation step is skipped.
//
// Hinglish: student violation penalty ke liye billing-service client wiring
func (h *AuthHandler) SetBillingClient(b *service.BillingClient) {
	h.billingClient = b
}

// SetDeviceSlotService wires the lifetime device allowance.
func (h *AuthHandler) SetDeviceSlotService(d *service.DeviceSlotService) {
	h.deviceSlots = d
}

// SetSecurityService security service inject karta hai (circular dep se bachne ke liye
// constructor ke bajaye setter use hota hai)
func (h *AuthHandler) SetSecurityService(svc *service.SecurityService) {
	h.securitySvc = svc
}

func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req model.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Extract device info from headers (would normally come from request body in real app)
	deviceInfo := model.DeviceInfo{
		DeviceName:  c.GetHeader("X-Device-Name"),
		DeviceType:  c.GetHeader("X-Device-Type"),
		Platform:    c.GetHeader("X-Platform"),
		Browser:     c.GetHeader("X-Browser"),
		Fingerprint: c.GetHeader("X-Fingerprint"),
	}

	// IP + User-Agent ko context me daal rahe hain taaki nayi session me
	// save ho sake (creator dashboard ka "kis device par login hai" panel
	// inhi values par kaam karta hai). Pehle ye hamesha empty store hota tha.
	// SECURITY: ye values DISPLAY ke liye hain, authorization ke liye nahi -
	// client dono spoof kar sakta hai.
	reqCtx := service.WithClientInfo(
		c.Request.Context(), clientIP(c.Request), c.Request.UserAgent(),
	)
	// Telemetry (geo + device + browser) SERVER par derive karo.
	//
	// Ye CLIENT payload se nahi aata - User-Agent aur trusted proxy geo
	// headers se banta hai, isliye browser me jhooth bol ke device/country
	// nahi badal sakta.
	reqCtx = service.WithTelemetryInContext(reqCtx, service.ParseTelemetry(c.Request))

	user, tokenPair, err := h.authService.Register(reqCtx, &req, deviceInfo)
	if err != nil {
		switch err {
		case service.ErrUserExists:
			c.JSON(http.StatusConflict, gin.H{"error": "user already exists"})

		// ---- Username errors (migration 003) ----
		// 400: format galat - user ko batana hai ki theek karna kya hai
		case service.ErrInvalidUsername:
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid username",
				"message": "Username must be 3-30 characters using letters, numbers, underscore, dot or hyphen",
			})

		// 409: conflict - koi aur user ye handle already le raha hai
		case service.ErrUsernameTaken:
			c.JSON(http.StatusConflict, gin.H{
				"error":   "username taken",
				"message": "That username is already taken. Please choose another.",
			})

		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "registration failed"})
		}
		return
	}

	// ============================================================================
	// TRIAL GRANT - the 3-day plan, automatically, on registration
	// ============================================================================
	//
	// WHY THIS IS HERE AND NOT SOMEWHERE ELSE
	//
	// Because this is the ONLY moment in a user's life when granting them a plan is
	// unambiguously correct. Everywhere else it needs a decision: did they pay, is
	// this a retry, is this abuse. Here it is simply "a new account starts on the
	// trial", which is the industry default and what `plans.go` already describes.
	//
	// Without this, registration produced an account with NO plan, and `Limit()`
	// returned `ErrEntitlementMissing` for every capability — so a brand new user
	// could not upload a single file, on any plan, including the free trial the
	// product ships. That is the state this session found the product in.
	//
	// ---- IT IS BEST-EFFORT AND SAYS SO ----
	//
	// A failed grant does NOT fail the registration. The account exists, the
	// tokens are valid, and the user can sign in; they just see zero allowances
	// until an operator grants one. Rolling back a successful signup because a
	// quota row failed to insert is the worse failure by a wide margin.
	//
	// But it is reported in the response and logged, rather than swallowed: a silent
	// failure here is indistinguishable from "the trial does not exist", which is
	// the exact confusion this code is here to remove.
	//
	// ---- NO `trial` ON RE-REGISTRATION ----
	//
	// `Register` fails with `ErrUserExists` for a duplicate email, so this runs
	// exactly once per account, ever. The abuse question — how many times one
	// person may obtain a trial — is therefore NOT answered here, because there is
	// nothing to answer: a second attempt creates no user and grants nothing.
	//
	// What still needs answering, and is a separate piece of work: a user whose
	// trial EXPIRED asking for another one. See `TrialPolicy` below.
	var trialInfo gin.H
	if h.entitlements != nil {

		// ========================================================================
		// THE DEVICE CAP, and it runs BEFORE the trial is granted
		// ========================================================================
		//
		// WHY IT IS HERE AND NOT IN THE CLIENT
		//
		// Because a check the client performs is a check the client can skip. The
		// browser is the untrusted party; if this lived in JS, one console line
		// would hand out unlimited trials.
		//
		// WHY IT IS HERE AND NOT IN `EntitlementService.Grant`
		//
		// Because `Grant` is also called by the admin endpoint, for a deliberate
		// operator action. A superadmin saying "give this account a trial" must not
		// be second-guessed by a rule about the operator's own browser.
		//
		// WHY IT BLOCKS THE TRIAL AND NOT THE REGISTRATION
		//
		// Because the innocent case is real: the second person on a shared laptop.
		// Refusing them a SIGNUP punishes them for a device they do not control. So
		// the account is created, and it simply starts with zero allowances — an
		// honest state the UI can explain.
		//
		// It is a HARD CAP, per the product decision: one trial per browser, no
		// override path in the client.
		deviceFingerprint := deviceInfo.Fingerprint
		// A nil `trialDevices` means the cap was never wired. Treated as GRANTED,
		// and the refusal path — the part that must not fail open — is untouched.
		// See `SetTrialDeviceService`.
		var claim *service.TrialClaimResult
		if h.trialDevices != nil {
			var claimErr error
			claim, claimErr = h.trialDevices.ClaimTrial(c.Request.Context(), deviceFingerprint, user.Email)
			if claimErr != nil {
				// NEVER fatal. A failure to CHECK the cap must not fail a signup; it
				// means the cap could not be evaluated, and the safe reading of "could
				// not evaluate" is "allow". Logged so it is never mistaken for the cap
				// working.
				log.Printf("[TRIAL] device cap check failed for %s: %v — allowing", user.Email, claimErr)
				claim = nil
			}
		}

		if claim != nil && !claim.Granted {
			// ---- REFUSED. The account exists; the trial does not. ----
			//
			// The event is CRITICAL (`criticalTypes` in `model/security.go`), which
			// puts it on the superadmin red banner AND makes it acknowledgeable with
			// the OK button. No new alert machinery — one map entry was enough.
			//
			// The attempt COUNT travels in the detail, because the event type alone
			// cannot separate a family member from an operation.
			if h.securitySvc != nil {
				h.securitySvc.LogSecurityEvent(
					c.Request.Context(), &user.ID, user.Email,
					model.EventTrialBlockedDevice,
					service.TrialBlockedDetail(
						deviceFingerprint, claim.AlreadyClaimedBy, claim.BlockedAttempts,
					),
					clientIP(c.Request), c.Request.UserAgent(),
				)
			}
			log.Printf("[TRIAL] refused for %s — this browser already used a trial (%d refusals)",
				user.Email, claim.BlockedAttempts)

			trialInfo = gin.H{
				"granted":         false,
				"reason":          "device_already_trialed",
				"message":         "This browser has already used a free trial.",
				"blocked_attempts": claim.BlockedAttempts,
			}
		} else {
			endsAt := h.entitlements.TrialEndFromNow()
			ent, grantErr := h.entitlements.Grant(
				c.Request.Context(), user.ID, service.PlanTrial,
				model.EntitlementSourceTrial, endsAt, nil, nil,
				user.Email, deviceFingerprint,
			)
			if grantErr != nil {
				// Logged and surfaced, NOT fatal. See the note above.
				log.Printf("[TRIAL] grant failed for %s: %v — account created with zero allowances", user.Email, grantErr)
				trialInfo = gin.H{
					"granted": false,
					"reason":  grantErr.Error(),
				}
			} else {
				trialInfo = gin.H{
					"granted":  true,
					"plan":     service.PlanTrial,
					"ends_at":  ent.EndsAt,
					"days":     h.entitlements.TrialDays(),
					"limits":   trialLimits(h.entitlements, ent),
				}
				log.Printf("[TRIAL] granted %s for %d day(s), ends %s",
					service.PlanTrial, h.entitlements.TrialDays(), ent.EndsAt)
			}
		}
	} else {
		// No entitlement service wired. Not a crash — a deployment without it simply
		// has no plans, which is a configuration problem reported at boot.
		trialInfo = gin.H{"granted": false, "reason": "entitlements not configured"}
	}

	// ============================================================================
	// SERVICE GRANTS - so the apps are actually reachable
	// ============================================================================
	//
	// Every registered account is granted the services it needs, for the same
	// reason the trial is granted here: registration is the one moment where the
	// answer is not a decision.
	//
	// WHY THIS EXISTS, AND WHAT IT COST WHEN IT DID NOT
	//
	// `requireService("web")` guards the channel routes — `POST /channels`,
	// `PATCH /channels/:id`, every cover and logo route. It is a correct guard
	// with a real backing table (`user_services`), and `ServiceAccess.Grant` has
	// existed the whole time.
	//
	// **`user_services` had zero rows.** Not because granting failed — because
	// nothing ever called `Grant`. So every one of those routes answered
	//
	//     {"error":"service_not_granted","message":"You do not have access to web."}
	//
	// to every user, including new ones, including on the channel-SETUP flow where
	// the platform has just asked them to create their first channel.
	//
	// That is the SEVENTH recorded instance of this repository's most expensive
	// pattern — correct code, correct tests, correct comments, and no path by which
	// anything reaches it. It is also the worst possible place to hit it, because a
	// guard that blocks everyone is indistinguishable from a guard that works.
	//
	// FIXED THE SAME WAY AS THE TRIAL, and for the same reason: make registration
	// grant it, so the policy is the shape of the code rather than a check
	// somebody has to remember to run.
	//
	// `web`         the main app — channels, billing, dashboard
	// `video_editor` the editor at :3002, same session
	//
	// Both are granted, not `admin`: an ordinary creator needs both, and granting
	// `admin`/`superadmin` services to every signup would make those slugs
	// meaningless as a restriction.
	var servicesGranted []string
	if h.serviceAccess != nil {
		for _, svc := range defaultUserServices {
			// `reason` is free text in an audit column, and "granted at
			// registration" is the only honest value here — not "user asked",
			// because nobody asked.
			if err := h.serviceAccess.Grant(c.Request.Context(), user.ID, svc, nil,
				"granted automatically at registration"); err != nil {
				// Logged, NOT fatal. An account that exists but cannot reach the
				// editor is a support ticket; an account that does not exist is a
				// signup that appears to have worked.
				log.Printf("[SERVICE GRANT] %s failed for %s: %v", svc, user.Email, err)
				continue
			}
			servicesGranted = append(servicesGranted, svc)
		}
	}

	// ============================================================================
	// ROLE APPOINTMENT - the THIRD layer, and the last one with no writer
	// ============================================================================
	//
	// Layer 1: `entitlements`   — what PLAN the user is on          (was 0 rows)
	// Layer 2: `user_services`   — which APPS the user may open    (was 0 rows)
	// Layer 3: `appointments`    — which ROLES the user holds      (was 0 rows)
	//
	// All three were correctly seeded, correctly implemented, correctly tested,
	// and had ZERO writers. So all three resolved to "nothing", and a brand-new user
	// was refused channel creation three different ways in a row:
	//
	//	service_not_granted  ->  "You do not have access to web."
	//	forbidden            ->  "You do not have the 'channel.create' capability."
	//
	// The second one is this block. `requirePermission("channel.create")` calls
	// `RBAC.Can`, which reads `appointments` → `role_permissions`. With no
	// appointment, there are no permissions, and the superadmin bypass does not
	// apply because a new user is not a superadmin.
	//
	// `creator` and nothing else. It is the lowest ranked role that can make and
	// manage content, which is exactly what a signup is. `finance` and `ops` are
	// deliberately NOT granted — a self-service signup that appointed itself an
	// administrator would make the whole rank hierarchy decorative.
	//
	// The appointment is made BY the system, so `granterID` is the user's own id:
	// `Appoint` records who granted a role, and attributing a self-appointment to
	// the system (nil granter) would misreport it as an admin action. This is the
	// ONE case where self-attribution is honest rather than a privilege problem,
	// because the role being granted is the lowest one and the alternative is a
	// bootstrap superadmin doing it by hand for every signup.
	var roleGranted string
	if h.rbac != nil {
		roleID, lookupErr := h.rbac.RoleIDByName(c.Request.Context(), "creator")
		if lookupErr != nil {
			log.Printf("[RBAC] creator role lookup failed at registration: %v", lookupErr)
		} else if _, appointErr := h.rbac.Appoint(
			c.Request.Context(), user.ID, user.ID, roleID,
			"granted automatically at registration", nil,
		); appointErr != nil {
			// Logged, NOT fatal. An account that exists but cannot create a channel
			// is a support ticket; an account that does not exist is a signup that
			// appeared to work.
			log.Printf("[RBAC] creator appointment failed for %s: %v", user.Email, appointErr)
		} else {
			roleGranted = "creator"
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"user": gin.H{
			"id":          user.ID,
			"email":       user.Email,
			"username":    user.Username,
			"full_name":   user.FullName,
			"is_active":   user.IsActive,
			"is_verified": user.IsVerified,
			"created_at":  user.CreatedAt,
		},
		"tokens": tokenPair,
		// Echoed so the client can render "your trial ends in 3 days" WITHOUT a
		// second request, and so the expiry the SERVER computed is what the UI shows
		// rather than the browser's own arithmetic on a timestamp.
		"trial": trialInfo,
		// Which apps this account can open. The client needs it to decide where to
		// send somebody after signup, and it is the same list the server enforces —
		// so a mismatch between "the UI offered this" and "the guard allows this"
		// cannot happen.
		"services": servicesGranted,
		"role":     roleGranted,
	})
}

// defaultUserServices is what every new account is granted.
//
// A closed list, not "everything" — `admin` and `superadmin` are deliberately
// absent. Granting them to every signup would make those slugs meaningless as a
// restriction, which is the entire reason `requireService` exists as a second gate
// alongside `requirePermission`.
//
// Held here rather than in `.env` because these are product defaults an operator
// should not need to configure; the SERVICE GRANT model, not this list, is what is
// configurable.
var defaultUserServices = []string{"web", "video_editor"}

// trialLimits renders a granted plan's capabilities for the registration response.
//
// `Limit`'s second return value is `granted`, not "is unlimited" — unlimited is the
// VALUE being `config.Unlimited`. Getting that backwards reported a `starter` user as
// unlimited across every capability; see
// `internal/service/entitlement_limit_contract_test.go`.
func trialLimits(s *service.EntitlementService, ent *model.Entitlement) map[string]any {
	out := map[string]any{}
	if s == nil || ent == nil {
		return out
	}

	// `s.Plan(...)` rather than `s.plans.Get(...)` — `plans` is unexported, and
	// reaching into another package's private field is not an option. The exported
	// accessor exists so this is the only way, which is the point of it.
	plan, ok := s.Plan(ent.PlanCode)
	if !ok {
		return out
	}
	for capability, v := range plan.Grants {
		if v == config.Unlimited {
			out[capability] = "unlimited"
		} else {
			out[capability] = v
		}
	}
	return out
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Extract device info from headers
	deviceInfo := model.DeviceInfo{
		DeviceName:  c.GetHeader("X-Device-Name"),
		DeviceType:  c.GetHeader("X-Device-Type"),
		Platform:    c.GetHeader("X-Platform"),
		Browser:     c.GetHeader("X-Browser"),
		Fingerprint: c.GetHeader("X-Fingerprint"),
	}

	ctx := c.Request.Context()
	ip := clientIP(c.Request)
	ua := c.Request.UserAgent()

	// ---- CHAKRAVYUH DEFENSE: lockout intercept ----
	// Login se PEHLE check karo ki account lockout me hai ya nahi.
	// Agar 3 galat passwords ho chuke hain to password login BLOCKED hai
	// aur user ko 6-digit PIN verify karna padega.
	// Hinglish: login se pehle lockout check - 3 galat password = PIN required
	if h.securitySvc != nil {
		if existing, uErr := h.authService.GetUserByEmailForSecurity(ctx, req.Email); uErr == nil && existing != nil {
			state, remaining, sErr := h.securitySvc.GetLockoutStatus(ctx, existing.ID)
			if sErr == nil {
				switch state {
				case model.LockoutStatePINRequired:
					// IMPORTANT: agar user ne PIN SET nahi kiya hai to
					// PIN demand karna UNFAIR hoga - wo kabhi recover
					// nahi kar paayega. Isliye hum pehle check karte
					// hain ki PIN exist karta hai ya nahi.
					hasPIN, _ := h.securitySvc.HasPIN(ctx, existing.ID)

					if !hasPIN {
						// No PIN -> password retry allowed after expiry
						c.JSON(http.StatusLocked, gin.H{
							"error":             "password_lockout_no_pin",
							"message":           "Too many failed attempts. No security PIN is configured for this account.",
							"lockout_state":     model.LockoutStatePINRequired,
							"pin_required":      false,
							"recovery_hint":     "Wait for the lockout window to expire, or use the account recovery flow.",
							"seconds_remaining": 0,
						})
						return
					}

					// 423 Locked - PIN mangwao
					c.JSON(http.StatusLocked, gin.H{
						"error":             "password_lockout",
						"message":           "Too many failed attempts. Verify your 6-digit security PIN to continue.",
						"lockout_state":     model.LockoutStatePINRequired,
						"pin_required":      true,
						"seconds_remaining": remaining,
					})
					return
				case model.LockoutStateBlocked:
					// 423 Locked - 3 minute countdown
					c.JSON(http.StatusLocked, gin.H{
						"error":             "account_blocked",
						"message":           "Warning: Account will be blocked if biometric credentials are not verified within 3 minutes.",
						"lockout_state":     model.LockoutStateBlocked,
						"blocked":           true,
						"seconds_remaining": remaining,
					})
					return
				}
			}
		}
	}

	// ---- DEVICE LIMIT: per-device account cap ----
	//
	// NOTE: ye block LOGIN handler ke andar hai, REGISTER ke nahi. Yaani cap
	// login par check hota hai - jab user pehli baar is device se login karta
	// hai tab uska account `device_accounts` me record hota hai, aur 4th unique
	// account pe login 403 se block ho jata hai.
	//
	// Ye ab .env se on/off hai (`DEVICE_LIMIT_ENABLED`), default ON + 3 (SPEC).
	// Local dev me ek hi laptop se naye test accounts banane hote hain, isliye
	// wahan `.env` me `DEVICE_LIMIT_ENABLED=false` karke cap band kiya ja
	// sakta hai. OFF par ye block chalti hi nahi - user ko 403 nahi milta.
	//
	// Hinglish: ek device pe max N accounts - N+1 pe login reject (jab limit ON ho).
	if h.securitySvc != nil && deviceInfo.Fingerprint != "" {
		if regErr := h.securitySvc.RegisterDeviceAccount(
			ctx, deviceInfo.Fingerprint, userIDFromEmailOrNil(h, ctx, req.Email), req.Email, ip, ua,
		); regErr == service.ErrDeviceLimitExceeded {
			// Message me hardcoded "3" NAHI - actual configured cap use karo.
			// Warna limit 5 set ki ho to user ko jhooth dikhega.
			limit := h.securitySvc.DeviceAccountCap()
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "device_limit_exceeded",
				"message": fmt.Sprintf("This device has reached the maximum number of accounts (%d).", limit),
				"limit":   limit,
			})
			return
		}
	}

	// IP + UA context me daalo (nayi session me save hoga - device panel ke liye)
	loginCtx := service.WithClientInfo(
		c.Request.Context(), clientIP(c.Request), c.Request.UserAgent(),
	)
	user, tokenPair, err := h.authService.Login(loginCtx, &req, deviceInfo)
	if err != nil {
		switch err {
		case service.ErrInvalidCredentials:
			// ---- Record failed attempt (3 pe lockout) ----
			attemptsLeft := model.MaxFailedPasswords
			lockoutTriggered := false
			if h.securitySvc != nil {
				if existing, uErr := h.authService.GetUserByEmailForSecurity(ctx, req.Email); uErr == nil && existing != nil {
					count, triggered, rErr := h.securitySvc.RecordFailedPassword(ctx, existing.ID, req.Email, ip, ua)
					if rErr == nil {
						attemptsLeft = model.MaxFailedPasswords - count
						lockoutTriggered = triggered
					}
				}
			}

			if lockoutTriggered {
				// Lockout trigger - ab PIN chahiye
				c.JSON(http.StatusLocked, gin.H{
					"error":         "password_lockout",
					"message":       "Too many failed attempts. Verify your 6-digit security PIN to continue.",
					"lockout_state": model.LockoutStatePINRequired,
					"pin_required":  true,
				})
				return
			}

			c.JSON(http.StatusUnauthorized, gin.H{
				"error":              "invalid email or password",
				"attempts_remaining": attemptsLeft,
			})
		case service.ErrUserInactive:
			c.JSON(http.StatusForbidden, gin.H{"error": "user account is inactive"})
		case service.ErrUserNotVerified:
			c.JSON(http.StatusForbidden, gin.H{"error": "please verify your email"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		}
		return
	}

	// ---- MFA CHECK: if user has PIN configured, require MFA at login (2FA) ----
	// Only proceed to issue tokens if PIN is NOT configured. If PIN is configured,
	// return a challenge and wait for PIN verification via /mfa/verify.
	//
	// IMPORTANT: If MFA was already verified in this login flow (challenge marked
	// as verified via /mfa/verify), skip the MFA requirement and proceed normally.
	// This prevents the infinite loop where login → MFA → login → MFA → ...
	if h.mfaChallengeStore != nil && h.securitySvc != nil {
		// Check if MFA was already verified for this user in this login flow
		hasVerified, _ := h.mfaChallengeStore.HasVerified(ctx, user.ID)
		if !hasVerified {
			hasPIN, _ := h.securitySvc.HasPIN(ctx, user.ID)
			if hasPIN {
				ch, err := h.mfaChallengeStore.Create(ctx, user.ID, user.Email)
				if err == nil {
					c.JSON(http.StatusOK, gin.H{
						"mfa_required":  true,
						"challenge_id":  ch.ChallengeID,
						"expires_at":    ch.ExpiresAt,
						"message":       "Verify your 6-digit security PIN to complete login",
					})
					return
				}
				// If challenge creation fails, log and fall through to normal login
				log.Printf("[MFA] challenge creation failed for %s: %v - proceeding without MFA", user.Email, err)
			}
		}
	}

	// ---- SUCCESS: counters clear + setup gate check ----
	// Sahi password -> failed attempts reset
	if h.securitySvc != nil {
		h.securitySvc.ClearFailedPasswords(ctx, user.ID)
		h.securitySvc.LogSecurityEvent(ctx, &user.ID, user.Email,
			model.EventLoginSuccess, "Login successful", ip, ua)
	}

	// ---- MANDATORY SECURITY SETUP GATE ----
	// Spec ke mutabiq dashboard entry BLOCKED hai jab tak PIN + biometric
	// + 3 security questions teeno complete na ho.
	// Hinglish: teeno security cheezein chahiye warna dashboard block
	setupRequired := true
	var setupStatus gin.H
	if h.securitySvc != nil {
		profile, _ := h.securitySvc.GetSetupStatus(ctx, user.ID)
		setupRequired = !profile.SecuritySetupComplete
		setupStatus = gin.H{
			"pin_configured":                profile.PINConfigured,
			"biometric_registered":          profile.BiometricRegistered,
			"security_questions_configured": profile.SecurityQuestionsConfigured,
			"setup_complete":                profile.SecuritySetupComplete,
			// NEW: login page ko ye chahiye taaki wo security-setup gate
			// email verification se PEHLE na khole. Spec order:
			// email verify -> security setup. Ye `user` se padha ja raha hai
			// (login yahin user fetch karta hai), to extra query nahi lagti.
			//
			// NOTE: login par ye hamesha `true` hota hai - auth-service
			// UNVERIFIED user ko login deta hi nahi ("please verify your
			// email"). Ye field consistency ke liye hai, taaki client ek hi
			// shape parse kare.
			"email_verified": user.IsVerified,
			// NEW (migration 004): frontend ko ye batana zaroori hai ki
			// biometric step skip hone layak hai ya nahi. Bina iske gate
			// un users ko step 2 pe rok dega jinke device me sensor hi
			// nahi hai - wo step kabhi complete nahi kar paayenge.
			"biometric_capable":  user.BiometricCapable,
			"required_questions": 3,
		}
	} else {
		setupRequired = false
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":            user.ID,
			"email":         user.Email,
			"username":      user.Username,
			"full_name":     user.FullName,
			"is_active":     user.IsActive,
			"is_verified":   user.IsVerified,
			"last_login_at": user.LastLoginAt,
			// DYNAMIC ROLE ROUTING (unified port 3000 pipeline):
			// The Go auth engine inspects the PostgreSQL `users.role` column
			// and reports it back so the web app can route without a second
			// login page. `user` → WideoCut workspace. `superadmin` /
			// `superadmin_recovery` → Grafana-like management grids.
			"role":             user.Role,
			"is_superadmin":    model.IsSuperadmin(user.Role),
			"is_staff_role":    model.IsStaffRole(user.Role),
		},
		"tokens": tokenPair,
		// Frontend isse padhke gate dikhata hai
		"security_setup_required": setupRequired,
		"security_setup":          setupStatus,
	})
}

// userIDFromEmailOrNil - device limit ke liye user ID nikalta hai
// (agar user nahi mila to nil - enforcement skip ho jati hai)
func userIDFromEmailOrNil(h *AuthHandler, ctx context.Context, email string) uuid.UUID {
	if user, err := h.authService.GetUserByEmailForSecurity(ctx, email); err == nil && user != nil {
		return user.ID
	}
	return uuid.Nil
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req model.RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	tokenPair, err := h.authService.RefreshToken(c.Request.Context(), &req)
	if err != nil {
		switch err {
		case service.ErrInvalidCredentials:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		case errors.New("refresh token expired"):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token expired"})
		case errors.New("refresh token not found or revoked"):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token not found or revoked"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token refresh failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tokens": tokenPair,
	})
}

// Logout: ek device ka token delete, aur kitni der laga.
//
// ---- RESPONSE ME KYA JATA HAI, AUR KYUN ----
//
// `deleted_refresh_tokens` aur `remaining_sessions` sirf decoration nahi hain.
// Ye DO numbers batate hain ki logout ne SAARE devices to nahi maare:
//
//	remaining_sessions > 0  -> doosre device ZINDA hai (sahi)
//	remaining_sessions == 0 -> har device logout (galat)
//
// Pehle yahan `RevokeAllByUserID` chalti thi, to ye number hamesha 0 hota
// aur koi dekh hi nahi paata tha ki ek device ka logout poore account ko
// maar raha hai. Ab number dikhta hai, to regression turant nazar aayegi.
func (h *AuthHandler) Logout(c *gin.Context) {
	raw := c.GetHeader("Authorization")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing authorization header"})
		return
	}
	if len(raw) > 7 && raw[:7] == "Bearer " {
		raw = raw[7:]
	}

	res, err := h.authService.Logout(c.Request.Context(), raw)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "logout failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":                "logged out successfully",
		"deleted_session":        res.SessionDeleted,
		"deleted_refresh_tokens": res.RefreshTokensDeleted,
		"remaining_sessions":     res.OtherSessionsRemaining,
		// Milliseconds, dbhi ke andar. User ko dikhta hai ki logout instant
		// tha ya nahi - ek slow logout aksar ek hung connection hota hai.
		"elapsed_ms": res.ElapsedMS,
	})
}

// FixPermissions - self-healing endpoint for users missing the creator role.
// This addresses users who registered before the auto-appointment fix was deployed.
// The creator role is required for channel.create, channel.edit, media.upload, etc.
// It's safe to call repeatedly - idempotent.
func (h *AuthHandler) FixPermissions(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := uuidFromString(uid)

	if h.rbac == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "rbac_unavailable",
			"message": "Authorization is not configured on this server.",
		})
		return
	}

	// Check if user already has creator role
	hasCreator, err := h.rbac.HasRole(c.Request.Context(), userID, "creator")
	if err != nil {
		log.Printf("[FIX_PERMISSIONS] HasRole check failed for %s: %v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check permissions"})
		return
	}

	if hasCreator {
		c.JSON(http.StatusOK, gin.H{
			"fixed":       false,
			"message":     "Permissions are already correct. You have the creator role.",
			"has_creator": true,
		})
		return
	}

	// Grant creator role
	roleID, lookupErr := h.rbac.RoleIDByName(c.Request.Context(), "creator")
	if lookupErr != nil {
		log.Printf("[FIX_PERMISSIONS] creator role lookup failed: %v", lookupErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "creator role not found"})
		return
	}

	_, appointErr := h.rbac.Appoint(
		c.Request.Context(), userID, userID, roleID,
		"self-healing: granted creator role via /me/fix-permissions",
		nil,
	)
	if appointErr != nil {
		log.Printf("[FIX_PERMISSIONS] appoint failed for %s: %v", uid, appointErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not grant creator role"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"fixed":       true,
		"message":     "Creator role granted. You can now create channels and upload content.",
		"has_creator": true,
	})
}

func (h *AuthHandler) SetupPIN(c *gin.Context) {
	userIDRaw := c.GetString("user_id")
	if userIDRaw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDRaw)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req model.PINSetupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if err := h.authService.SetupPIN(c.Request.Context(), userID, &req); err != nil {
		switch err {
		case errors.New("PIN already setup"):
			c.JSON(http.StatusConflict, gin.H{"error": "PIN already setup"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "PIN setup failed"})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "PIN setup successful"})
}

func (h *AuthHandler) VerifyPIN(c *gin.Context) {
	userIDRaw := c.GetString("user_id")
	if userIDRaw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDRaw)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req model.PINVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if err := h.authService.VerifyPIN(c.Request.Context(), userID, &req); err != nil {
		switch err {
		case errors.New("PIN not setup"):
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN not setup"})
		case service.ErrPINLocked:
			c.JSON(http.StatusLocked, gin.H{"error": "PIN is locked due to too many attempts"})
		case service.ErrInvalidPIN:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid PIN"})
		case service.ErrTooManyAttempts:
			c.JSON(http.StatusLocked, gin.H{"error": "too many PIN attempts, account locked"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "PIN verification failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "PIN verified successfully"})
}

func (h *AuthHandler) GetProfile(c *gin.Context) {
	userIDRaw := c.GetString("user_id")
	if userIDRaw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDRaw)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	user, err := h.authService.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":            user.ID,
		"email":         user.Email,
		"username":      user.Username,
		"full_name":     user.FullName,
		"is_active":     user.IsActive,
		"is_verified":   user.IsVerified,
		"last_login_at": user.LastLoginAt,
		"created_at":    user.CreatedAt,

		// `role` was MISSING here while the column existed on the user the whole
		// time. That is not a cosmetic gap - it broke authorisation somewhere
		// else entirely.
		//
		// The superadmin app's telemetry relay must answer "is this caller a
		// superadmin?" and it authenticates the token HERE, at the one service
		// that holds the signing key. With no `role` in this response it had no
		// trustworthy source, and defaulted to "not a superadmin" - so the
		// superadmin themselves were refused from their own console while the
		// check looked like it was working.
		//
		// Included deliberately rather than decoded from the JWT in the calling
		// app: an unverified claim is not a permission, and this endpoint's whole
		// value is that it is verified.
		//
		// Note this is the caller's OWN role, returned to the caller about
		// themselves - it exposes nothing about any other user.
		"role": user.Role,

		// The caller's OWN avatar, so every app shows the SAME picture.
		//
		// Without it the value sat in the database and nowhere else: one page read
		// it directly, the account menu in the web app and the editor read a
		// `/profile` that omitted it - so a person who HAD uploaded a photo was
		// shown letters almost everywhere and their face on one page.
		//
		// Safe to return: it is the caller's own avatar, in a response about the
		// caller. Deliberately NOT on any public channel payload, where
		// `contact_email` is the field that must never leak.
		"avatar_url": user.AvatarURL,
	})
}

// VerifyEmail handles GET /api/auth/verify?token=...
//
// Ye endpoint verification link click hone par call hota hai. Token valid hua
// to user is_verified=true ho jata hai, warna 400/404 return hota hai.
//
// Hinglish: link click handler - token verify karta hai
func (h *AuthHandler) VerifyEmail(c *gin.Context) {
	plainToken := c.Query("token")
	if plainToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing token"})
		return
	}

	user, err := h.authService.VerifyEmail(c.Request.Context(), plainToken)
	if err != nil {
		// Expired ya invalid token - user ko saaf message
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    "invalid or expired verification token",
			"verified": false,
		})
		return
	}

	// Success - plain English message (user-facing content, no Hinglish)
	c.JSON(http.StatusOK, gin.H{
		"verified": true,
		"email":    user.Email,
		"message":  "Your email address has been verified successfully.",
	})
}

// Middleware to validate access token
func (h *AuthHandler) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		accessToken := c.GetHeader("Authorization")
		if accessToken == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
			return
		}

		// Remove "Bearer " prefix if present
		if len(accessToken) > 7 && accessToken[:7] == "Bearer " {
			accessToken = accessToken[7:]
		}

		claims, err := h.authService.ValidateAccessToken(accessToken)
		if err != nil {
			switch err {
			case token.ErrExpiredToken:
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token expired"})
			default:
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			}
			return
		}

		// Check if session is still valid
		// Session ka data yahan use nahi ho raha, sirf existence check karna hai -
		// isliye result discard kar dete hain. Revoked session ho to 401 dete hain.
		// Hinglish: token valid hone ke baad bhi revoked session reject hota hai
		if _, err := h.authService.GetSessionByAccessToken(c.Request.Context(), accessToken); err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session not found or revoked"})
			return
		}

		// Check if user is still active
		user, err := h.authService.GetUserByID(c.Request.Context(), claims.UserID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
			return
		}

		if !user.IsActive {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "user account is inactive"})
			return
		}

		// Set user info in context
		c.Set("user_id", claims.UserID.String())
		c.Set("email", claims.Email)
		c.Set("session_id", claims.SessionID.String())
		// ---- ROLE (migration 006) ----
		//
		// BUG FIX: ye MISSING tha. `RequireSuperadmin` middleware `c.Get("role")`
		// se role padhta tha, par yahan role kabhi set hi nahi hota tha. Iska
		// asar: role gate CHAL hi nahi sakta tha - koi bhi user (superadmin
		// sameth) 403 "forbidden" chala jata tha.
		//
		// SECURITY: ye value token ke SIGNED claim se aati hai (AuthMiddleware
		// upar `jwtVerify` real secret ke saath kar chuka hai), isliye client
		// ise forge nahi kar sakta.
		//
		// NOTE: khaali/legacy token (purane tokens jisme role claim nahi tha)
		// ke liye ye `""` hoga - jo `IsSuperadmin("")` = false deta hai. Yaani
		// fail CLOSED: nahi pata to access nahi. Sahi behaviour.
		c.Set("role", claims.Role)
		c.Next()
	}
}

// ============================================================================
// ResendVerification - naya verification email bhejta hai
// ============================================================================
//
// KYUN YE ZAROORI HAI (real problem):
// Verification email 30-minute TTL wala hota hai. Agar user ne email miss
// kar diya, ya link expire ho gaya, ya network pe atak gaya - to uska account
// 30 min baad PURGE ho jata hai aur wapas REGISTER karna padta hai. Resend
// se woh 30-minute window dobara 30 min extend ho jaata hai bina naya
// account banaye.
//
// IMPORTANT SECURITY NOTE - koi bhi email enumeration nahi:
//
//	Ye handler KABHI nahi batata ki email exist karta hai ya nahi. Dono
//	cases me SAME 200 response jaata hai. Warna ye endpoint attacker ke liye
//	"is email par account hai ya nahi" check karne ka tool ban jayega.
//
// BEHAVIOUR:
//   - user nahi mila            -> generic 200 (kuch nahi hota)
//   - user already verified    -> generic 200 + note
//   - user verified nahi hai   -> purana token DELETE + naya token + email
//
// Purana token delete: `IssueVerificationToken` ke andar already hai
// (`verifRepo.DeleteByUserID` BEFORE create). Isliye "jo token use ho chuka
// hai wo bhi resend ke saath delete ho jaye" - ye requirement naturally
// satisfy ho jaati hai, koi extra kaam nahi karna pada.
//
// Hinglish comments: har block ka arth
func (h *AuthHandler) ResendVerification(c *gin.Context) {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}

	// ---- Generic response (email enumeration prevention) ----
	// Ye SAME payload har situation me jaayega, sirf ek `alreadyVerified`
	// flag jo user ko helpfully batata hai. Email EXISTENCE leak nahi hota.
	respondGeneric := func(alreadyVerified bool, ttl int) {
		msg := "If an unverified account exists for that address, a fresh verification email has been sent."
		if alreadyVerified {
			msg = "This account is already verified. You can log in now."
		}
		c.JSON(http.StatusOK, gin.H{
			"message":          msg,
			"already_verified": alreadyVerified,
			"ttl_minutes":      ttl,
		})
	}

	ctx := c.Request.Context()
	user, err := h.authService.GetUserByEmailForSecurity(ctx, email)
	if err != nil {
		// User nahi mila -> generic success. Email exist karta hai ya nahi,
		// ye attacker ko pata nahi chalega.
		//
		// ---- BUG FIX (critical): `return` ZAROORI tha ----
		// Pehle yahan `return respondGeneric(...)` tha. Ek TypeScript error
		// ("no value used as value") fix karte waqt `return` galti se hata
		// diya gaya tha, aur sirf `respondGeneric(...)` reh gaya.
		//
		// Uska asar: `respondGeneric` already 200 response likh deta hai, par
		// execution CONTINUE hota tha. Ab ye line padhta tha
		// `user.IsVerified` jab `user` nil hai (kyunki lookup fail hua) ->
		// NIL POINTER PANIC. Server panic log karta, user ko 200 milta -
		// par koi email bhi nahi jata, aur user ko pata bhi nahi chalta.
		//
		// Isliye ab `respondGeneric(...); return;` - dono statements alag.
		// (`return respondGeneric(...)` invalid TS hai kyunki wo function
		// koi value return nahi karti.)
		log.Printf("[RESEND] No unverified account found for %s (generic 200 returned, no email sent)", email)
		respondGeneric(false, int(h.authService.VerificationTTLMinutes()))
		return
	}

	// Already verified: naya email bhejne ki zaroorat nahi
	if user.IsVerified {
		log.Printf("[RESEND] Account %s is already verified - no email sent", email)
		respondGeneric(true, 0)
		return
	}

	// ---- Naya token issue karo (purana automatically delete hoga) ----
	// Ye wahi code path hai jo registration use karta hai, isliye TTL,
	// hashing, aur "old tokens delete" behaviour IDENTICAL hai.
	log.Printf("[RESEND] Unverified account found for %s - issuing fresh token + sending email", email)
	if err := h.authService.ResendVerificationForUser(ctx, user); err != nil {
		// Email bhejne me dikkat aayi. User ko pata chalna chahiye ki
		// retry kare, isliye 503 (temporary) return karte hain.
		log.Printf("[RESEND] FAILED to send for %s: %v", email, err)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "could not send verification email",
			"message": "Please try again in a moment.",
		})
		return
	}

	log.Printf("[RESEND] Email sent successfully to %s", email)
	respondGeneric(false, int(h.authService.VerificationTTLMinutes()))
}

// getenvStr reads an env var with a fallback.
//
// A tiny local helper rather than a package import: the services in this file
// use `os.Getenv` directly, and a mixed style is worse than either.
func getenvStr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func (h *AuthHandler) VerifyMFA(c *gin.Context) {
	var req model.MFAVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if h.mfaChallengeStore == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "mfa not available"})
		return
	}

	ch, err := h.mfaChallengeStore.Get(c.Request.Context(), req.ChallengeID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired challenge"})
		return
	}
	_ = h.mfaChallengeStore.Delete(c.Request.Context(), req.ChallengeID)

	ip, ua := clientIP(c.Request), c.Request.UserAgent()
	loginCtx := service.WithClientInfo(c.Request.Context(), ip, ua)

	// Verify PIN
	if h.authService != nil {
		// For simplicity, verify PIN via auth service's PIN verification logic
		// We can reuse existing PIN verification
		pinReq := &model.PINVerifyRequest{PIN: req.PIN}
		if err := h.authService.VerifyPIN(loginCtx, ch.UserID, pinReq); err != nil {
			switch err {
			case service.ErrPINLocked:
				c.JSON(http.StatusLocked, gin.H{"error": "PIN is locked due to too many attempts"})
			case service.ErrInvalidPIN:
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid PIN"})
			case service.ErrTooManyAttempts:
				c.JSON(http.StatusLocked, gin.H{"error": "too many PIN attempts, account locked"})
			default:
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid PIN"})
			}
			return
		}
	}

	// Get user and issue session via IssueSession
	user, err := h.authService.GetUserByID(loginCtx, ch.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		return
	}

	userOut, tokenPair, err := h.authService.IssueSession(loginCtx, user, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":          userOut.ID,
			"email":       userOut.Email,
			"username":    userOut.Username,
			"full_name":   userOut.FullName,
			"is_active":   userOut.IsActive,
			"is_verified": userOut.IsVerified,
			"last_login_at": userOut.LastLoginAt,
			"role":        userOut.Role,
		},
		"tokens": tokenPair,
	})
}
