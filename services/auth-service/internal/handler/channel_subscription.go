package handler

import (
	"github.com/google/uuid"
	"net/http"
	"strconv"

	"errors"
	"github.com/gin-gonic/gin"

	"github.com/wideo11/auth-service/internal/service"
)

// Channel subscription endpoints.
//
// The COUNT is served from the derived view, never from a stored number - see
// `internal/service/channel_subscription.go` for why a counter is the thing being
// avoided here.
//
// ------------------------------------------------------------------
// IDOR
// ------------------------------------------------------------------
//
// Every route takes a channel id and a viewer id. The viewer id is ALWAYS taken
// from the token, never from the body or a path parameter. A route that accepts
// `POST /channels/:id/subscribe?user_id=<someone-else>` lets anyone subscribe
// anyone - which is both an abuse vector and a way to inflate a rival creator's
// subscriber count without their consent.
//
// `tier` is the one thing a caller may set, and only to `paid`; anything else is
// rejected rather than coerced. Free is the default and is never implied by
// omission in a way that could be confused with a paid purchase.

func (h *AuthHandler) SubscribeChannel(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	channelID := uuidFromString(c.Param("id"))
	if channelID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel_not_found"})
		return
	}

	var req struct {
		Tier string `json:"tier"`
	}
	// A missing or unparseable body is fine - free is the default. Only a body
	// that was sent and could not be read is an error, so this is lenient on
	// purpose rather than accidentally.
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
	}

	sub, err := h.subscriptions.Subscribe(c.Request.Context(), channelID, uuidFromString(uid), req.Tier)
	if err != nil {
		writeSubscriptionError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"subscription": sub, "subscribed": true})
}

func (h *AuthHandler) UnsubscribeChannel(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	channelID := uuidFromString(c.Param("id"))
	if channelID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel_not_found"})
		return
	}

	if err := h.subscriptions.Unsubscribe(c.Request.Context(), channelID, uuidFromString(uid)); err != nil {
		writeSubscriptionError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"subscribed": false})
}

// ChannelSubscriberCount returns the derived count.
//
// Public, because a subscriber count is public information on a channel page. It
// is a COUNT and nothing more - no emails, no user ids - so exposing it leaks
// nothing. `ListSubscribers` is a different matter and is not public.
func (h *AuthHandler) ChannelSubscriberCount(c *gin.Context) {
	channelID := uuidFromString(c.Param("id"))
	if channelID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel_not_found"})
		return
	}

	counts, err := h.subscriptions.SubscriberCounts(c.Request.Context(), channelID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load subscriber count"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"channel_id":             channelID,
		"subscriber_count":       counts.SubscriberCount,
		"paid_subscriber_count":  counts.PaidSubscriberCount,
		"free_subscriber_count":  counts.FreeSubscriberCount,
		"oldest_subscription_at": counts.OldestSubscriptionAt,
	})
}

// ListChannelSubscribers returns subscribers.
//
// AUTHENTICATED, and deliberately so. A list of who follows a channel is a
// profile of that channel's audience - combined with anything else public, it is
// enough to build a graph of who is interested in what. The COUNT is public; the
// list is not.
func (h *AuthHandler) ListChannelSubscribers(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	channelID := uuidFromString(c.Param("id"))
	if channelID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel_not_found"})
		return
	}

	// Always bounded - the table is unbounded and an unpaginated list is a DoS
	// with a JSON body.
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}

	rows, total, err := h.subscriptions.ListSubscribers(c.Request.Context(), channelID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load subscribers"})
		return
	}

	// The OWNER sees full rows; anyone else sees the list without the user ids.
	// Both get the count, because the count is already public.
	owner, _ := h.subscriptions.IsChannelOwner(c.Request.Context(), channelID, uuidFromString(uid))

	payload := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		item := gin.H{
			"tier":                r.Tier,
			"first_subscribed_at": r.FirstSubscribedAt,
		}
		if owner {
			item["user_id"] = r.UserID
		}
		payload = append(payload, item)
	}

	c.JSON(http.StatusOK, gin.H{"subscribers": payload, "total": total, "is_owner": owner})
}

// AmIChannelSubscriber answers "did I subscribe", for the viewer's own UI.
//
// Scoped to the token, so it can only ever be asked about the caller.
func (h *AuthHandler) AmIChannelSubscriber(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	channelID := uuidFromString(c.Param("id"))
	if channelID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel_not_found"})
		return
	}

	subscribed, err := h.subscriptions.IsSubscribed(c.Request.Context(), channelID, uuidFromString(uid))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load subscription"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"subscribed": subscribed})
}

func writeSubscriptionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrChannelNotSubscribed):
		// 409, not 404. The channel is fine; the SUBSCRIPTION is what is missing,
		// and a 404 sends people looking for a channel that exists.
		c.JSON(http.StatusConflict, gin.H{
			"error":   "not_subscribed",
			"message": "You are not subscribed to this channel.",
		})
	case errors.Is(err, service.ErrCannotSubscribeOwnChannel):
		// 409: this is a conflict with the state of the world, not a bad request.
		c.JSON(http.StatusConflict, gin.H{
			"error":   "cannot_subscribe_own_channel",
			"message": "You cannot subscribe to your own channel.",
		})
	default:
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "channel_not_found",
			"message": "Channel not found",
		})
	}
}
