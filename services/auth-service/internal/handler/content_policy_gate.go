package handler

// ============================================================================
// CONTENT UPLOAD POLICY GATE
// ============================================================================
//
// `settings.content_upload_enabled` (migration 007) ke saath ek AUTHZ check
// bhi hona chahiye - aur pehle sirf UI hint thi. User toggle OFF kar ke bhi
// API seedhe call karke presigned URL nikal sakta tha, kyunki koi handler
// `RequireContentUpload` call nahi karta tha.
//
// `internal/service/content_policy.go` ye policy pehle se likhi hui thi par
// kabhi wire nahi hui. Ye file uska gate hai.
//
// ---- WHY A SEPARATE FILE AND NOT ONE HELPER INSIDE EACH HANDLER ----
// Ye check chaar jagah lagti hai (avatar upload-url, avatar finalize, cover
// upload-url, cover finalize). Agar har handler me inline likhte to:
//   - chauthe copy me `err != nil` wala fail-open case miss ho jaata
//   - reason/message mapping har jagah alag ho jaati
// Ek jagah rehne se "kya blocked hai" ka ek hi jawab milta hai.
//
// ---- ORDERING (ye sahi order zaroori hai) ----
// Gate hamesha authentication ke BAAD aur kisi bhi SIDE EFFECT se PEHLE
// chalta hai:
//   - mints a presigned URL?      NO - tab tak object store me kuch nahi
//   - writes a DB row?            NO
//   - verifies ownership?         after gate, so the policy verdict is not
//                                  also an existence oracle
// Upar wali ordering ulti karne se blocked user ko "channel exist karta
// hai" ya "storage configured nahi" jaisa signal mil jata tha - dono
// information leak hain.
//
// ---- WHY FAIL CLOSED ----
// DB error (infra) par `RequireContentUpload` ek decision BHI aur err BHI
// deta hai. Yahan err ko 500 me convert karte hain, decision ko ignore:
// upload allow karna unsafe hai jab hum jaante hi nahi ki settings kya hain.

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/service"
)

// requireContentUpload is the single gate for every content-upload entry
// point. It writes the response and returns false when the request must not
// proceed, so callers read as a single early return:
//
//	if !h.requireContentUpload(c) { return }
//
// The response body carries `reason` and `message` from the policy, which
// is what /api/v1/auth/settings already returns in
// `content_upload_allowed` / `content_upload_reason`. Using the same fields
// means the settings screen can explain a refusal without a second,
// differently-named API.
func (h *AuthHandler) requireContentUpload(c *gin.Context) bool {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return false
	}

	decision, err := h.authService.RequireContentUpload(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		// Infra failure. Say nothing about why - "the database is down" tells
		// an attacker they can retry blindly and fingerprints the stack.
		// 500 not 403: the user did nothing wrong and retrying may work.
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "upload_unavailable",
			"message": "Could not verify upload permissions. Please try again.",
		})
		return false
	}
	if decision == nil || decision.Allowed {
		return true
	}

	c.JSON(service.StatusCodeForDecision(*decision), gin.H{
		"error":   string(decision.Reason),
		"reason":  string(decision.Reason),
		"message": decision.Message,
	})
	return false
}
