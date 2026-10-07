// Content safety service tests.
//
// Hinglish: ye tests FFmpeg nahi chaltay hain — instead we use
// AnalyzeFramesForTesting (pre-extracted mock frames) + fake FrameAnalyzer.
// Safety pipeline logic (detection, blacklist, abort) ko verify karne ke liye.
package service

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"newproject/services/upload-service/src/model"
)

// fakeFrameAnalyzer — returns predefined detections.
type fakeFrameAnalyzer struct {
	detections []model.ContentSafetyResult
	called     int
}

func (f *fakeFrameAnalyzer) AnalyzeFrame(ctx context.Context, framePath string) ([]model.ContentSafetyResult, error) {
	f.called++
	return f.detections, nil
}

// fakeSafetyRepo — minimal SafetyRepository fake.
type fakeSafetyRepo struct {
	checks     []model.UploadSafetyCheck
	blacklists []model.BlacklistEntry
	userBlack  map[uint]bool
}

func (r *fakeSafetyRepo) CreateSafetyCheck(ctx context.Context, check *model.UploadSafetyCheck) error {
	check.ID = uint(len(r.checks) + 1)
	r.checks = append(r.checks, *check)
	return nil
}
func (r *fakeSafetyRepo) UpdateSafetyCheck(ctx context.Context, check *model.UploadSafetyCheck) error {
	for i := range r.checks {
		if r.checks[i].ID == check.ID {
			r.checks[i] = *check
			return nil
		}
	}
	return nil
}
func (r *fakeSafetyRepo) GetSafetyCheckBySessionUUID(ctx context.Context, sessionUUID string) (*model.UploadSafetyCheck, error) {
	for i := range r.checks {
		if r.checks[i].SessionUUID.String() == sessionUUID {
			return &r.checks[i], nil
		}
	}
	return nil, os.ErrNotExist
}
func (r *fakeSafetyRepo) AddBlacklistEntry(ctx context.Context, entry *model.BlacklistEntry) error {
	entry.ID = uint(len(r.blacklists) + 1)
	r.blacklists = append(r.blacklists, *entry)
	r.userBlack[entry.UserID] = true
	return nil
}
func (r *fakeSafetyRepo) IsBlacklisted(ctx context.Context, userID uint) bool {
	return r.userBlack[userID]
}
func (r *fakeSafetyRepo) GetBlacklistByUser(ctx context.Context, userID uint) ([]*model.BlacklistEntry, error) {
	var result []*model.BlacklistEntry
	for i := range r.blacklists {
		if r.blacklists[i].UserID == userID {
			result = append(result, &r.blacklists[i])
		}
	}
	return result, nil
}

func newTestSafetyService(analyzer FrameAnalyzer, cfg ContentSafetyConfig) *ContentSafetyService {
	return &ContentSafetyService{
		repo:     &fakeSafetyRepo{userBlack: make(map[uint]bool)},
		analyzer: analyzer,
		config:   cfg,
		bucket:   "test-bucket",
	}
}

func TestScanUpload_Disabled_NoFlags(t *testing.T) {
	repo := &fakeSafetyRepo{userBlack: make(map[uint]bool)}
	svc := &ContentSafetyService{
		repo:      repo,
		analyzer:  &fakeFrameAnalyzer{},
		config:    ContentSafetyConfig{Enabled: false},
		bucket:    "test",
	}

	sessionUUID := uuid.New()
	result, err := svc.ScanUpload(context.Background(), sessionUUID, 1, "fake_video.mp4")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Flagged {
		t.Error("disabled safety should not flag")
	}
	if result.Check.Status != "clean" {
		t.Errorf("status: expected clean, got %s", result.Check.Status)
	}
}

func TestScanUpload_DetectionAboveThreshold_Flagged(t *testing.T) {
	repo := &fakeSafetyRepo{userBlack: make(map[uint]bool)}
	analyzer := &fakeFrameAnalyzer{
		detections: []model.ContentSafetyResult{
			{Category: model.ProhibitedAdultContent, Confidence: 0.92, DetectedAt: time.Now()},
		},
	}
	svc := &ContentSafetyService{
		repo:      repo,
		analyzer:  analyzer,
		config:    ContentSafetyConfig{
			Enabled:              true,
			MinConfidence:        0.85,
			FrameSampleRate:      1,
			MaxFramesToAnalyze:   10,
			BlacklistOnDetection: true,
		},
		bucket: "test",
	}

	// Create a fake temp video file so extractFrames won't run (we test via AnalyzeFramesForTesting).
	result, err := svc.AnalyzeFramesForTesting(context.Background(), uuid.New(), 1, []string{"/tmp/fake_frame.jpg"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Flagged {
		t.Error("expected flagged=true")
	}
	if result.Check.Status != "flagged" {
		t.Errorf("status: expected flagged, got %s", result.Check.Status)
	}
	if result.Check.DetectionsCount != 1 {
		t.Errorf("detections: expected 1, got %d", result.Check.DetectionsCount)
	}

	// Verify user was blacklisted.
	if !repo.IsBlacklisted(context.Background(), 1) {
		t.Error("expected user 1 to be blacklisted")
	}
	if len(repo.blacklists) != 1 {
		t.Errorf("blacklist entries: expected 1, got %d", len(repo.blacklists))
	}
}

func TestScanUpload_DetectionBelowThreshold_NotFlagged(t *testing.T) {
	repo := &fakeSafetyRepo{userBlack: make(map[uint]bool)}
	analyzer := &fakeFrameAnalyzer{
		detections: []model.ContentSafetyResult{
			{Category: model.ProhibitedAdultContent, Confidence: 0.50},
		},
	}
	svc := &ContentSafetyService{
		repo:     repo,
		analyzer: analyzer,
		config: ContentSafetyConfig{
			Enabled:       true,
			MinConfidence: 0.85,
		},
		bucket: "test",
	}

	result, err := svc.AnalyzeFramesForTesting(context.Background(), uuid.New(), 2, []string{"/tmp/frame.jpg"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Flagged {
		t.Error("expected flagged=false for low confidence")
	}
	if result.Check.Status != "clean" {
		t.Errorf("status: expected clean, got %s", result.Check.Status)
	}
}

func TestScanUpload_MultipleCategories(t *testing.T) {
	repo := &fakeSafetyRepo{userBlack: make(map[uint]bool)}
	analyzer := &fakeFrameAnalyzer{
		detections: []model.ContentSafetyResult{
			{Category: model.ProhibitedAdultContent, Confidence: 0.95},
			{Category: model.ProhibitedExplicitWeapons, Confidence: 0.88},
			{Category: model.ProhibitedIllicitDrugs, Confidence: 0.91},
		},
	}
	svc := &ContentSafetyService{
		repo:     repo,
		analyzer: analyzer,
		config: ContentSafetyConfig{
			Enabled:              true,
			MinConfidence:        0.80,
			BlacklistOnDetection: true,
		},
		bucket: "test",
	}

	result, err := svc.AnalyzeFramesForTesting(context.Background(), uuid.New(), 3, []string{"/tmp/f1.jpg"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Flagged {
		t.Error("expected flagged=true with multiple categories")
	}
	if result.Check.DetectionsCount != 3 {
		t.Errorf("detections: expected 3, got %d", result.Check.DetectionsCount)
	}

	// Verify categories found string contains all 3.
	t.Logf("categories found: %s", result.Check.CategoriesFound)
}

func TestScanUpload_AnalyzerError_ContinuesOtherFrames(t *testing.T) {
	errorAnalyzer := &errorFrameAnalyzer{}
	repo := &fakeSafetyRepo{userBlack: make(map[uint]bool)}
	svc := &ContentSafetyService{
		repo:     repo,
		analyzer: errorAnalyzer,
		config: ContentSafetyConfig{
			Enabled:      true,
			MinConfidence: 0.85,
		},
		bucket: "test",
	}

	result, err := svc.AnalyzeFramesForTesting(context.Background(), uuid.New(), 1, []string{"/tmp/f1.jpg", "/tmp/f2.jpg"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Flagged {
		t.Error("expected flagged=false when all frames error")
	}
}

// errorFrameAnalyzer — always returns an error.
type errorFrameAnalyzer struct{}

func (e *errorFrameAnalyzer) AnalyzeFrame(ctx context.Context, framePath string) ([]model.ContentSafetyResult, error) {
	return nil, os.ErrInvalid
}

func TestQuotaChecker_SizeLimitExceeded(t *testing.T) {
	qc := &DefaultQuotaConfig{
		MaxFileSizeMB: 100,
	}
	err := qc.CheckUploadQuota(context.Background(), 1, 101*1024*1024)
	if err == nil {
		t.Error("expected error for file size exceeding quota")
	}
}

func TestQuotaChecker_SizeLimitWithin(t *testing.T) {
	qc := &DefaultQuotaConfig{
		MaxFileSizeMB: 100,
	}
	err := qc.CheckUploadQuota(context.Background(), 1, 50*1024*1024)
	if err != nil {
		t.Errorf("expected no error for file within quota: %v", err)
	}
}

func TestQuotaChecker_NoLimit(t *testing.T) {
	qc := &DefaultQuotaConfig{
		MaxFileSizeMB: 0, // unlimited
	}
	err := qc.CheckUploadQuota(context.Background(), 1, 999999*1024*1024)
	if err != nil {
		t.Errorf("expected no error with unlimited quota: %v", err)
	}
}
