package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/video/src/model"
	"newproject/services/video/src/service"
)

type Handler struct {
	videoService *service.VideoService
}

func NewHandler(vs *service.VideoService) *Handler {
	return &Handler{
		videoService: vs,
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
	}
}

// Project handlers

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

// Track handlers

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

// Clip handlers

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

