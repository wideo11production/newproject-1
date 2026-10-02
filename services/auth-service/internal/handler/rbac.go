package handler

// =============================================================================
// WHO MAY DO WHAT - the registry, and the middleware that enforces it
// =============================================================================
//
// Migration 017 created `appointments`, `roles`, `permissions`,
// `role_permissions` and the `privilege_registry` view. `service_access.go` and
// `rbac.go` read them. Nothing constructed either.
//
// This file is the HTTP surface that makes the whole thing reachable: one
// read-only registry endpoint for a superadmin, and two middleware that answer
// "may this caller do this" for a handler.
//
// =============================================================================
// WHY THE REGISTRY IS SUPERADMIN-ONLY, AND WHY IT IS NOT JUST A PERMISSION
// =============================================================================
//
// `privilege_registry` is a union of every appointment and every superadmin slot.
// So the response is a COMPLETE map of who holds what across the platform - which
// is exactly the list you would want before deciding whose account to target.
//
// It is not merely "sensitive because it is about people". It is a target list
// that includes the accounts able to read it. So the check is superadmin, it runs
// server-side, and it runs BEFORE the query rather than being trusted to the
// client.
//
// =============================================================================
// WHY `requirePermission` AND NOT `requireRole`
// =============================================================================
//
// Because a role name is a string somebody typed, and a permission is a specific
// capability. `requireRole("billing_admin")` grants everything that role will
// ever be given; `requirePermission("billing.read_invoices")` grants one thing.
//
// The role is still the unit of ASSIGNMENT - `Appoint` takes a role, and the role
// carries its permissions. But the unit of ENFORCEMENT is the permission, because
// that is the unit a new permission can be added without silently widening every
// role that shares the old one's name.
//
// =============================================================================

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// SetRBAC attaches the authorization services.
//
// Separate from the constructor because `main.go` builds the handler before it has
// a database, and threading two more dependencies through every constructor call
// to keep that ordering would be a large diff for no benefit. The nil check in
// `requirePermission` is what makes the alternative safe: an app that forgets this
// call REFUSES privileged routes rather than allowing them.
func (h *AuthHandler) SetRBAC(r *service.RBAC, access *service.ServiceAccess) {
	h.rbac = r
	h.serviceAccess = access
}

// ---------------------------------------------------------------------------
// GET /api/v1/auth/admin/registry  -  who holds what, across the platform
// ---------------------------------------------------------------------------
//
// SUPERADMIN ONLY. The check runs before the query, server-side.
func (h *AuthHandler) GetPrivilegeRegistry(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	if h.serviceAccess == nil {
		// Fail CLOSED.
		//
		// The alternative - allowing the request - turns "somebody forgot to call
		// SetRBAC" into "everybody can see the permission map". The nil case is a
		// wiring bug, and it must read as a 503 rather than as permission.
		log.Printf("[RBAC] registry requested but no ServiceAccess is wired")
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "rbac_unavailable",
			"message": "Authorization is not configured on this server.",
		})
		return
	}

	isSuper, err := h.serviceAccess.IsSuperAdmin(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		log.Printf("[RBAC] IsSuperAdmin failed for %s: %v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read privileges"})
		return
	}
	if !isSuper {
		// 403, not 404 - the caller already knows who they are, so pretending the
		// endpoint does not exist buys nothing and hides a real configuration bug
		// from the person who can fix it.
		//
		// (Contrast the channel handlers, where 404 IS right: there the resource's
		// existence is itself the secret.)
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "Only a superadmin can read the privilege registry.",
		})
		return
	}

	rows, err := h.rbac.Registry(c.Request.Context())
	if err != nil {
		log.Printf("[RBAC] registry query failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read privileges"})
		return
	}
	if rows == nil {
		// An empty, NON-nil slice, so the JSON is `[]` rather than `null`.
		//
		// A frontend doing `registry.length` on `null` throws, and the bug surfaces
		// as a client crash rather than as "there are no privileges yet" - which is
		// the one thing the superadmin needed to be told.
		rows = []model.PrivilegeRow{}
	}

	c.JSON(http.StatusOK, gin.H{
		"registry": rows,
		"count":    len(rows),
	})
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// requirePermission returns a middleware that admits only callers holding the
// named permission.
//
// Used as `protected.GET("/x", h.requirePermission("billing.read_invoices"), h.X)`
// rather than inside a handler, so the refusal happens before the handler runs -
// a handler that forgets to call the check cannot leak.
//
// SUPERADMIN BYPASS, and that is stated rather than implied: a superadmin is the
// platform's break-glass account and is expected to be able to administer every
// capability. The bypass is `IsSuperAdmin` on the DATABASE, not a role claim on
// the token, so it reflects a revoked slot within one request rather than at token
// expiry.
func (h *AuthHandler) requirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid, ok := userIDFromToken(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}

		if h.rbac == nil || h.serviceAccess == nil {
			// Fail CLOSED. See `SetRBAC` - an unwired authorization layer must read
			// as unavailable, never as permitted.
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "rbac_unavailable",
				"message": "Authorization is not configured on this server.",
			})
			c.Abort()
			return
		}

		userID := uuidFromString(uid)

		isSuper, err := h.serviceAccess.IsSuperAdmin(c.Request.Context(), userID)
		if err != nil {
			log.Printf("[RBAC] IsSuperAdmin failed for %s: %v", uid, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check permission"})
			c.Abort()
			return
		}
		if isSuper {
			c.Next()
			return
		}

		allowed, err := h.rbac.Can(c.Request.Context(), userID, permission)
		if err != nil {
			log.Printf("[RBAC] Can(%q) failed for %s: %v", permission, uid, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check permission"})
			c.Abort()
			return
		}
		if !allowed {
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You do not have the '" + permission + "' capability.",
				// The permission name is echoed because the caller is authenticated
				// and is being told what they asked for. It is NOT a secret - it is
				// the same string that appears in the registry they cannot read, and
				// hiding it would only make the 403 harder to act on.
				"permission": permission,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// requireService admits callers who have been granted access to one of the
// eight apps in migration 017's slug allowlist.
//
// This is the SECOND gate, and the two answer different questions:
//
//	requireService   "may this person OPEN this app"        (session 17 piece 5)
//	requirePermission "may this person DO this thing"        (granular capability)
//
// Having both is deliberate. A service grant is how a user gets into an app at
// all; a permission is what they may do once inside. Collapsing them would mean
// either "any user who opens billing can read invoices" or "nobody without an
// explicit permission can open billing", and both are wrong.
func (h *AuthHandler) requireService(serviceSlug string) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid, ok := userIDFromToken(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}

		if h.serviceAccess == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "rbac_unavailable",
				"message": "Authorization is not configured on this server.",
			})
			c.Abort()
			return
		}

		userID := uuidFromString(uid)

		// A superadmin holds every service. Without this, an administrator would
		// be locked out of the very tools needed to grant themselves access -
		// a deadlock that only shows up in production.
		isSuper, err := h.serviceAccess.IsSuperAdmin(c.Request.Context(), userID)
		if err != nil {
			log.Printf("[RBAC] IsSuperAdmin failed for %s: %v", uid, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check access"})
			c.Abort()
			return
		}
		if isSuper {
			c.Next()
			return
		}

		// `CanUse` FAILS CLOSED: an unknown slug is an error, not a pass. The slug
		// list is a CHECK constraint in the database, so an unrecognised value is a
		// caller bug - and answering "allowed" for one would turn a typo into an
		// open door.
		if err := h.serviceAccess.CanUse(c.Request.Context(), userID, serviceSlug); err != nil {
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "service_not_granted",
				"message": "You do not have access to " + serviceSlug + ".",
				"service": serviceSlug,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// GrantService lets a superadmin grant one of the eight apps to a user.
//
// Separate from `requirePermission` rather than a permission-gated route, because
// ADMINISTERING access must not itself be a grantable permission: a permission
// model where "grant permissions" is an ordinary permission has no root, and the
// first time it is delegated it is delegated to somebody who can then grant
// themselves anything.
func (h *AuthHandler) GrantService(c *gin.Context) {
	h.mutateServiceAccess(c, "grant")
}

// RevokeService is the inverse.
func (h *AuthHandler) RevokeService(c *gin.Context) {
	h.mutateServiceAccess(c, "revoke")
}

func (h *AuthHandler) mutateServiceAccess(c *gin.Context, action string) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if h.serviceAccess == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "rbac_unavailable"})
		return
	}

	granter := uuidFromString(uid)
	isSuper, err := h.serviceAccess.IsSuperAdmin(c.Request.Context(), granter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check access"})
		return
	}
	if !isSuper {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "Only a superadmin can change service access.",
		})
		return
	}

	var req struct {
		UserID   uuid.UUID `json:"user_id"`
		Service  string    `json:"service"`
		Reason   string    `json:"reason"`
		GrantRev string    `json:"grant_to"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "user_id, service and reason are required",
		})
		return
	}

	// ---- Validate before acting ----
	//
	// The target user id comes from the BODY, which is why ownership cannot be
	// assumed: this is an administrative action on an arbitrary account. That is
	// why it is superadmin-gated AND why the target is verified to exist before
	// the write, rather than letting a foreign-key error surface as a 500.
	//
	// The lookup goes through `UserExists` rather than a `*gorm.DB` on the handler:
	// `AuthHandler` deliberately has no database handle, and adding one for a single
	// existence check would give every handler in the package direct, unmediated
	// access to the database.
	exists, err := h.serviceAccess.UserExists(c.Request.Context(), req.UserID)
	if err != nil {
		log.Printf("[RBAC] user lookup for %s failed: %v", req.UserID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read that user"})
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "user_not_found",
			"message": "No such user.",
		})
		return
	}

	if strings.TrimSpace(req.Reason) == "" {
		// Required, not optional. An access change with no recorded reason is
		// indistinguishable from one that never happened, and the audit table is the
		// only place anyone will look.
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "reason_required",
			"message": "A reason is required and is stored with the change.",
		})
		return
	}

	switch action {
	case "grant":
		g := granter
		if err := h.serviceAccess.Grant(
			c.Request.Context(), req.UserID, req.Service, &g, req.Reason,
		); err != nil {
			log.Printf("[RBAC] Grant(%s, %s) failed: %v", req.UserID, req.Service, err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "grant_failed", "message": err.Error()})
			return
		}
	case "revoke":
		if err := h.serviceAccess.Revoke(
			c.Request.Context(), req.UserID, req.Service, req.Reason,
		); err != nil {
			log.Printf("[RBAC] Revoke(%s, %s) failed: %v", req.UserID, req.Service, err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "revoke_failed", "message": err.Error()})
			return
		}
	}

	services, err := h.serviceAccess.ServicesFor(c.Request.Context(), req.UserID)
	if err != nil {
		log.Printf("[RBAC] ServicesFor(%s) failed after %s: %v", req.UserID, action, err)
	}
	if services == nil {
		services = []string{}
	}
	c.JSON(http.StatusOK, gin.H{
		"user_id":  req.UserID,
		"services": services,
	})
}

// MyServices is the caller's own granted apps.
//
// This is the endpoint the DASHBOARD uses as its service selector, and it is why
// the answer has to be SERVER-derived. A client deciding which apps to show is a
// client that can be edited to show all of them - and the UI hiding a button is
// not the same as the API refusing the request behind it.
func (h *AuthHandler) MyServices(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if h.serviceAccess == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "rbac_unavailable"})
		return
	}

	services, err := h.serviceAccess.ServicesFor(c.Request.Context(), uuidFromString(uid))
	if err != nil {
		log.Printf("[RBAC] ServicesFor(%s) failed: %v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read services"})
		return
	}
	if services == nil {
		services = []string{}
	}

	// The catalogue is sent WITH the grants, not just the grants.
	//
	// A dashboard that renders only the granted list cannot show a creator what
	// exists and they do not have - which is the entire reason a service selector
	// is worth having. The slug list is the server's, so the UI cannot offer an
	// app that is not a real one.
	c.JSON(http.StatusOK, gin.H{
		"services": services,
		"catalog":  service.AllServices,
	})
}
