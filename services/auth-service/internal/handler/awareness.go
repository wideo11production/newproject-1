package handler

// ============================================================================
// AWARENESS HANDLERS  -  superadmin real-user grid
// ============================================================================
//
// Endpoints (sirf superadmin):
//   GET /api/v1/auth/admin/awareness      - aggregated overview
//   GET /api/v1/auth/admin/registrations  - recent real registrations list
//
// NOTE: pehle yahan `/api/v1/admin/...` likha tha - `/auth` segment missing.
// Galat hi hai: ye group `auth` (= /api/v1/auth) ke andar banta hai
// (`RegisterAwarenessRoutes(auth)`), to asli prefix `/api/v1/auth/admin/`
// hai. Galat comment padh kar 404 aata hai, aur woh 403 (denied) se bilkul
// alag dikhta hai - 403 matlab "access nahi mila", 404 matlab "route hai hi
// nahi", yaani bug ho sakta hai nahi ke aapko permission nahi mili.
// Documentation yahan authorization surface hai, isliye sahi honi zaroori hai.
//
// SECURITY - TRIPLE GATE:
//   1. AuthMiddleware  - valid session (bina token = 401)
//   2. RequireSuperadmin - role claim SIGNED hona chahiye (role mismatch = 403)
//   3. Handler me bhi role verify (defence in depth, agar route group
//      misconfigure ho to bhi data leak na ho)
//
// Yaad dilana: ye REAL aggregated data hai. Koi dummy/demo/mock row nahi.
// Jahan geo header nahi tha, wahan country KHAALI dikhegi - ye sahi hai.

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// RequireSuperadmin - role claim check karta hai.
//
// SECURITY: ye tabhi sahi hai jab token SIGNED ho (AuthMiddleware pehle hi
// `jwtVerify` kar chuka hota hai real secret ke saath). Isi liye ye
// AuthMiddleware ke BAAD hi lagana zaroori hai - bina signature verification
// ke ye check meaningless hoga (client role claim khud bhej sakta).
func RequireSuperadmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, ok := c.Get("role")
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "forbidden",
			})
			return
		}
		role, _ := raw.(string)
		if !model.IsSuperadmin(role) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "This area is restricted to superadmins.",
			})
			return
		}
		c.Next()
	}
}

// superadminFromContext - handler level defence-in-depth check.
//
// Kyun? Route group me middleware lagana ho sakta hai bhool jaayein
// (future me koi naya route add kare). Ye har sensitive handler me call
// hota hai, isliye ek bhool bhi data leak nahi kar sakta.
func superadminFromContext(c *gin.Context) (uuid.UUID, bool) {
	raw, ok := c.Get("user_id")
	if !ok {
		return uuid.Nil, false
	}
	s, ok := raw.(string)
	if !ok {
		return uuid.Nil, false
	}
	role := c.GetString("role")
	if !model.IsSuperadmin(role) {
		return uuid.Nil, false
	}
	uid, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, false
	}
	return uid, true
}

// AwarenessOverview - superadmin dashboard ka REAL data summary
func (h *AuthHandler) AwarenessOverview(c *gin.Context) {
	if _, ok := superadminFromContext(c); !ok {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "This area is restricted to superadmins.",
		})
		return
	}

	overview, err := h.authService.GetAwarenessOverview(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "could not build the awareness overview",
		})
		return
	}
	c.JSON(http.StatusOK, overview)
}

// RecentRegistrations - naye REAL registrations ki live list
func (h *AuthHandler) RecentRegistrations(c *gin.Context) {
	if _, ok := superadminFromContext(c); !ok {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "This area is restricted to superadmins.",
		})
		return
	}

	// Limit: query param se, par CLAMPED (200 max) - abuse + accidental
	// `?limit=100000` se memory/DB dono safe rehte hain.
	limit := 50
	if q := c.Query("limit"); q != "" {
		if parsed, err := strconv.Atoi(q); err == nil {
			limit = parsed
		}
	}

	rows, err := h.authService.ListRecentRegistrations(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "could not load registrations",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"registrations": rows,
		"count":         len(rows),
	})
}

// RegisterAwarenessRoutes superadmin awareness endpoints register karta hai.
//
// Alag function isliye ki ye routes AuthHandler ke saath baithen (na ki
// SuperadminHandler ke), aur role gate BHI lage - to route bhool jaye
// to bhi data leak na ho.
func (h *AuthHandler) RegisterAwarenessRoutes(r *gin.RouterGroup) {
	admin := r.Group("/admin")
	// Layer 1: valid session
	admin.Use(h.AuthMiddleware())
	// Layer 2: role must be superadmin (SIGNED claim pe based)
	admin.Use(RequireSuperadmin())

	// ---- REAL aggregated data (no dummy rows) ----
	admin.GET("/awareness", h.AwarenessOverview)
	// ---- Recent real registrations (live list) ----
	admin.GET("/registrations", h.RecentRegistrations)
}
