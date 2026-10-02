package handler

// Reel platform readiness, and the export pack.
//
// =============================================================================
// WHAT THIS IS, AND WHAT IT IS NOT
// =============================================================================
//
// There is no public API that lets a third party upload to Instagram, TikTok,
// YouTube Shorts or Facebook Reels without the creator's own OAuth grant and,
// usually, an app review. So this does NOT publish anything anywhere, and it
// does not pretend to.
//
// What it does is the part that is genuinely buildable and genuinely useful:
// BEFORE a creator exports, tell them which destinations will accept the clip
// and which will not, with a reason. Every platform silently refuses a file for
// the same handful of reasons, and discovering that after the edit is finished is
// the most demoralising way to find out.
//
// Automated publishing comes later, per platform, behind its own feature flag,
// with each creator's refresh token encrypted at rest. Not built here because the
// API does not exist for us yet, and a button that pretends otherwise is worse
// than no button.

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
	"github.com/wideo11/auth-service/internal/service"
)

// ReelReadiness returns the per-platform pass/warn/block grid for a reel.
//
// PUBLIC, unlike the subscriber list. The grid describes the FILE - its
// dimensions, length, size, whether it has audio - and nothing about who owns
// it. It is the same information a creator just saw in their own editor, and
// there is nothing here to enumerate: the response is fixed-length and keyed by
// platform.
//
// The asset itself is NOT public. Only the verdict.
func (h *AuthHandler) ReelReadiness(c *gin.Context) {
	assetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	facts, err := h.media.ReelFactsFor(c.Request.Context(), assetID)
	if err != nil {
		// Any read failure returns the same 404. A missing asset and an asset that
		// exists but is not readable must be indistinguishable, or this becomes an
		// oracle for which asset ids are real.
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	grid := service.EvaluateReel(facts.Width, facts.Height, facts.DurationS, facts.HasAudio, facts.Bytes)

	c.JSON(http.StatusOK, gin.H{
		"asset_id":            facts.ID,
		"kind":                facts.Kind,
		"status":              facts.Status,
		"width":               facts.Width,
		"height":              facts.Height,
		"duration_seconds":    facts.DurationS,
		"bytes":               facts.Bytes,
		"has_audio":           facts.HasAudio,
		"eligible_everywhere": grid.EligibleEverywhere,
		"platforms":           grid.Platforms,
		// Advisory, and derived only from the dimensions - this cannot see text
		// in the frame, so it never claims to know whether anything is hidden.
		"safe_area_note": service.SafeAreaWarning(facts.Width, facts.Height),
		"publishing": gin.H{
			"automated": false,
			"reason": "No public upload API without per-creator OAuth and app review. " +
				"Export the pack below and upload it yourself; automated publishing " +
				"arrives per platform behind a feature flag.",
		},
	})
}

// ListReelPlatforms returns the destination list and their rules.
//
// Public and static, so the editor can render an explainer without hardcoding
// platform names - and so there is ONE place the four platforms are named.
func (h *AuthHandler) ListReelPlatforms(c *gin.Context) {
	type rules struct {
		Platform       string `json:"platform"`
		MaxSeconds     int    `json:"max_seconds"`
		MaxBytes       int64  `json:"max_bytes"`
		RequiresAudio  bool   `json:"requires_audio"`
		RequiresAspect string `json:"requires_aspect"`
		Note           string `json:"note,omitempty"`
	}

	shorts := service.YouTubeShortsMaxSeconds

	c.JSON(http.StatusOK, gin.H{
		"platforms": []rules{
			{
				Platform: service.PlatformInstagramReels, MaxSeconds: service.ReelMaxSeconds,
				MaxBytes: service.ReelMaxBytes, RequiresAudio: true, RequiresAspect: "9:16",
			},
			{
				Platform: service.PlatformTikTok, MaxSeconds: service.ReelMaxSeconds,
				MaxBytes: service.ReelMaxBytes, RequiresAudio: true, RequiresAspect: "9:16",
			},
			{
				Platform: service.PlatformYouTubeShorts, MaxSeconds: service.ReelMaxSeconds,
				MaxBytes: service.ReelMaxBytes, RequiresAudio: true, RequiresAspect: "9:16",
				Note: "Only clips up to " + strconv.Itoa(shorts) + "s get the Shorts shelf. " +
					"Longer clips still upload; they are flagged as a warning, not a failure.",
			},
			{
				Platform: service.PlatformFacebookReels, MaxSeconds: service.ReelMaxSeconds,
				MaxBytes: service.ReelMaxBytes, RequiresAudio: true, RequiresAspect: "9:16",
			},
		},
		"safe_area_px": gin.H{
			"top":    service.ReelSafeAreaTopPx,
			"bottom": service.ReelSafeAreaBottomPx,
			"note":   "Platform UI covers these bands. Keep captions and watermarks clear of them.",
		},
	})
}

// ReelExportPack explains what to hand the creator for a manual upload.
//
// A description rather than a ZIP of bytes, on purpose: the actual media is
// already a presigned URL from the asset, and zipping a copy server-side would
// mean reading the whole file through this process to re-write it somewhere else
// - the exact thing the direct-to-MinIO upload design avoids. A caption pack
// plus the signed URL is the honest version of this.
func (h *AuthHandler) ReelExportPack(c *gin.Context) {
	uid, ok := creatorUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	assetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}

	asset, err := h.media.Get(c.Request.Context(), assetID, uuidFromString(uid))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset_not_found"})
		return
	}
	if asset.Kind != model.MediaKindReel {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "not_a_reel",
			"message": "This asset is not a reel.",
		})
		return
	}

	grid := service.EvaluateReel(
		asset.Width, asset.Height, asset.DurationS, asset.HasAudio, asset.Bytes,
	)

	type perPlatform struct {
		Platform string   `json:"platform"`
		Eligible bool     `json:"eligible"`
		Notes    []string `json:"notes"`
	}
	per := make([]perPlatform, 0, len(grid.Platforms))
	for _, p := range grid.Platforms {
		notes := append([]string{}, p.Warnings...)
		if !p.Eligible {
			notes = append(notes, "cannot be published here: "+p.Reason())
		}
		per = append(per, perPlatform{Platform: p.Platform, Eligible: p.Eligible, Notes: notes})
	}

	c.JSON(http.StatusOK, gin.H{
		"asset_id": asset.ID,
		"filename": asset.Filename,
		// The download URL is a presigned object URL minted for this response, so
		// it expires. That is intended: the media bucket is never public (R6), and
		// a pack that hands out a permanent URL would undo that.
		"download_url":     asset.PublicURL,
		"dimensions":       []int{asset.Width, asset.Height},
		"duration_s":       asset.DurationS,
		"bytes":            asset.Bytes,
		"caption_template": captionForPlatforms,
		"per_platform":     per,
		"safe_area_note":   service.SafeAreaWarning(asset.Width, asset.Height),
		"how_to_upload": []string{
			"Download the clip above.",
			"For each platform marked eligible, open its app and upload manually.",
			"Keep captions clear of the top and bottom bands - platform UI covers them.",
			"Platform watermarks are stripped on upload; our watermark is already burned in.",
		},
	})
}

// captionForPlatforms is a per-platform caption SHAPE, not finished copy.
//
// Deliberately structure and not prose: these change weekly, and a hardcoded
// caption that goes stale reads as a product bug rather than as marketing copy.
var captionForPlatforms = map[string][]string{
	service.PlatformInstagramReels: {"hook_line", "body", "cta", "hashtags"},
	service.PlatformTikTok:         {"hook_line", "body", "cta", "hashtags"},
	service.PlatformYouTubeShorts:  {"title", "description", "hashtags"},
	service.PlatformFacebookReels:  {"hook_line", "body", "cta", "hashtags"},
}
