package handler

// HTTP surface for acknowledging critical security alerts.
//
// -----------------------------------------------------------------------------
// THREE ROUTES, THREE DIFFERENT QUESTIONS
// -----------------------------------------------------------------------------
//
//	POST /admin/security/alerts/:id/acknowledge   "I have seen this"
//	GET  /admin/security/alerts/acknowledgements  "who has seen what"
//	GET  /admin/security/alerts/acknowledged      "which of THESE are already done"
//
// The third exists so the dashboard can decide whether a banner should be
// shouting without downloading the entire history. It returns a SET, and the
// service comment on `AcknowledgedEventIDs` explains why a count would be the
// wrong shape.
//
// -----------------------------------------------------------------------------
// ROUTE ORDER IS LOAD-BEARING IN GIN
// -----------------------------------------------------------------------------
//
// `acknowledgements` and `acknowledged` are registered BEFORE `/:id/...`. Gin
// matches on a first-match-wins trie, so a static segment registered after a
// wildcard is UNREACHABLE — and an unreachable route returns 404 rather than
// falling through, so the failure looks like the acknowledgement list simply does
// not exist.
//
// That is the same class of bug as the wildcard `/admin/superadmin` route in the
// frontend that shadowed the static sibling, documented in
// `updatedtodo.md` Session 17. It is recorded here because it is silent in both
// places: no warning, and a 404 that reads like "there are no acknowledgements".
//
// -----------------------------------------------------------------------------
// EVERYTHING HERE IS SUPERADMIN-GATED AT THE ROUTER
// -----------------------------------------------------------------------------
//
// Registered on the `sa` group, which already carries `AuthMiddleware` +
// `RequireSuperadmin` + `CheckRevoked`. Not re-checked per handler: a second
// check is a second thing to forget, and this file is the thing being forgotten.
//
// The ONE thing verified here rather than there is that the caller has an identity
// to record. `acknowledgeAlert` needs an email to write into the audit row, and a
// superadmin whose token lacks an `email` claim must fail loudly rather than write
// an anonymous acknowledgement — which would answer "was this reviewed?" with a
// confident yes and no way to check who.

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// registerSecurityAlertRoutes attaches the acknowledgement routes to a
// superadmin-only group.
func (h *SuperadminHandler) registerSecurityAlertRoutes(sa *gin.RouterGroup) {
	// ---- STATIC FIRST. See the route-order note above. ----
	sa.GET("/security/alerts/acknowledgements", h.listAlertAcknowledgements)
	sa.GET("/security/alerts/acknowledged", h.listAcknowledgedEventIDs)

	// ---- THEN the wildcard ----
	sa.POST("/security/alerts/:id/acknowledge", h.acknowledgeAlert)
}

// ackCallerEmail returns the verified caller's email for the audit row.
//
// From the TOKEN, never the body. A field named `acknowledged_by` that arrived in
// a request body would make the entire attribution feature forgeable: the whole
// point is a trustworthy record of who reviewed what, and a body field would let
// anyone write anyone else's name on it.
func ackCallerEmail(c *gin.Context) (string, bool) {
	raw, ok := c.Get("email")
	if !ok {
		return "", false
	}
	email, _ := raw.(string)
	email = strings.TrimSpace(email)
	if email == "" {
		return "", false
	}
	return email, true
}

// acknowledgeAlert records that the caller has seen a critical event.
func (h *SuperadminHandler) acknowledgeAlert(c *gin.Context) {
	eventID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_event_id",
			"message": "That is not a valid event id.",
		})
		return
	}

	// The audit row needs an author. A superadmin token without an email claim
	// cannot produce one, and writing a blank author would defeat the purpose.
	operator, ok := ackCallerEmail(c)
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "no_operator_identity",
			"message": "Your session carries no email claim, so the acknowledgement cannot be attributed. Sign in again.",
		})
		return
	}

	var req struct {
		Note string `json:"note"`
	}
	// A malformed body is not a reason to refuse: `note` is optional and the whole
	// acknowledgement is meaningful without it. Binding is best-effort here on
	// purpose — see the note in `AcknowledgeSecurityAlert` about a note being
	// where "false positive, office router" lives.
	_ = c.ShouldBindJSON(&req)

	ack, err := h.svc.AcknowledgeSecurityAlert(
		c.Request.Context(), eventID, operator, req.Note, c.ClientIP(),
	)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrAckAlreadyDone):
			// 409, not 400 and not 500. The state the operator wanted — "this is
			// recorded as seen" — is already true. An error dialog telling somebody
			// their click did not register is a worse outcome than the click being
			// redundant, and the UI treats this code as success.
			c.JSON(http.StatusConflict, gin.H{
				"error":     "already_acknowledged",
				"message":   "Somebody has already acknowledged this event.",
				"acknowledged": true,
			})
		case errors.Is(err, service.ErrAckNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "event_not_found",
				"message": "No such security event. It may have been archived by retention.",
			})
		default:
			// An empty operator identity reaches here. It is 403 in spirit, and
			// reported distinctly rather than as a generic failure, because it means
			// the token is malformed rather than the database being unhappy.
			if strings.Contains(err.Error(), "requires an operator identity") {
				c.JSON(http.StatusForbidden, gin.H{
					"error":   "no_operator_identity",
					"message": "The acknowledgement could not be attributed to a person.",
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not record acknowledgement"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"acknowledgement": ack,
		// Echoed so the client does not need to construct the timestamp itself.
		// The server clock is the record; a client-generated one would be
		// unverifiable and could be anything.
		"acknowledged_at": ack.AcknowledgedAt,
	})
}

// listAlertAcknowledgements returns the acknowledgement history, newest first.
func (h *SuperadminHandler) listAlertAcknowledgements(c *gin.Context) {
	limit := 0
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}

	rows, err := h.svc.ListSecurityAlertAcknowledgements(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not list acknowledgements"})
		return
	}

	// Non-nil so the client gets `[]`. A client doing `.length` on null throws, and
	// the failure surfaces as a crash rather than as "nobody has acknowledged
	// anything" — the same mistake `GetPrivilegeRegistry` documents at rbac.go.
	if rows == nil {
		rows = []model.AcknowledgementWithEvent{}
	}

	c.JSON(http.StatusOK, gin.H{
		"acknowledgements": rows,
		"count":           len(rows),
	})
}

// listAcknowledgedEventIDs answers "which of these are already done".
//
// A query parameter rather than a body, because it is a GET and the list is the
// input. Comma-separated so the dashboard can ask about exactly the critical
// events it is rendering rather than sending the whole audit log.
func (h *SuperadminHandler) listAcknowledgedEventIDs(c *gin.Context) {
	raw := strings.TrimSpace(c.Query("ids"))
	if raw == "" {
		c.JSON(http.StatusOK, gin.H{"acknowledged": []string{}})
		return
	}

	parts := strings.Split(raw, ",")
	if len(parts) > 500 {
		// Bounded. This endpoint's whole value is that it is cheap enough for the
		// dashboard to call on every poll; an unbounded list makes that untrue.
		parts = parts[:500]
	}

	ids := make([]uuid.UUID, 0, len(parts))
	// Malformed ids are SKIPPED rather than rejected.
	//
	// The caller is a browser assembling this list from event ids it already
	// holds, so a malformed entry is a client bug, and failing the whole request
	// over one bad value would leave the dashboard unable to render at all — which
	// is worse than not knowing about that one event.
	for _, p := range parts {
		if id, err := uuid.Parse(strings.TrimSpace(p)); err == nil {
			ids = append(ids, id)
		}
	}

	acked, err := h.svc.AcknowledgedEventIDs(c.Request.Context(), ids)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read acknowledgements"})
		return
	}

	out := make([]string, 0, len(acked))
	for id := range acked {
		out = append(out, id.String())
	}

	c.JSON(http.StatusOK, gin.H{"acknowledged": out, "count": len(out)})
}
