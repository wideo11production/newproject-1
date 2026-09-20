package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"newproject/services/streaming-service/src/config"
	"newproject/services/streaming-service/src/model"
)

type StreamService struct {
	cfg config.StreamingConfig
}

func NewStreamService(cfg config.StreamingConfig) *StreamService {
	return &StreamService{cfg: cfg}
}

func (s *StreamService) GenerateSignedURL(ctx context.Context, req model.StreamRequest) (model.StreamResponse, error) {
	minioURL := s.cfg.MinioEndpoint
	if s.cfg.MinioSecure {
		minioURL = "https://" + minioURL
	} else {
		minioURL = "http://" + minioURL
	}

	objectURL := fmt.Sprintf("%s/%s/%s", minioURL, s.cfg.MinioBucket, req.Path)

	signedURL, token, err := s.signURL(objectURL)
	if err != nil {
		return model.StreamResponse{}, err
	}

	expiry := time.Now().Add(24 * time.Hour)

	return model.StreamResponse{
		URL:         signedURL,
		Token:       token,
		ExpiresAt:   expiry.Format(time.RFC3339),
		ContentType: detectContentType(req.Path),
	}, nil
}

func (s *StreamService) signURL(rawURL string) (string, string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", "", err
	}

	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", "", err
	}
	token := hex.EncodeToString(tokenBytes)

	query := parsed.Query()
	query.Set("token", token)
	query.Set("expires", time.Now().Add(24*time.Hour).Format(time.RFC3339))
	parsed.RawQuery = query.Encode()

	return parsed.String(), token, nil
}

func (s *StreamService) VerifyToken(ctx context.Context, reqURL string, token string) bool {
	parsed, err := url.Parse(reqURL)
	if err != nil {
		return false
	}
	return parsed.Query().Get("token") == token
}

func (s *StreamService) GetHLSMasterPlaylist(ctx context.Context, videoID uint, qualities []model.Quality) (model.HLSPlaylist, error) {
	var sb strings.Builder
	sb.WriteString("#EXTM3U\n")
	sb.WriteString("#EXT-X-VERSION:6\n")

	for _, q := range qualities {
		bandwidth := q.Bitrate * 1000
		sb.WriteString(fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%s\n", bandwidth, q.Resolution))
		sb.WriteString(q.URL + "\n")
	}

	return model.HLSPlaylist{
		Path:    fmt.Sprintf("/videos/%d/master.m3u8", videoID),
		Content: sb.String(),
	}, nil
}

func (s *StreamService) GetHLSSegmentPlaylist(ctx context.Context, videoID uint, quality string) (model.HLSPlaylist, error) {
	return model.HLSPlaylist{
		Path: fmt.Sprintf("/videos/%d/%s/index.m3u8", videoID, quality),
	}, nil
}

func (s *StreamService) GetDASHManifest(ctx context.Context, videoID uint, qualities []model.Quality) (string, error) {
	var sb strings.Builder
	sb.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
	sb.WriteString("<MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" type=\"static\">\n")
	sb.WriteString("  <Period>\n")

	for _, q := range qualities {
		parts := strings.Split(q.Resolution, "x")
		width := "1920"
		height := "1080"
		if len(parts) == 2 {
			width = parts[0]
			height = parts[1]
		}

		sb.WriteString(fmt.Sprintf("    <AdaptationSet mimeType=\"video/mp4\" codecs=\"%s\">\n", q.Codec))
		sb.WriteString(fmt.Sprintf("      <Representation id=\"%s\" bandwidth=\"%d\" width=\"%s\" height=\"%s\">\n", q.Resolution, q.Bitrate, width, height))
		sb.WriteString(fmt.Sprintf("        <BaseURL>%s</BaseURL>\n", q.URL))
		sb.WriteString("      </Representation>\n")
		sb.WriteString("    </AdaptationSet>\n")
	}

	sb.WriteString("  </Period>\n")
	sb.WriteString("</MPD>\n")

	return sb.String(), nil
}

func (s *StreamService) GetVideoMetadata(ctx context.Context, videoID uint) (*model.VideoMetadata, error) {
	return &model.VideoMetadata{
		VideoID: videoID,
		Title:   fmt.Sprintf("Video %d", videoID),
	}, nil
}

func (s *StreamService) GenerateLiveStreamKey(ctx context.Context, userID uint) (string, error) {
	key := fmt.Sprintf("live/%d/%s", userID, generateRandomKey(16))
	return key, nil
}

func (s *StreamService) GetLiveStreamURL(ctx context.Context, streamKey string) (string, error) {
	return fmt.Sprintf("rtmp://%s/%s", s.cfg.MinioEndpoint, streamKey), nil
}

func generateRandomKey(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[randInt(len(letters))]
	}
	return string(b)
}

func randInt(n int) int {
	b := make([]byte, 1)
	rand.Read(b)
	return int(b[0]) % n
}

func detectContentType(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".m3u8"):
		return "application/vnd.apple.mpegurl"
	case strings.HasSuffix(lower, ".m3u"):
		return "audio/mpeg-url"
	case strings.HasSuffix(lower, ".mpd"):
		return "application/dash+xml"
	case strings.HasSuffix(lower, ".mpd"):
		return "application/dash+xml"
	case strings.HasSuffix(lower, ".mp4"):
		return "video/mp4"
	default:
		return "application/octet-stream"
	}
}

type StreamEvent struct {
	EventType  string                 `json:"event_type"`
	VideoID    uint                   `json:"video_id"`
	UserID     uint                   `json:"user_id"`
	Quality    string                 `json:"quality"`
	StreamURL  string                 `json:"stream_url"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

func EncodeEvent(event StreamEvent) ([]byte, error) {
	return json.Marshal(event)
}
