package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/video/src/model"
	"newproject/services/video/src/service"
)

type Handler struct {
	videoService   *service.VideoService
	moderator      *service.ModerationService
	framerateSvc   *service.FramerateService
}

func NewHandler(
	vs *service.VideoService,
	moderator *service.ModerationService,
	framerateSvc *service.FramerateService,
) *Handler {
	return &Handler{
		videoService: vs,
		moderator:    moderator,
		framerateSvc: framerateSvc,
	}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	projectsGroup := r.Group("/projects")
	{
		projectsGroup.POST("", h.CreateProject)
		projectsGroup.GET("/:id", h.GetProjectByID)
		projectsGroup.GET("/uuid/:uuid", h.GetProjectByUUID)
		projectsGroup.GET("", h.ListProjects)
		projectsGroup.PUT("/:id", h.UpdateProject)
		projectsGroup.DELETE("/:id", h.DeleteProject)
	}

	tracksGroup := r.Group("/tracks")
	{
		tracksGroup.POST("", h.CreateTrack)
		tracksGroup.GET("/:id", h.GetTrack)
		tracksGroup.GET("/project/:project_id", h.GetTracksByProject)
		tracksGroup.PUT("/:id", h.UpdateTrack)
		tracksGroup.DELETE("/:id", h.DeleteTrack)
		tracksGroup.PUT("/reorder/:project_id", h.ReorderTracks)
	}

	clipsGroup := r.Group("/clips")
	{
		clipsGroup.POST("", h.CreateClip)
		clipsGroup.GET("/:id", h.GetClip)
		clipsGroup.GET("/track/:track_id", h.GetClipsByTrack)
		clipsGroup.PUT("/:id", h.UpdateClip)
		clipsGroup.DELETE("/:id", h.DeleteClip)
		clipsGroup.PUT("/move/:id", h.MoveClip)
		clipsGroup.PUT("/trim/:id", h.TrimClip)
		clipsGroup.PUT("/volume/:id", h.AdjustClipVolume)
		clipsGroup.POST("/:id/verify-fingerprint", h.VerifyVideoFingerprint)
		clipsGroup.POST("/:id/verify-audio", h.VerifyAudioFingerprint)
	}

	moderationGroup := r.Group("/moderation")
	{
		moderationGroup.GET("/duplicates/:hash", h.CheckForDuplicates)
		moderationGroup.POST("/block/:clip_id", h.BlockDuplicateContent)
		moderationGroup.GET("/license/:hash", h.CheckAudioLicense)
		moderationGroup.POST("/validate-audio", h.ValidateAudioParameters)
	}

	framerateGroup := r.Group("/framerate")
	{
		framerateGroup.POST("/eligibility/:user_id", h.CheckFramerateEligibility)
		framerateGroup.POST("/apply/:project_uuid", h.ApplyFramerateToProject)
		framerateGroup.GET("/profile/:project_uuid", h.GetFramerateProfile)
	}

	// ---- AI Motion Tracking Routes ----
	// Hinglish: ye routes 2D AI Motion Tracking ka backend schema expose karte hain.
	// Crosshair overlay (`+`) ke liye coordinate vectors, keyframe arrays,
	// aur element binding (sticker/title/expression link) ke liye endpoints.
	// Sab kuch self-hosted ONNX Runtime pe chalta hai — koi third-party nahi.
	motionGroup := r.Group("/motion")
	{
		// Create a new motion track for a clip
		motionGroup.POST("/tracks", h.CreateMotionTrack)
		// Get all motion tracks for a project
		motionGroup.GET("/tracks/:project_id", h.GetMotionTracks)
		// Get a single track with all keyframes
		motionGroup.GET("/tracks/:track_id/keyframes", h.GetTrackKeyframes)
		// Add a keyframe at a specific frame
		motionGroup.POST("/tracks/:track_id/keyframes", h.AddTrackKeyframe)
		// Link an element (sticker/title/expression) to a track
		motionGroup.PUT("/tracks/:track_id/bind", h.BindElementToTrack)
		// Start/stop tracking status
		motionGroup.PUT("/tracks/:track_id/status", h.UpdateTrackStatus)
	}
}

func (h *Handler) CreateProject(c *gin.Context) {
	var req struct {
		Name     string  `json:"name" binding:"required"`
		Duration float64 `json:"duration" binding:"required"`
		FPS      int     `json:"fps" binding:"required"`
		Width    int     `json:"width" binding:"required"`
		Height   int     `json:"height" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	project, err := h.videoService.CreateProject(c.Request.Context(), req.Name, req.Duration, req.FPS, req.Width, req.Height)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"project": project})
}

func (h *Handler) GetProjectByID(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	project, err := h.videoService.GetProjectByID(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project": project})
}

func (h *Handler) GetProjectByUUID(c *gin.Context) {
	project, err := h.videoService.GetProjectByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project": project})
}

func (h *Handler) ListProjects(c *gin.Context) {
	projects, err := h.videoService.ListProjects(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

func (h *Handler) UpdateProject(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	var req model.Project
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)

	if err := h.videoService.UpdateProject(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project": &req})
}

func (h *Handler) DeleteProject(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	if err := h.videoService.DeleteProject(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) CreateTrack(c *gin.Context) {
	var req struct {
		ProjectID uint             `json:"project_id" binding:"required"`
		Name      string           `json:"name" binding:"required"`
		TrackType model.TrackType  `json:"track_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	track, err := h.videoService.CreateTrack(c.Request.Context(), req.ProjectID, req.Name, req.TrackType)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"track": track})
}

func (h *Handler) GetTrack(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid track ID"})
		return
	}

	track, err := h.videoService.GetTrack(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"track": track})
}

func (h *Handler) GetTracksByProject(c *gin.Context) {
	projectID, err := strconv.ParseUint(c.Param("project_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	tracks, err := h.videoService.GetTracksByProject(c.Request.Context(), uint(projectID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tracks": tracks})
}

func (h *Handler) UpdateTrack(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid track ID"})
		return
	}

	var req model.Track
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)

	if err := h.videoService.UpdateTrack(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"track": &req})
}

func (h *Handler) DeleteTrack(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid track ID"})
		return
	}

	if err := h.videoService.DeleteTrack(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ReorderTracks(c *gin.Context) {
	projectID, err := strconv.ParseUint(c.Param("project_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	var req struct {
		TrackIDs []uint `json:"track_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.videoService.ReorderTracks(c.Request.Context(), uint(projectID), req.TrackIDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

func (h *Handler) CreateClip(c *gin.Context) {
	var req struct {
		TrackID   uint    `json:"track_id" binding:"required"`
		AssetID   string  `json:"asset_id" binding:"required"`
		Name      string  `json:"name"`
		StartTime float64 `json:"start_time" binding:"required"`
		EndTime   float64 `json:"end_time" binding:"required"`
		OffsetIn  float64 `json:"offset_in"`
		OffsetOut float64 `json:"offset_out"`
		Volume    float64 `json:"volume"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	clip, err := h.videoService.CreateClip(c.Request.Context(), req.TrackID, req.AssetID, req.Name, req.StartTime, req.EndTime, req.OffsetIn, req.OffsetOut, req.Volume)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"clip": clip})
}

func (h *Handler) GetClip(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clip ID"})
		return
	}

	clip, err := h.videoService.GetClip(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"clip": clip})
}

func (h *Handler) GetClipsByTrack(c *gin.Context) {
	trackID, err := strconv.ParseUint(c.Param("track_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid track ID"})
		return
	}

	clips, err := h.videoService.GetClipsByTrack(c.Request.Context(), uint(trackID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"clips": clips})
}

func (h *Handler) UpdateClip(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clip ID"})
		return
	}

	var req model.Clip
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)

	if err := h.videoService.UpdateClip(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"clip": &req})
}

func (h *Handler) DeleteClip(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clip ID"})
		return
	}

	if err := h.videoService.DeleteClip(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) MoveClip(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clip ID"})
		return
	}

	var req struct {
		NewTrackID    uint    `json:"new_track_id" binding:"required"`
		NewStartTime  float64 `json:"new_start_time" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.videoService.MoveClip(c.Request.Context(), uint(id), req.NewTrackID, req.NewStartTime); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

func (h *Handler) TrimClip(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clip ID"})
		return
	}

	var req struct {
		NewStartTime float64 `json:"new_start_time" binding:"required"`
		NewEndTime   float64 `json:"new_end_time" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.videoService.TrimClip(c.Request.Context(), uint(id), req.NewStartTime, req.NewEndTime); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

func (h *Handler) AdjustClipVolume(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clip ID"})
		return
	}

	var req struct {
		Volume float64 `json:"volume" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.videoService.AdjustClipVolume(c.Request.Context(), uint(id), req.Volume); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

// VerifyVideoFingerprint - SHA256 visual token fingerprint computation from MinIO staging containers
func (h *Handler) VerifyVideoFingerprint(c *gin.Context) {
	clipID := c.Param("clip_id")
	var req struct {
		VideoData []byte                  `json:"video_data" binding:"required"`
		Metadata  map[string]string       `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fingerprint, err := h.moderator.VerifyVideoFingerprint(c.Request.Context(), clipID, req.VideoData, req.Metadata)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"fingerprint": fingerprint})
}

// VerifyAudioFingerprint - Audio frequency hash validation against free stock audio ledger
func (h *Handler) VerifyAudioFingerprint(c *gin.Context) {
	clipID := c.Param("clip_id")
	var req struct {
		AudioData    []byte                  `json:"audio_data" binding:"required"`
		ExpectedHash string                  `json:"expected_hash"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fingerprint, err := h.moderator.VerifyAudioFingerprint(c.Request.Context(), clipID, req.AudioData, req.ExpectedHash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"fingerprint": fingerprint})
}

// CheckForDuplicates - Scan global records layer for matching hashes
func (h *Handler) CheckForDuplicates(c *gin.Context) {
	hash := c.Param("hash")

	found, err := h.moderator.CheckForDuplicateUploads(c.Request.Context(), hash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"duplicate": found})
}

// BlockDuplicateContent - Intercept pipeline lifecycle when duplicate detected
func (h *Handler) BlockDuplicateContent(c *gin.Context) {
	clipID := c.Param("clip_id")
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := h.moderator.BlockDuplicateContent(c.Request.Context(), clipID, req.Reason)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

// CheckAudioLicense - Validate audio against free stock audio ledger for licensing
func (h *Handler) CheckAudioLicense(c *gin.Context) {
	hash := c.Param("hash")

	licensed, err := h.moderator.CheckAudioLicense(c.Request.Context(), hash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"licensed": licensed})
}

// ValidateAudioParameters - Check audio technical specifications meet platform standards
func (h *Handler) ValidateAudioParameters(c *gin.Context) {
	var req struct {
		SampleRate int     `json:"sample_rate" binding:"required"`
		Channels   int     `json:"channels" binding:"required"`
		BitDepth   int     `json:"bit_depth" binding:"required"`
		Duration   float64 `json:"duration" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.moderator.ValidateAudioParameters(c.Request.Context(), req.SampleRate, req.Channels, req.BitDepth, req.Duration); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

// CheckFramerateEligibility - Returns the max framerate tier a user is eligible for.
// AURA Premium feature flag: global toggle + strict AURA license check.
// NO role-based, NO subscription-based, NO discount vectors.
func (h *Handler) CheckFramerateEligibility(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	eligibility, err := h.framerateSvc.CheckEligibility(c.Request.Context(), uint(userID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"eligibility": eligibility})
}

// ApplyFramerateToProject - Evaluate eligibility and save framerate profile for a project.
func (h *Handler) ApplyFramerateToProject(c *gin.Context) {
	projectUUID := c.Param("project_uuid")
	var req struct {
		UserID          uint              `json:"user_id" binding:"required"`
		ManualOverride  *model.FramerateTier `json:"manual_override_tier"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile, err := h.framerateSvc.ApplyFramerateToProject(
		c.Request.Context(),
		req.UserID,
		projectUUID,
		nil, // project fetched from repo if needed
		req.ManualOverride,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

// GetFramerateProfile - Retrieve the framerate profile for a project.
func (h *Handler) GetFramerateProfile(c *gin.Context) {
	projectUUID := c.Param("project_uuid")
	profile, err := h.framerateSvc.GetProfile(c.Request.Context(), projectUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile})
}

// ---------------------------------------------------------------------------
// AI Motion Tracking handlers
// ---------------------------------------------------------------------------

// CreateMotionTrack — creates a new motion tracking track for a clip.
//
// Hinglish: ye handler ek naya motion track banata hai jisme crosshair
// overlay (`+`) position ke liye coordinate vectors store honge.
// Tracking status "pending" se start hota hai, jab system tracking
// shuru karta hai to "tracking", jab user "Link Element" pe click karta
// hai to element_binding_id set hota hai.
func (h *Handler) CreateMotionTrack(c *gin.Context) {
	var req struct {
		ProjectID     uint    `json:"project_id" binding:"required"`
		ClipID        string  `json:"clip_id" binding:"required"`
		Label         string  `json:"label"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	track := &model.MotionTrack{
		ProjectID: req.ProjectID,
		ClipID:    req.ClipID,
		Label:     req.Label,
		Status:    model.TrackerPending,
	}

	if err := h.videoService.CreateMotionTrack(c.Request.Context(), track); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"track": track})
}

// GetMotionTracks — returns all motion tracks for a project.
func (h *Handler) GetMotionTracks(c *gin.Context) {
	projectID, err := strconv.ParseUint(c.Param("project_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	tracks, err := h.videoService.GetMotionTracks(c.Request.Context(), uint(projectID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tracks": tracks})
}

// GetTrackKeyframes — returns all keyframes for a motion track.
func (h *Handler) GetTrackKeyframes(c *gin.Context) {
	trackID, err := strconv.ParseUint(c.Param("track_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid track ID"})
		return
	}

	keyframes, err := h.videoService.GetTrackKeyframes(c.Request.Context(), uint(trackID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"keyframes": keyframes})
}

// AddTrackKeyframe — adds a coordinate vector keyframe at a specific frame.
//
// Hinglish: har frame par (x, y) normalized coordinate [0-1] aur velocity
// (vel_x, vel_y) store karta hai. Yeh data frontend crosshair (`+`) ko
// position karega aur linked element ka transform lock karega.
func (h *Handler) AddTrackKeyframe(c *gin.Context) {
	trackID, err := strconv.ParseUint(c.Param("track_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid track ID"})
		return
	}

	var req struct {
		Frame      float64 `json:"frame" binding:"required"`
		X          float64 `json:"x" binding:"required"`
		Y          float64 `json:"y" binding:"required"`
		VelX       float64 `json:"vel_x"`
		VelY       float64 `json:"vel_y"`
		Confidence float64 `json:"confidence"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	kf := &model.TrackKeyframe{
		TrackID:    uint(trackID),
		Frame:      req.Frame,
		X:          req.X,
		Y:          req.Y,
		VelX:       req.VelX,
		VelY:       req.VelY,
		Confidence: req.Confidence,
	}

	if err := h.videoService.AddTrackKeyframe(c.Request.Context(), kf); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"keyframe": kf})
}

// BindElementToTrack — links a title/expression/sticker overlay to a motion track.
//
// Hinglish: jab user "Link Element to Track" dropdown se ek element select
// karta hai, to ye endpoint element_binding_id set karta hai. Jab bhi track
// move karega, linked element ka transform bhi automatically update hoga.
func (h *Handler) BindElementToTrack(c *gin.Context) {
	trackID, err := strconv.ParseUint(c.Param("track_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid track ID"})
		return
	}

	var req struct {
		ElementID string `json:"element_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	track, err := h.videoService.BindElementToTrack(c.Request.Context(), uint(trackID), req.ElementID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"track": track})
}

// UpdateTrackStatus — updates the tracking state machine status.
func (h *Handler) UpdateTrackStatus(c *gin.Context) {
	trackID, err := strconv.ParseUint(c.Param("track_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid track ID"})
		return
	}

	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	track, err := h.videoService.UpdateTrackStatus(c.Request.Context(), uint(trackID), model.TrackerStatus(req.Status))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"track": track})
}