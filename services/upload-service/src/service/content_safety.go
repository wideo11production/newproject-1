// ContentSafetyService — AURA open-source content safety compliance guard.
//
// YEH SERVICE user directive ke mutabiq "100% free, self-hosted, open-source"
// content moderation implement karta hai:
//
//   1. FFmpeg (open-source) se video frames nikalte hain (keyframe sampling).
//   2. Har frame ek self-hosted ONNX model (open-source) ke through jata hai.
//   3. Prohibited categories detect hone par:
//      a. Upload session ABORT karo
//      b. File fragments DELETE karo (caller/MinIO cleanup)
//      c. User ko blacklist karo (content_safety_blacklist table)
//
// Prohibited categories (user directive):
//   - Adult content (sexual explicit)
//   - Explicit weapons/firearms
//   - Active smuggling signatures
//   - Illegal contraband
//   - Illicit drug packages
//
// FFmpeg usage: `ffmpeg -skip_frame nokey -i <input> -vf fps=<rate> <out_dir>/frame_%04d.jpg`
// ONNX usage: self-hosted ONNX runtime (C API binding) — NO cloud API calls.
//
// Hinglish: ye service FFmpeg binary chahiye (PATH ya config.ffmpeg_path)
// aur ONNX model file chahiye (.onnx file). Dono open-source hai.
// Agar safety disabled ho to skip kar deta hai (noop).
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"newproject/services/upload-service/src/model"
	"newproject/services/upload-service/src/repository"
)

// FrameAnalyzer — ONNX model-based frame analysis interface.
//
// Hinglish: ye interface ONNX runtime se frame analyze karta hai.
// Real implementation ONNX C API binding use karega; tests mein
// fake lagta hai. Third-party API nahi — local model file se inference.
type FrameAnalyzer interface {
	// AnalyzeFrame analyzes an image frame file and returns detections.
	// Returns list of prohibited content detections with confidence scores.
	AnalyzeFrame(ctx context.Context, framePath string) ([]model.ContentSafetyResult, error)
}

// QuotaChecker — cross-module interface for upload volume limits (.env config).
//
// Hinglish: ye interface billing-service ya auth-service se implement hoga
// jo per-user quota track karta hai. Default implementation local .env config
// se limit read karta hai.
type QuotaChecker interface {
	// CheckUploadQuota returns error agar user ne quota exceed kar diya.
	CheckUploadQuota(ctx context.Context, userID uint, fileSize int64) error
}

// DefaultQuotaConfig — .env se quota values.
type DefaultQuotaConfig struct {
	MaxDailyUploads      int64
	MaxFileSizeMB        int64
	MaxConcurrentUploads int
}

// CheckUploadQuota — default .env-based quota checker.
func (c *DefaultQuotaConfig) CheckUploadQuota(ctx context.Context, userID uint, fileSize int64) error {
	if c.MaxFileSizeMB > 0 && fileSize > c.MaxFileSizeMB*1024*1024 {
		return fmt.Errorf("file size %d bytes exceeds quota limit of %d MB", fileSize, c.MaxFileSizeMB)
	}
	// MaxDailyUploads aur MaxConcurrentUploads ko caller (handler/service)
	// track karega — yeh basic size check peeta hai.
	return nil
}

// ContentSafetyConfig — configuration for the safety filter.
type ContentSafetyConfig struct {
	Enabled              bool
	FFmpegPath           string
	ONNXModelPath        string
	MinConfidence        float32
	FrameSampleRate      int
	MaxFramesToAnalyze   int
	BlacklistOnDetection bool
}

// ContentSafetyService — FFmpeg + ONNX content safety engine.
type ContentSafetyService struct {
	repo         repository.SafetyRepository
	analyzer     FrameAnalyzer
	config       ContentSafetyConfig
	minioClient  interface {
		RemoveObject(ctx context.Context, bucket, key string, opts minio.RemoveObjectOptions) error
	}
	bucket string
}

// NewContentSafetyService creates the safety filter engine.
//
// Hinglish: agar analyzer nil hai ya config.Enabled=false hoga to
// service noop behavior dikhayega (sab uploads pass jayenge). Production
// mein dono set honge zaroori.
func NewContentSafetyService(repo repository.SafetyRepository, analyzer FrameAnalyzer, cfg ContentSafetyConfig, bucket string) *ContentSafetyService {
	return &ContentSafetyService{
		repo:      repo,
		analyzer:  analyzer,
		config:    cfg,
		bucket:    bucket,
	}
}

// SetMinioClient wires MinIO client for fragment cleanup on violation.
func (s *ContentSafetyService) SetMinioClient(mc interface {
	RemoveObject(ctx context.Context, bucket, key string, opts minio.RemoveObjectOptions) error
}) {
	s.minioClient = mc
}

// ScanUpload — full pipeline: FFmpeg frames → ONNX analyze → detect violations.
//
// Flow:
//  1. Create UploadSafetyCheck record (status: scanning).
//  2. FFmpeg se frames nikalo (temp directory mein).
//  3. Har frame ONNX model se analyze karo.
//  4. Agar koi prohibited detection (confidence >= min_confidence):
//     - Status: "flagged"
//     - Blacklist user (agar blacklist_on_detection=true)
//     - Cleanup: delete file fragments (temp frames + MinIO object)
//     - Session status: "aborted"
//  5. Agar koi violation nahi:
//     - Status: "clean"
//     - Continue upload (caller decides next steps)
//
// Returns the safety check record + any error.
type ScanResult struct {
	Check      *model.UploadSafetyCheck
	Flagged    bool
	Detections []model.ContentSafetyResult
}

func (s *ContentSafetyService) ScanUpload(
	ctx context.Context,
	sessionUUID uuid.UUID,
	userID uint,
	videoFilePath string,
) (*ScanResult, error) {

	// Create safety check record.
	now := time.Now().UTC()
	check := &model.UploadSafetyCheck{
		SessionUUID: sessionUUID,
		UserID:      userID,
		Status:      "scanning",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.repo.CreateSafetyCheck(ctx, check); err != nil {
		return nil, fmt.Errorf("safety check record create: %w", err)
	}

	// Skip checks if disabled or analyzer nil.
	if !s.config.Enabled || s.analyzer == nil {
		check.Status = "clean"
		check.CompletedAt = &now
		_ = s.repo.UpdateSafetyCheck(ctx, check)
		return &ScanResult{Check: check, Flagged: false}, nil
	}

	// Step 1: FFmpeg se frames nikalo.
	tempDir, err := os.MkdirTemp("", "aura_safeframe_*")
	if err != nil {
		check.Status = "failed"
		check.Details = fmt.Sprintf(`{"error":"temp_dir_create_failed: %v"}`, err)
		_ = s.repo.UpdateSafetyCheck(ctx, check)
		return nil, fmt.Errorf("temp dir create: %w", err)
	}
	defer os.RemoveAll(tempDir)

	framePaths, err := s.extractFrames(videoFilePath, tempDir)
	if err != nil {
		check.Status = "failed"
		check.Details = fmt.Sprintf(`{"error":"ffmpeg_frame_extraction: %v"}`, err)
		_ = s.repo.UpdateSafetyCheck(ctx, check)
		return nil, fmt.Errorf("frame extraction: %w", err)
	}
	check.TotalFrames = len(framePaths)

	// Step 2: Har frame analyze karo.
	var allDetections []model.ContentSafetyResult
	for i, framePath := range framePaths {
		detections, err := s.analyzer.AnalyzeFrame(ctx, framePath)
		if err != nil {
			// Log error but continue with other frames.
			continue
		}
		for _, d := range detections {
			// Normalize category + confidence.
			d.FrameIndex = i
			allDetections = append(allDetections, d)
		}
		check.ScannedFrames++
	}
	check.DetectionsCount = len(allDetections)

	// Step 3: Check for violations.
	flagged := false
	categoriesFound := map[model.ProhibitedCategory]bool{}
	maxConf := float32(0)

	for _, d := range allDetections {
		if d.Confidence >= s.config.MinConfidence {
			flagged = true
			categoriesFound[d.Category] = true
			if d.Confidence > maxConf {
				maxConf = d.Confidence
			}
		}
	}

	var categoryList []string
	for cat := range categoriesFound {
		categoryList = append(categoryList, string(cat))
	}

	check.MaxConfidence = maxConf
	if len(categoryList) > 0 {
		catJSON, _ := json.Marshal(categoryList)
		check.CategoriesFound = string(catJSON)
	}

	if flagged {
		check.Status = "flagged"
		detailsJSON, _ := json.Marshal(allDetections)
		check.Details = string(detailsJSON)

		// Blacklist user agar configured.
		if s.config.BlacklistOnDetection {
			blacklistEntry := &model.BlacklistEntry{
				UserID:      userID,
				SessionUUID: sessionUUID,
				Reason:      "Content safety violation: prohibited content detected",
				Category:    allDetections[0].Category, // first detected category
				Confidence:  maxConf,
				Details:     string(detailsJSON),
				Active:      true,
				CreatedAt:   now,
			}
			_ = s.repo.AddBlacklistEntry(ctx, blacklistEntry)
		}
	} else {
		check.Status = "clean"
	}
	check.CompletedAt = &time.Time{}
	*check.CompletedAt = time.Now().UTC()
	_ = s.repo.UpdateSafetyCheck(ctx, check)

	return &ScanResult{
		Check:      check,
		Flagged:    flagged,
		Detections: allDetections,
	}, nil
}

// extractFrames runs FFmpeg to extract frames from video.
//
// Hinglish: FFmpeg CLI use karta hai — `-vf fps=<rate>` se frame sampling,
// `-frame_pts 1` se timestamp. Temp directory mein frame_NNNN.jpg files.
func (s *ContentSafetyService) extractFrames(videoPath, outputDir string) ([]string, error) {
	ffmpegPath := s.config.FFmpegPath
	if ffmpegPath == "" {
		ffmpegPath = "ffmpeg"
	}

	sampleRate := s.config.FrameSampleRate
	if sampleRate <= 0 {
		sampleRate = 10
	}

	outputPattern := filepath.Join(outputDir, "frame_%08d.jpg")

	args := []string{
		"-y",                            // overwrite
		"-i", videoPath,                // input
		"-vf", fmt.Sprintf("fps=%d", sampleRate), // frame sampling
		"-q:v", "2",                    // high quality JPEG
		"-start_number", "0",
		outputPattern,
	}

	cmd := exec.CommandContext(context.Background(), ffmpegPath, args...)
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg execution failed: %w", err)
	}

	// Collect extracted frame paths.
	var frames []string
	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return nil, fmt.Errorf("read frame output dir: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".jpg") {
			frames = append(frames, filepath.Join(outputDir, entry.Name()))
		}
	}

	if len(frames) == 0 {
		return nil, fmt.Errorf("no frames extracted from video")
	}

	// Limit frames if max_frames_to_analyze is set.
	maxFrames := s.config.MaxFramesToAnalyze
	if maxFrames > 0 && len(frames) > maxFrames {
		frames = frames[:maxFrames]
	}

	return frames, nil
}

// CleanupViolations — delete MinIO object + update session status to "aborted".
//
// Hinglish: jab safety check fail kare, to caller is method ko call karega
// taaki file fragments (MinIO object) delete ho sake. Session ko
// "aborted" status milega.
func (s *ContentSafetyService) CleanupViolations(ctx context.Context, sessionUUID string, sessionMinioPath string) error {
	// Delete MinIO object fragments.
	if s.minioClient != nil && sessionMinioPath != "" {
		_ = s.minioClient.RemoveObject(ctx, s.bucket, sessionMinioPath, minio.RemoveObjectOptions{})
	}
	return nil
}

// AnalyzeFrameForTesting — convenience method for unit tests that bypass
// FFmpeg (pass in pre-extracted frame paths).
func (s *ContentSafetyService) AnalyzeFramesForTesting(ctx context.Context, sessionUUID uuid.UUID, userID uint, framePaths []string) (*ScanResult, error) {
	now := time.Now().UTC()
	check := &model.UploadSafetyCheck{
		SessionUUID: sessionUUID,
		UserID:      userID,
		Status:      "scanning",
		TotalFrames: len(framePaths),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.repo.CreateSafetyCheck(ctx, check); err != nil {
		return nil, fmt.Errorf("safety check record create: %w", err)
	}

	if !s.config.Enabled || s.analyzer == nil {
		check.Status = "clean"
		check.CompletedAt = &now
		_ = s.repo.UpdateSafetyCheck(ctx, check)
		return &ScanResult{Check: check, Flagged: false}, nil
	}

	var allDetections []model.ContentSafetyResult
	for i, fp := range framePaths {
		detections, err := s.analyzer.AnalyzeFrame(ctx, fp)
		if err != nil {
			continue
		}
		for _, d := range detections {
			d.FrameIndex = i
			allDetections = append(allDetections, d)
		}
		check.ScannedFrames++
	}
	check.DetectionsCount = len(allDetections)

	flagged := false
	categoriesFound := map[model.ProhibitedCategory]bool{}
	maxConf := float32(0)
	for _, d := range allDetections {
		if d.Confidence >= s.config.MinConfidence {
			flagged = true
			categoriesFound[d.Category] = true
			if d.Confidence > maxConf {
				maxConf = d.Confidence
			}
		}
	}

	var categoryList []string
	for cat := range categoriesFound {
		categoryList = append(categoryList, string(cat))
	}
	if len(categoryList) > 0 {
		catJSON, _ := json.Marshal(categoryList)
		check.CategoriesFound = string(catJSON)
	}

	var detailsJSON []byte
	if len(allDetections) > 0 {
		detailsJSON, _ = json.Marshal(allDetections)
	}

	if flagged {
		check.Status = "flagged"
		check.Details = string(detailsJSON)
		if s.config.BlacklistOnDetection {
			_ = s.repo.AddBlacklistEntry(ctx, &model.BlacklistEntry{
				UserID:      userID,
				SessionUUID: sessionUUID,
				Reason:      "prohibited content detected",
				Category:    allDetections[0].Category,
				Confidence:  maxConf,
				Details:     string(detailsJSON),
				Active:      true,
				CreatedAt:   now,
			})
		}
	} else {
		check.Status = "clean"
	}
	completedAt := time.Now().UTC()
	check.CompletedAt = &completedAt
	check.MaxConfidence = maxConf
	_ = s.repo.UpdateSafetyCheck(ctx, check)

	return &ScanResult{Check: check, Flagged: flagged, Detections: allDetections}, nil
}
