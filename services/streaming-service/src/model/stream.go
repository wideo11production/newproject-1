package model

type StreamRequest struct {
	VideoID    uint   `json:"video_id" binding:"required"`
	Quality    string `json:"quality" binding:"required"`
	Path       string `json:"path" binding:"required"`
}

type StreamResponse struct {
	URL          string `json:"url"`
	Token        string `json:"token,omitempty"`
	ExpiresAt    string `json:"expires_at,omitempty"`
	ContentType  string `json:"content_type"`
}

type HLSPlaylist struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type Segment struct {
	Path     string `json:"path"`
	Duration float64 `json:"duration"`
}

type VideoMetadata struct {
	VideoID    uint   `json:"video_id"`
	Title      string `json:"title"`
	Duration   float64 `json:"duration"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Codec      string `json:"codec"`
	Bitrate    int    `json:"bitrate"`
	Qualities  []Quality `json:"qualities"`
}

type Quality struct {
	Resolution string `json:"resolution"`
	Bitrate    int    `json:"bitrate"`
	Codec      string `json:"codec"`
	URL        string `json:"url"`
}
