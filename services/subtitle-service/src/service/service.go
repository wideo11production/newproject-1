package service

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"newproject/services/subtitle-service/src/model"
	"newproject/services/subtitle-service/src/repository"
)

type SubtitleService struct {
	subRepo    repository.SubtitleRepository
	styleRepo  repository.StyleRepository
	ffmpegPath string
	whisperURL string
	// whisper — asli speech-to-text client.
	//
	// Pehle `whisperURL` store hota tha aur kabhi use nahi hota tha (default
	// `http://localhost:9000` tha, jo waqai MinIO hai). Ab ye client us URL ko
	// sach me hit karta hai. Agar URL khaali ho toh client "not configured"
	// report karta hai, aur `TranscribeAudio` saaf error deta hai bajaye
	// chup-chaap fake subtitle banane ke.
	whisper *WhisperClient
}

type SubtitleConfig struct {
	FFmpegPath string
	WhisperURL string
	// WhisperTimeoutSeconds — 0 = client apna default (10 min) use kare.
	WhisperTimeoutSeconds int
}

func NewSubtitleService(cfg SubtitleConfig, subRepo repository.SubtitleRepository, styleRepo repository.StyleRepository) *SubtitleService {
	return &SubtitleService{
		subRepo:    subRepo,
		styleRepo:  styleRepo,
		ffmpegPath: cfg.FFmpegPath,
		whisperURL: cfg.WhisperURL,
		whisper:    NewWhisperClient(WhisperConfig{BaseURL: cfg.WhisperURL, Timeout: time.Duration(cfg.WhisperTimeoutSeconds) * time.Second}),
	}
}

// WhisperAvailable — kya transcription chal sakti hai?
//
// Isko proxy route `isAvailable` ke through UI call karti hai, taaki user
// "Generate" dabane se PEHLE hi jaan le ki ye kaam karega ya nahi.
func (s *SubtitleService) WhisperAvailable(ctx context.Context) error {
	return s.whisper.Ping(ctx)
}

// TranscribeAudio — audio bytes do, timed segments lo. DB ko haath nahi lagta.
//
// Ye woh method hai jo editor ka proxy route call karta hai: browser timeline
// audio (16kHz mono WAV) bhejta hai, aur seedha segments wapas aate hain —
// video_id, MinIO, koi persistence nahi. Editor khud cues ko text clips bana
// leta hai, isliye ise koi subtitle row banane ki zaroorat nahi.
func (s *SubtitleService) TranscribeAudio(ctx context.Context, audio []byte, filename, language string) ([]Segment, string, error) {
	return s.whisper.Transcribe(ctx, audio, filename, language)
}

func (s *SubtitleService) CreateSubtitle(ctx context.Context, videoID uint, language, label, fileType string, content io.Reader, contentType string) (*model.Subtitle, error) {
	sub := &model.Subtitle{
		VideoID: videoID,
		Language: language,
		Label:    label,
		FileType: fileType,
		Source:   "upload",
	}

	if err := s.subRepo.Create(ctx, sub); err != nil {
		return nil, err
	}

	style := &model.SubtitleStyle{
		SubtitleID:      sub.ID,
		FontFamily:      "Arial",
		FontSize:        "100%",
		FontColor:       "white",
		Outline:         "black",
		OutlineSize:     "1px",
		Shadow:          "transparent",
		BackgroundColor: "rgba(0,0,0,0.5)",
		Alignment:       2,
		Position:        "bottom",
	}
	_ = s.styleRepo.Create(ctx, style)

	return sub, nil
}

func (s *SubtitleService) GetSubtitle(ctx context.Context, id uint) (*model.Subtitle, error) {
	return s.subRepo.GetByID(ctx, id)
}

func (s *SubtitleService) GetSubtitlesByVideo(ctx context.Context, videoID uint) ([]*model.Subtitle, error) {
	return s.subRepo.GetByVideoID(ctx, videoID)
}

func (s *SubtitleService) GetSubtitleByLanguage(ctx context.Context, videoID uint, language string) (*model.Subtitle, error) {
	return s.subRepo.GetByLanguage(ctx, videoID, language)
}

func (s *SubtitleService) SetDefault(ctx context.Context, id uint) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}

	if existing, err := s.subRepo.GetDefault(ctx, sub.VideoID); err == nil {
		existing.IsDefault = false
		_ = s.subRepo.Update(ctx, existing)
	}

	sub.IsDefault = true
	return s.subRepo.Update(ctx, sub)
}

func (s *SubtitleService) DeleteSubtitle(ctx context.Context, id uint) error {
	return s.subRepo.Delete(ctx, id)
}

func (s *SubtitleService) DeleteByVideo(ctx context.Context, videoID uint) error {
	return s.subRepo.DeleteByVideoID(ctx, videoID)
}

func (s *SubtitleService) UpdateStyle(ctx context.Context, subtitleID uint, req UpdateStyleRequest) (*model.SubtitleStyle, error) {
	style, err := s.styleRepo.GetBySubtitleID(ctx, subtitleID)
	if err != nil {
		style = &model.SubtitleStyle{SubtitleID: subtitleID}
	}

	if req.FontFamily != "" {
		style.FontFamily = req.FontFamily
	}
	if req.FontSize != "" {
		style.FontSize = req.FontSize
	}
	if req.FontColor != "" {
		style.FontColor = req.FontColor
	}
	if req.Outline != "" {
		style.Outline = req.Outline
	}
	if req.OutlineSize != "" {
		style.OutlineSize = req.OutlineSize
	}
	if req.Shadow != "" {
		style.Shadow = req.Shadow
	}
	if req.BackgroundColor != "" {
		style.BackgroundColor = req.BackgroundColor
	}
	if req.Alignment != 0 {
		style.Alignment = req.Alignment
	}
	if req.Position != "" {
		style.Position = req.Position
	}

	if err := s.styleRepo.Update(ctx, style); err != nil {
		return nil, err
	}
	return style, nil
}

func (s *SubtitleService) GetStyle(ctx context.Context, subtitleID uint) (*model.SubtitleStyle, error) {
	return s.styleRepo.GetBySubtitleID(ctx, subtitleID)
}

// AutoGenerate — asli transcription.
//
// Hinglish: pehle ye function FFmpeg chalata tha jisme transcription ka koi
// argument hi nahi tha (`-c:a:0 -disposition <output>` — ye audio disposition
// flag hai, speech-to-text ka argument nahi), aur phir DB me
// `Source: "whisper"` likh deta tha. Matlab client ko ek subtitle row milti
// thi jo kisi asli file ki taraf point nahi karti thi. Claim aur reality me
// poori khayi thi.
//
// Ab: file padho → whisper se transcribe karo → VTT likho → DB row banao jo
// us VTT ki taraf point karti hai. Agar transcription fail ho, ERROR return
// hota hai — row nahi banti. Ye jaan-boojh kar: ek "successful" response jo
// kaam nahi karti wo client ko lagta hai feature kaam kar raha hai, jhooth
// bolne se behtar hai saaf fail hona.
//
// `outputDir` pehle se banta maana jata hai (Docker me `/app/output`).
func (s *SubtitleService) AutoGenerate(ctx context.Context, videoID uint, language string, mediaPath string) (*model.Subtitle, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	data, err := os.ReadFile(mediaPath)
	if err != nil {
		return nil, fmt.Errorf("reading media for transcription: %w", err)
	}

	segments, detectedLang, err := s.whisper.Transcribe(ctx, data, filepath.Base(mediaPath), language)
	if err != nil {
		// Koi row nahi banti. Caller ko error milta hai.
		return nil, err
	}

	// Detected language ka fayda: agar user ne 'auto' bheja tha, to DB me asli
	// language likhi jaaye — warna "auto" naam ki koi language hoti hi nahi.
	storedLang := language
	if storedLang == "" || storedLang == "auto" {
		storedLang = detectedLang
		if storedLang == "" {
			storedLang = "und" // undetermined
		}
	}

	outputPath := fmt.Sprintf("/tmp/subtitles/%d_%s.vtt", videoID, storedLang)
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return nil, fmt.Errorf("creating subtitle output directory: %w", err)
	}
	if err := os.WriteFile(outputPath, []byte(VTT(segments)), 0o644); err != nil {
		return nil, fmt.Errorf("writing VTT: %w", err)
	}

	sub := &model.Subtitle{
		VideoID:     videoID,
		Language:    storedLang,
		Label:       fmt.Sprintf("%s (Auto)", storedLang),
		MinioPath:   outputPath,
		FileType:    "vtt",
		IsDefault:   false,
		IsForced:    false,
		Source:      "whisper",
		AutoGenerated: true,
	}

	if err := s.subRepo.Create(ctx, sub); err != nil {
		return nil, err
	}

	style := &model.SubtitleStyle{
		SubtitleID:  sub.ID,
		FontFamily:  "Arial",
		FontSize:    "100%",
		FontColor:   "white",
		Outline:     "black",
		OutlineSize: "1px",
		Shadow:      "transparent",
		BackgroundColor: "rgba(0,0,0,0.5)",
		Alignment:   2,
		Position:    "bottom",
	}
	_ = s.styleRepo.Create(ctx, style)

	return sub, nil
}

func (s *SubtitleService) ParseSRT(content string) ([]SubtitleEntry, error) {
	entries := []SubtitleEntry{}
	blocks := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n\n")

	for _, block := range blocks {
		lines := strings.Split(strings.TrimSpace(block), "\n")
		if len(lines) < 3 {
			continue
		}

		var index int
		if _, err := fmt.Sscanf(lines[0], "%d", &index); err != nil {
			continue
		}

		timecode := lines[1]
		text := strings.Join(lines[2:], "\n")

		entry := SubtitleEntry{
			Index:    index,
			Timecode: timecode,
			Text:     text,
		}
		entries = append(entries, entry)
	}

	return entries, nil
}

func (s *SubtitleService) ParseVTT(content string) ([]SubtitleEntry, error) {
	entries := []SubtitleEntry{}
	lines := strings.Split(content, "\n")

	var current *SubtitleEntry
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "WEBVTT" || line == "" {
			continue
		}

		if strings.Contains(line, "-->") {
			if current != nil {
				entries = append(entries, *current)
			}
			current = &SubtitleEntry{
				Timecode: line,
			}
			continue
		}

		if current != nil {
			if current.Text == "" {
				current.Text = line
			} else {
				current.Text += "\n" + line
			}
		}
	}
	if current != nil {
		entries = append(entries, *current)
	}

	return entries, nil
}

type SubtitleEntry struct {
	Index    int    `json:"index"`
	Timecode string `json:"timecode"`
	Text     string `json:"text"`
}

type UpdateStyleRequest struct {
	FontFamily      string `json:"font_family,omitempty"`
	FontSize        string `json:"font_size,omitempty"`
	FontColor       string `json:"font_color,omitempty"`
	Outline         string `json:"outline,omitempty"`
	OutlineSize     string `json:"outline_size,omitempty"`
	Shadow          string `json:"shadow,omitempty"`
	BackgroundColor string `json:"background_color,omitempty"`
	Alignment       int    `json:"alignment,omitempty"`
	Position        string `json:"position,omitempty"`
}

func (s *SubtitleService) GenerateVTTFromSRT(srtContent string) (string, error) {
	entries, err := s.ParseSRT(srtContent)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString("WEBVTT\n\n")

	for _, entry := range entries {
		timecode := convertSRTTimecode(entry.Timecode)
		sb.WriteString(fmt.Sprintf("%d\n", entry.Index))
		sb.WriteString(timecode)
		sb.WriteString("\n")
		sb.WriteString(entry.Text)
		sb.WriteString("\n\n")
	}

	return sb.String(), nil
}

func convertSRTTimecode(tc string) string {
	re := regexp.MustCompile(`(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})`)
	matches := re.FindStringSubmatch(tc)
	if len(matches) < 9 {
		return tc
	}
	return fmt.Sprintf("%s:%s:%s.%s --> %s:%s:%s.%s",
		matches[1], matches[2], matches[3], matches[4],
		matches[5], matches[6], matches[7], matches[8])
}

func (s *SubtitleService) GenerateSTLSRT(uuid uuid.UUID) string {
	_ = uuid
	var sb strings.Builder
	sb.WriteString("1\n")
	sb.WriteString("00:00:00,000 --> 00:00:05,000\n")
	sb.WriteString("Sample subtitle\n")
	return sb.String()
}

type SubtitleEvent struct {
	EventType     string `json:"event_type"`
	VideoID       uint   `json:"video_id"`
	Language      string `json:"language"`
	Status        string `json:"status"`
	AutoGenerated bool   `json:"auto_generated"`
	Timestamp     time.Time `json:"timestamp"`
}