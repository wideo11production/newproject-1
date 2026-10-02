package handler

// =============================================================================
// CHANNEL SETUP - STEP 2 handlers
// =============================================================================
//
// The HTTP surface for `UpdateChannelSetup`. Four endpoints, and the split
// matters:
//
//   GET  /channels/:id/setup          - read the current state
//   PATCH /channels/:id/setup         - save (partial, any section)
//   GET  /channels/setup/pending      - "which channel do I have to finish?"
//   POST /channels/:id/logo/*        - the logo's three-step upload
//
// WHY `PATCH` AND NOT `POST`
//
// Step 2 saves as the creator moves between sections, so partial updates are the
// NORMAL case, not an exception. `POST` would mean "this is the whole object",
// and a form that saves one section at a time would then need to send everything
// every time - and would clobber anything another tab changed.
//
// =============================================================================
// THE ORDER OF THE CHECKS IN EVERY WRITE HANDLER
// =============================================================================
//
//   1. token present?                       -> 401
//   2. the id in the URL is a UUID?         -> 400
//   3. the channel is THIS user's?          -> 404 (never 403)
//   4. the content-upload policy?           -> 403
//   5. validate the payload                 -> 400 naming the field
//   6. write
//
// Step 3 BEFORE step 4, deliberately, and it is the reverse of what reads
// naturally. A policy refusal that also said "not your channel" would be a way to
// discover which channel ids exist; a 403 that arrives only for channels you own
// tells the caller nothing they did not already know.
//
// Step 3 returns 404 and not 403 for the same reason: 403 confirms the channel
// EXISTS, and channel ids are guessable UUIDs only in the sense that a leak
// anywhere makes them enumerable.

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// channelSetupView is what the step-2 screen is rendered from.
//
// A DTO rather than the raw model, for two reasons: the model carries
// `ContactEmail`, which is PRIVATE and must never leave the service, and the
// screen needs the brand colour RESOLVED rather than as a hue the client has to
// know how to interpret.
//
// Sending the palette from the server means the client cannot invent a colour the
// platform never offered, and there is one definition of "what does hue 206 look
// like" instead of one per app.
type channelSetupView struct {
	ID          uuid.UUID `json:"id"`
	Handle      string    `json:"handle"`
	DisplayName string    `json:"display_name"`
	Tagline     string    `json:"tagline"`

	CoverURL string `json:"cover_url"`
	LogoURL  string `json:"logo_url"`

	// The hue, as stored. NULL means the platform default is in use.
	BrandHue *int `json:"brand_hue"`
	// The resolved colour, so the preview matches what a visitor will see.
	Brand service.BrandPalette `json:"brand"`

	Visibility  string `json:"visibility"`
	ChannelType string `json:"channel_type,omitempty"`
	Keywords    string `json:"keywords,omitempty"`

	CommentsEnabled  bool   `json:"comments_enabled"`
	CommentPolicy    string `json:"comment_policy"`
	KidsAutoClassify bool   `json:"kids_auto_classify"`
	WatermarkEnabled bool   `json:"watermark_enabled"`

	SetupComplete    bool    `json:"setup_complete"`
	SetupCompletedAt *string `json:"setup_completed_at,omitempty"`
}

func newChannelSetupView(c *model.Channel) channelSetupView {
	v := channelSetupView{
		ID:               c.ID,
		Handle:           c.Handle,
		DisplayName:      c.DisplayName,
		Tagline:          c.Tagline,
		CoverURL:         c.CoverURL,
		LogoURL:          c.LogoURL,
		BrandHue:         c.BrandHue,
		Brand:            service.BrandFor(c.BrandHue),
		Visibility:       service.EffectiveVisibility(c),
		CommentsEnabled:  c.CommentsEnabled,
		CommentPolicy:    c.CommentPolicy,
		KidsAutoClassify: c.KidsAutoClassify,
		WatermarkEnabled: c.WatermarkEnabled,
		SetupComplete:    c.SetupStep2At != nil,
	}
	if c.ChannelType != nil {
		v.ChannelType = *c.ChannelType
	}
	if c.Keywords != nil {
		v.Keywords = *c.Keywords
	}
	if c.SetupStep2At != nil {
		s := c.SetupStep2At.UTC().Format("2006-01-02T15:04:05Z")
		v.SetupCompletedAt = &s
	}
	return v
}

// ownedChannelID resolves `:id` and proves the channel is the caller's.
//
// Returns uuid.Nil after writing the response, so a caller can write
// `if id == uuid.Nil { return }` and cannot forget to return.
func (h *AuthHandler) ownedChannelID(c *gin.Context) uuid.UUID {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return uuid.Nil
	}
	channelID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_channel_id",
			"message": "channel id must be a UUID",
		})
		return uuid.Nil
	}
	// `GetChannelByID` filters on `id AND user_id`. Not found and not-yours are
	// the same empty result, so the same 404 comes out of both.
	if _, err := h.authService.GetChannelByID(
		c.Request.Context(), uuidFromString(uid), channelID,
	); err != nil {
		writeChannelError(c, err)
		return uuid.Nil
	}
	return channelID
}

// GetChannelSetup returns the step-2 state for one channel.
func (h *AuthHandler) GetChannelSetup(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	channelID := h.ownedChannelID(c)
	if channelID == uuid.Nil {
		return
	}

	ch, err := h.authService.GetChannelByID(
		c.Request.Context(), uuidFromString(uid), channelID,
	)
	if err != nil {
		writeChannelError(c, err)
		return
	}

	// The palette is sent with the state, so the picker and the preview cannot
	// disagree about which colour is which.
	colors := make([]gin.H, 0, len(service.BrandColors))
	for _, col := range service.BrandColors {
		colors = append(colors, gin.H{
			"name":       col.Name,
			"hue":        col.Hue,
			"saturation": col.Saturation,
			"lightness":  col.Lightness,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"channel":      newChannelSetupView(ch),
		"brand_colors": colors,
		"default_hue":  service.DefaultBrandHue,
		// The limit comes from the server, which is the only authority on it.
		//
		// It is in the upload ticket too, but a form that renders its own
		// size message from a hardcoded constant is how the create-time cover
		// ended up allowing 6 MB against a 4 MB rule - the file uploaded in full
		// and was refused only at the end.
		"max_logo_bytes": config.MaxLogoBytes,
	})
}

// UpdateChannelSetup saves step 2.
func (h *AuthHandler) UpdateChannelSetup(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	channelID := h.ownedChannelID(c)
	if channelID == uuid.Nil {
		return
	}

	// The upload policy gate applies here for the same reason it applies to cover
	// uploads: setting a logo is an upload, and a creator who has turned content
	// uploads off has said they do not want files landing in their account.
	//
	// AFTER the ownership check, so a refusal is not also an existence oracle.
	if !h.requireContentUpload(c) {
		return
	}

	var req model.UpdateChannelSetupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Named, not "invalid request": the client sent a shape we cannot read,
		// and saying which endpoint helps more than saying "invalid".
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "the setup payload could not be read",
		})
		return
	}

	updated, err := h.authService.UpdateChannelSetup(
		c.Request.Context(), uuidFromString(uid), channelID, &req,
	)
	if err != nil {
		// A 400 naming the field, not a 500. These are wizard answers, not server
		// faults, and a 500 tells the creator to retry something that will never
		// succeed.
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_setup",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"channel": newChannelSetupView(updated)})
}

// PendingChannelSetup answers "which channel do I have to finish?".
//
// THIS IS THE GATE'S DATA SOURCE, and it is a server query on purpose. A client
// that decided for itself whether setup was needed is a client that can be
// convinced it is not - by editing a request body, or by not asking.
//
// `channel_id` is uuid.Nil and `needs_setup` is false when there is nothing to
// do, which is the shape a caller can branch on without a null check.
func (h *AuthHandler) PendingChannelSetup(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := uuidFromString(uid)

	id, err := h.authService.ChannelNeedingSetup(c.Request.Context(), userID)
	if err != nil {
		// LOGGED, not swallowed.
		//
		// The first version answered a flat `setup_status_unavailable` and returned,
		// with the error discarded. The endpoint then 500'd for every creator and the
		// only evidence anywhere was a 500 in the request log with an EMPTY `error`
		// field - which is indistinguishable from a database outage and points at
		// nothing at all.
		//
		// A generic error code is right for the caller. It is not a reason to throw
		// away the only copy of the cause.
		log.Printf("[CHANNEL SETUP] could not read pending setup for user %s: %v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "setup_status_unavailable",
			"message": "Could not check channel setup status. Please retry.",
		})
		return
	}
	pending, err := h.authService.CountChannelsNeedingSetup(c.Request.Context(), userID)
	if err != nil {
		log.Printf("[CHANNEL SETUP] could not count pending setup for user %s: %v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "setup_status_unavailable",
			"message": "Could not check channel setup status. Please retry.",
		})
		return
	}

	out := gin.H{"needs_setup": id != uuid.Nil, "pending": pending}
	// Omitted rather than null when there is nothing pending, so a caller doing
	// `if (body.channel_id)` behaves the same in every language.
	if id != uuid.Nil {
		out["channel_id"] = id
	}
	c.JSON(http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// The channel LOGO - the same three steps as a cover
// ---------------------------------------------------------------------------
//
// A logo is a separate asset from the cover (square vs wide) with its own byte
// budget, so it gets its own endpoints rather than a `kind` parameter on the
// cover ones. A `?kind=logo` parameter would be one handler with two security
// profiles, and the branch that is wrong is the one nobody reads.

// LogoUploadURL - step 1, the presigned PUT.
func (h *AuthHandler) LogoUploadURL(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	channelID := h.ownedChannelID(c)
	if channelID == uuid.Nil {
		return
	}
	if !h.requireContentUpload(c) {
		return
	}

	var req struct {
		Filename    string `json:"filename"`
		ContentType string `json:"contentType"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if h.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "upload_unavailable",
			"message": "File uploads are not configured on this server.",
		})
		return
	}

	ticket, err := h.storage.CreateLogoUploadTicket(
		c.Request.Context(), uuidFromString(uid), req.Filename, req.ContentType,
	)
	if err != nil {
		msg := err.Error()
		status := http.StatusBadRequest
		if strings.Contains(msg, "credentials missing") {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"error": "invalid_upload", "message": msg})
		return
	}

	c.JSON(http.StatusOK, ticket)
}

// LogoFinalize - step 3: verify the bytes and SAVE onto the channel.
//
// Unlike the cover's finalize-for-create, this one saves immediately, because by
// the time a creator uploads a logo the channel exists. There is no pending state
// to hand back to a form, and deferring the write would leave a stored object
// that nothing references if the creator navigated away.
func (h *AuthHandler) LogoFinalize(c *gin.Context) {
	uid, ok := userIDFromToken(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	channelID := h.ownedChannelID(c)
	if channelID == uuid.Nil {
		return
	}
	// Re-checked, not just checked at step 1: the presigned URL stays valid for
	// STORAGE_PRESIGN_TTL_MINUTES, so gating only the mint would let an upload
	// that was already in flight land after the policy was turned off.
	if !h.requireContentUpload(c) {
		return
	}

	var req struct {
		ObjectKey string `json:"objectKey"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if h.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "upload_unavailable",
			"message": "File uploads are not configured on this server.",
		})
		return
	}

	// Existence, size, MAGIC BYTES, forced content type. Same helper as avatars
	// and covers, so an HTML file with a .png name dies here rather than in
	// somebody's browser.
	publicURL, err := h.storage.FinalizeLogoUpload(
		c.Request.Context(), uuidFromString(uid), req.ObjectKey,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "upload_failed",
			"message": err.Error(),
		})
		return
	}

	// Replace AFTER the new one is verified: a failed replacement then leaves the
	// creator with the logo they already had, rather than with none.
	if existing, err := h.authService.GetChannelByID(
		c.Request.Context(), uuidFromString(uid), channelID,
	); err == nil && existing.LogoURL != "" && existing.LogoURL != publicURL {
		h.storage.DeleteLogo(c.Request.Context(), existing.LogoURL)
	}

	url := publicURL
	updated, err := h.authService.UpdateChannelSetup(
		c.Request.Context(), uuidFromString(uid), channelID,
		&model.UpdateChannelSetupRequest{LogoURL: &url},
	)
	if err != nil {
		writeChannelError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"channel": newChannelSetupView(updated),
	})
}
