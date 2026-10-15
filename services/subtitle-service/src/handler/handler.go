package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/subtitle-service/src/repository"
	"newproject/services/subtitle-service/src/service"
)

type Handler struct {
	svc *service.SubtitleService
}

func NewHandler(svc *service.SubtitleService) *Handler {
	return &Handler{svc: svc}
}

// RootHealth — "is this process alive".
//
// Ye compose ke healthcheck ke liye hai. Ye jaan-boojh kar whisper ke baare me
// kuch nahi batata: container zinda rehna chahiye chahe transcription available
// ho ya na ho, aur healthcheck ko fail karke restart loop daalna (jab asli
// problem sirf config thi) se kuch solve nahi hota.
//
// "Feature chalega ya nahi" ka jawab `/subtitles/transcribe/health` deta hai.
func (h *Handler) RootHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "subtitle-service"})
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	// Root health. Container healthcheck isi ko hit karta hai, aur ye
	// deliberately `FullDownstreamHealth` se ALAG hai: container zinda hai
	// ya nahi, aur feature chalega ya nahi — do alag sawaal hain.
	//
	// `/health` = process zinda hai (DB connected). Ye compose ke liye.
	// `/subtitles/transcribe/health` = whisper reachable hai. Ye UI ke liye,
	// taaki "Generate" dabane se pehle pata chale.
	r.GET("/health", h.RootHealth)
	subs := r.Group("/subtitles")
	{
		subs.POST("", h.CreateSubtitle)
		subs.GET("", h.ListSubtitles)
		subs.GET("/:id", h.GetSubtitle)
		subs.GET("/video/:video_id", h.GetByVideo)
		subs.GET("/video/:video_id/lang/:lang", h.GetByLanguage)
		subs.GET("/video/:video_id/default", h.GetDefault)
		subs.PUT("/:id/default", h.SetDefault)
		subs.DELETE("/:id", h.DeleteSubtitle)
		subs.DELETE("/video/:video_id", h.DeleteByVideo)
		subs.PUT("/:id/style", h.UpdateStyle)
		subs.GET("/:id/style", h.GetStyle)
		subs.POST("/auto", h.AutoGenerate)
		subs.POST("/parse/srt", h.ParseSRT)
		subs.POST("/parse/vtt", h.ParseVTT)
		subs.POST("/convert/srt-to-vtt", h.ConvertSRTToVTT)
		// Audio upload -> timed segments. Ye editor ke liye hai: browser timeline
		// ka audio (16kHz mono WAV) bhejta hai aur cues wapas aate hain.
		subs.POST("/transcribe", h.Transcribe)
		// Kya transcription chal sakti hai? UI "Generate" se pehle poochti hai.
		subs.GET("/transcribe/health", h.TranscribeHealth)
	}
}

func (h *Handler) CreateSubtitle(c *gin.Context) {
	var req struct {
		VideoID  uint   `json:"video_id" binding:"required"`
		Language string `json:"language" binding:"required"`
		Label    string `json:"label,omitempty"`
		FileType string `json:"file_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sub, err := h.svc.CreateSubtitle(c.Request.Context(), req.VideoID, req.Language, req.Label, req.FileType, nil, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"subtitle": sub})
}

func (h *Handler) GetSubtitle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	sub, err := h.svc.GetSubtitle(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrSubtitleNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "subtitle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitle": sub})
}

func (h *Handler) GetByVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	subs, err := h.svc.GetSubtitlesByVideo(c.Request.Context(), uint(videoID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitles": subs})
}

func (h *Handler) GetByLanguage(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	lang := c.Param("lang")
	sub, err := h.svc.GetSubtitleByLanguage(c.Request.Context(), uint(videoID), lang)
	if err != nil {
		if err == repository.ErrSubtitleNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "subtitle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitle": sub})
}

func (h *Handler) GetDefault(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	sub, err := h.svc.GetSubtitleByLanguage(c.Request.Context(), uint(videoID), "")
	if err != nil {
		if err == repository.ErrSubtitleNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "subtitle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitle": sub})
}

func (h *Handler) SetDefault(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	if err := h.svc.SetDefault(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "default subtitle set"})
}

func (h *Handler) DeleteSubtitle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	if err := h.svc.DeleteSubtitle(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) DeleteByVideo(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Param("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video ID"})
		return
	}
	if err := h.svc.DeleteByVideo(c.Request.Context(), uint(videoID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) UpdateStyle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	var req service.UpdateStyleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	style, err := h.svc.UpdateStyle(c.Request.Context(), uint(id), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"style": style})
}

func (h *Handler) GetStyle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subtitle ID"})
		return
	}
	style, err := h.svc.GetStyle(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "style not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"style": style})
}

func (h *Handler) AutoGenerate(c *gin.Context) {
	var req struct {
		VideoID   uint   `json:"video_id" binding:"required"`
		Language  string `json:"language" binding:"required"`
		MediaPath string `json:"media_path" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sub, err := h.svc.AutoGenerate(c.Request.Context(), req.VideoID, req.Language, req.MediaPath)
	if err != nil {
		// Hinglish: 503 jab whisper server reachable nahi (feature off hai),
		// 502 jab reachable hai par transcription fail hui. Client UI in dono
		// ko alag message dikhati hai: "not configured" vs "try again".
		if errors.Is(err, service.ErrWhisperUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"subtitle": sub})
}

// ---- Transcribe: audio upload -> timed segments ----
//
// Ye route DB se poori tarah azaad hai. Editor khud cues ko text clips bana
// leta hai, isliye yahan koi subtitle row nahi banti — bas segments wapas.
//
// Body: multipart/form-data
//   audio:   file (16kHz mono WAV recommended; server khud decode karta hai)
//   language: 'auto' | ISO code (optional)
func (h *Handler) Transcribe(c *gin.Context) {
	fileHeader, err := c.FormFile("audio")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing 'audio' file in multipart form"})
		return
	}

	// 100MB cap. 20 minute ka 16kHz mono WAV ≈ 38MB, to yeh generous hai lekin
	// unbounded nahi — bina iske ek accidental request server ko RAM kha jata.
	if fileHeader.Size > 100<<20 {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "audio too large (max 100MB)"})
		return
	}

	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read uploaded file"})
		return
	}
	defer func() { _ = f.Close() }()

	// Poora file memory me. 100MB cap ke saath ye theek hai, aur whisper ko
	// ek hi baar me chahiye — streaming karne ka koi fayda nahi.
	data, err := io.ReadAll(f)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read uploaded file"})
		return
	}

	language := c.PostForm("language")
	if language == "" {
		language = c.Query("language")
	}

	segments, detected, err := h.svc.TranscribeAudio(c.Request.Context(), data, fileHeader.Filename, language)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrWhisperUnavailable):
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		case errors.Is(err, service.ErrNoSpeech):
			// Ye error NAHI hai — audio me sach me koi speech nahi thi. Client
			// ko ye pata hona chahiye taaki "0 cues" na dikhaye.
			c.JSON(http.StatusOK, gin.H{"segments": []service.Segment{}, "language": detected})
		default:
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"segments": segments, "language": detected})
}

// TranscribeHealth — UI "Generate" se PEHLE poochti hai ki transcription chalegi
// ya nahi, taaki user 10 minute ka hang na dekhe.
func (h *Handler) TranscribeHealth(c *gin.Context) {
	if err := h.svc.WhisperAvailable(c.Request.Context()); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ParseSRT(c *gin.Context) {
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	entries, err := h.svc.ParseSRT(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

func (h *Handler) ParseVTT(c *gin.Context) {
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	entries, err := h.svc.ParseVTT(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

func (h *Handler) ConvertSRTToVTT(c *gin.Context) {
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	vtt, err := h.svc.GenerateVTTFromSRT(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"vtt": vtt})
}

func (h *Handler) ListSubtitles(c *gin.Context) {
	videoID, err := strconv.ParseUint(c.Query("video_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video_id required"})
		return
	}
	subs, err := h.svc.GetSubtitlesByVideo(c.Request.Context(), uint(videoID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subtitles": subs})
}