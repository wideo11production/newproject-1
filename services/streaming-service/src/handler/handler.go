package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/streaming-service/src/config"
	"newproject/services/streaming-service/src/model"
	"newproject/services/streaming-service/src/service"
)

type Handler struct {
	svc *service.StreamService
	cfg *config.Config
}

func NewHandler(svc *service.StreamService, cfg *config.Config) *Handler {
	return &Handler{svc: svc, cfg: cfg}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	stream := r.Group("/stream")
	{
		stream.POST("/signed-url", h.GetSignedURL)
		stream.GET("/video/:video_id/master", h.GetMasterPlaylist)
		stream.GET("/video/:video_id/:quality/playlist", h.GetSegmentPlaylist)
		stream.GET("/video/:video_id/metadata", h.GetMetadata)
		stream.GET("/video/:video_id/:quality/dash", h.GetDASHManifest)
	}

	live := r.Group("/live")
	{
		live.POST("/stream-key", h.GenerateLiveStreamKey)
		live.GET("/stream-url", h.GetLiveStreamURL)
		live.GET("/token/verify", h.VerifyToken)
	}
}

func (h *Handler) GetSignedURL(c *gin.Context) {
	var req model.StreamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	resp, err := h.svc.GenerateSignedURL(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) GetMasterPlaylist(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	qualities := []model.Quality{
		{Resolution: "2160x3840", Bitrate: 12000, Codec: "avc1.640028", URL: "https://example.com/2160p.m3u8"},
		{Resolution: "1080x1920", Bitrate: 5000, Codec: "avc1.640028", URL: "https://example.com/1080p.m3u8"},
		{Resolution: "720x1280", Bitrate: 2500, Codec: "avc1.64001f", URL: "https://example.com/720p.m3u8"},
	}
	playlist, err := h.svc.GetHLSMasterPlaylist(c.Request.Context(), uint(videoID), qualities)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "application/vnd.apple.mpegurl", []byte(playlist.Content))
}

func (h *Handler) GetSegmentPlaylist(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	playlist, err := h.svc.GetHLSSegmentPlaylist(c.Request.Context(), uint(videoID), c.Param("quality"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "application/vnd.apple.mpegurl", []byte(playlist.Content))
}

func (h *Handler) GetMetadata(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	meta, err := h.svc.GetVideoMetadata(c.Request.Context(), uint(videoID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, meta)
}

func (h *Handler) GetDASHManifest(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	qualities := []model.Quality{
		{Resolution: "3840x2160", Bitrate: 12000, Codec: "avc1.640028", URL: "https://example.com/2160p.m4s"},
		{Resolution: "1920x1080", Bitrate: 5000, Codec: "avc1.640028", URL: "https://example.com/1080p.m4s"},
	}
	manifest, err := h.svc.GetDASHManifest(c.Request.Context(), uint(videoID), qualities)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "application/dash+xml", []byte(manifest))
}

func (h *Handler) GenerateLiveStreamKey(c *gin.Context) {
	var req struct {
		UserID uint `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	key, err := h.svc.GenerateLiveStreamKey(c.Request.Context(), req.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"stream_key": key})
}

func (h *Handler) GetLiveStreamURL(c *gin.Context) {
	streamKey := c.Query("stream_key")
	if streamKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "stream_key required"})
		return
	}
	streamURL, err := h.svc.GetLiveStreamURL(c.Request.Context(), streamKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": streamURL})
}

func (h *Handler) VerifyToken(c *gin.Context) {
	streamURL := c.Query("url")
	token := c.Query("token")
	if streamURL == "" || token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "url and token required"})
		return
	}
	valid := h.svc.VerifyToken(c.Request.Context(), streamURL, token)
	c.JSON(http.StatusOK, gin.H{"valid": valid})
}
