package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"newproject/services/upload-service/src/model"
	"newproject/services/upload-service/src/repository"
)

type UploadConfig struct {
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	Bucket         string
	ChunkSize      int64
}

type UploadService struct {
	repo      repository.UploadRepository
	minio     *minio.Client
	bucket    string
	chunkSize int64
	// interceptor: educational content + frames check (nil = skip checks)
	interceptor *EducationalViolationInterceptor
	framesChecker *FramesChecker
	// safety: content safety filter (FFmpeg + ONNX) — nil = disabled
	safety *ContentSafetyService
	// quota: per-user upload volume limits (.env config) — nil = unlimited
	quota QuotaChecker
}

func NewUploadService(cfg UploadConfig, repo repository.UploadRepository) (*UploadService, error) {
	minioClient, err := minio.New(cfg.MinioEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioAccessKey, cfg.MinioSecretKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, err
	}

	return &UploadService{
		repo:      repo,
		minio:     minioClient,
		bucket:    cfg.Bucket,
		chunkSize: cfg.ChunkSize,
	}, nil
}

// SetInterceptor wires the educational violation + frames checker.
//
// Hinglish: interceptor optional hai (nil = no checks). Billing-service
// ke student status ke liye interface use karta hai — cross-module
// circular dependency avoid karne ke liye.
func (s *UploadService) SetInterceptor(interceptor *EducationalViolationInterceptor, frames *FramesChecker) {
	s.interceptor = interceptor
	s.framesChecker = frames
}

// SetContentSafety wires the FFmpeg + ONNX content safety filter.
// Hinglish: agar nil rakha jaye to safety checks skip honge (development mode).
func (s *UploadService) SetContentSafety(safety *ContentSafetyService) {
	s.safety = safety
}

// SetQuotaChecker wires per-user upload quota limits (.env config).
func (s *UploadService) SetQuotaChecker(qc QuotaChecker) {
	s.quota = qc
}

// Client returns the MinIO client (used by safety service for cleanup).
func (s *UploadService) Client() *minio.Client {
	return s.minio
}

// checkQuota validates upload against .env quota limits.
func (s *UploadService) checkQuota(ctx context.Context, userID uint, fileSize int64) error {
	if s.quota == nil {
		return nil
	}
	return s.quota.CheckUploadQuota(ctx, userID, fileSize)
}

// isBlacklisted checks if user is on content safety blacklist.
func (s *UploadService) isBlacklisted(ctx context.Context, userID uint) (bool, []*model.BlacklistEntry, error) {
	if s.safety == nil || s.safety.repo == nil {
		return false, nil, nil
	}
	isListed := s.safety.repo.IsBlacklisted(ctx, userID)
	if !isListed {
		return false, nil, nil
	}
	entries, err := s.safety.repo.GetBlacklistByUser(ctx, userID)
	return true, entries, err
}

// checkViolations runs interceptor checks if wired. Returns violations
// (non-nil slice) or nil (all OK). Also returns error on internal failure.
func (s *UploadService) checkViolations(ctx context.Context, session *model.UploadSession) ([]*UploadViolation, error) {
	if s.interceptor == nil {
		return nil, nil // checks disabled
	}
	return s.interceptor.CheckAll(ctx, session, s.framesChecker)
}

func (s *UploadService) InitSession(ctx context.Context, userID uint, filename, contentType string, fileSize int64, category string) (*model.UploadSession, error) {

	// Step 1: Quota check (.env config) — before creating session.
	if err := s.checkQuota(ctx, userID, fileSize); err != nil {
		return nil, fmt.Errorf("quota check failed: %w", err)
	}

	totalChunks := fileSize / s.chunkSize
	if fileSize%s.chunkSize != 0 {
		totalChunks++
	}

	session := &model.UploadSession{
		UUID:        uuid.New(),
		UserID:      userID,
		Filename:    filename,
		ContentType: contentType,
		FileSize:    fileSize,
		TotalChunks: int(totalChunks),
		Status:      "pending",
		MinioPath:   fmt.Sprintf("uploads/%d/%s", userID, uuid.New()),
		Category:    category,
		ExpiresAt:   time.Now().Add(24 * time.Hour),
	}

	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, err
	}

	// Blacklist check — AURA content safety guard.
	// Hinglish: agar user content safety violation se blacklisted hai
	// to upload reject karo without processing.
	if s.safety != nil {
		if blacklisted, _, _ := s.isBlacklisted(ctx, userID); blacklisted {
			session.Status = "blacklisted"
			_ = s.repo.UpdateSession(ctx, session)
			return nil, fmt.Errorf("upload rejected: user is blacklisted due to content safety violation")
		}
	}

	// Interceptor check — educational content + frames validation.
	// Hinglish: violation milne par session reject karo, block karke
	// bachao. Non-blocking violations log karo.
	violations, err := s.checkViolations(ctx, session)
	if err != nil {
		return nil, fmt.Errorf("interceptor error: %w", err)
	}
	if len(violations) > 0 {
		return nil, fmt.Errorf("upload rejected: %s (category=%s)",
			violations[0].Reason, session.Category)
	}

	uploadURL, err := s.minio.PresignedPutObject(ctx, s.bucket, fmt.Sprintf("%s/session_%d", session.MinioPath, session.ID), 24*time.Hour)
	if err != nil {
		return nil, err
	}
	session.UploadURL = uploadURL.String()

	if err := s.repo.UpdateSession(ctx, session); err != nil {
		return nil, err
	}

	return session, nil
}

func (s *UploadService) UploadChunk(ctx context.Context, sessionUUID string, chunkNum int, data []byte) error {
	session, err := s.repo.GetSessionByUUID(ctx, sessionUUID)
	if err != nil {
		return err
	}

	if session.Status == "completed" {
		return fmt.Errorf("session already completed")
	}

	session.Status = "uploading"
	if err := s.repo.UpdateSession(ctx, session); err != nil {
		return err
	}

	chunkKey := fmt.Sprintf("%s/chunk_%d", session.MinioPath, chunkNum)
	_, err = s.minio.PutObject(ctx, s.bucket, chunkKey, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{
			ContentType: "application/octet-stream",
		})
	if err != nil {
		return err
	}

	chunk := &model.UploadChunk{
		SessionID:   session.ID,
		ChunkNumber: chunkNum,
		Size:        int64(len(data)),
		MinioKey:    chunkKey,
	}
	if err := s.repo.CreateChunk(ctx, chunk); err != nil {
		return err
	}

	session.UploadedChunks++
	if session.UploadedChunks >= session.TotalChunks {
		session.Status = "ready_for_assembly"
	}
	if err := s.repo.UpdateSession(ctx, session); err != nil {
		return err
	}

	return nil
}

func (s *UploadService) AssembleUpload(ctx context.Context, sessionUUID string) (string, error) {
	session, err := s.repo.GetSessionByUUID(ctx, sessionUUID)
	if err != nil {
		return "", err
	}

	if session.UploadedChunks < session.TotalChunks {
		return "", fmt.Errorf("not all chunks uploaded: %d/%d", session.UploadedChunks, session.TotalChunks)
	}

	chunks, err := s.repo.GetChunksBySessionID(ctx, session.ID)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	hasher := sha256.New()

	for _, chunk := range chunks {
		reader, err := s.minio.GetObject(ctx, s.bucket, chunk.MinioKey, minio.GetObjectOptions{})
		if err != nil {
			return "", err
		}
		if _, err := io.Copy(io.MultiWriter(&buf, hasher), reader); err != nil {
			return "", err
		}
		reader.Close()
	}

	finalKey := fmt.Sprintf("%s/final_%s", session.MinioPath, uuid.New())
	_, err = s.minio.PutObject(ctx, s.bucket, finalKey, &buf, int64(buf.Len()),
		minio.PutObjectOptions{
			ContentType: session.ContentType,
		})
	if err != nil {
		return "", err
	}

	session.MinioPath = finalKey
	session.Status = "assembling"
	if err := s.repo.UpdateSession(ctx, session); err != nil {
		return "", err
	}

	// AURA Content Safety Guard — scan assembled video.
	// Hinglish: video fully assemble hone ke baad FFmpeg se frames nikal
	// ke ONNX model se scan karo. Prohibited content detect hone par
	// upload abort + file delete + user blacklist.
	if s.safety != nil {
		// Download assembled video to temp file for FFmpeg scanning.
		tempFile, err := os.CreateTemp("", "aura_upload_*.mp4")
		if err != nil {
			return "", fmt.Errorf("temp file create: %w", err)
		}
		tempPath := tempFile.Name()
		defer os.Remove(tempPath)

		reader, err := s.minio.GetObject(ctx, s.bucket, finalKey, minio.GetObjectOptions{})
		if err != nil {
			tempFile.Close()
			return "", fmt.Errorf("minio get for scan: %w", err)
		}
		if _, err := io.Copy(tempFile, reader); err != nil {
			tempFile.Close()
			reader.Close()
			return "", fmt.Errorf("file copy for scan: %w", err)
		}
		tempFile.Close()
		reader.Close()

		scanResult, err := s.safety.ScanUpload(ctx, session.UUID, session.UserID, tempPath)
		if err != nil {
			return "", fmt.Errorf("safety scan failed: %w", err)
		}

		if scanResult.Flagged {
			// Abort upload — delete fragments, blacklist user, mark session.
			session.Status = "aborted"
			_ = s.repo.UpdateSession(ctx, session)

			// Delete the assembled video from MinIO.
			_ = s.safety.CleanupViolations(ctx, session.UUID.String(), finalKey)

			var reasons []string
			for _, d := range scanResult.Detections {
				reasons = append(reasons, fmt.Sprintf("%s(%.2f)", d.Category, d.Confidence))
			}
			return "", fmt.Errorf("upload ABORTED: prohibited content detected: %s", strings.Join(reasons, ", "))
		}

		// Safe — clean up temp file, allow upload to complete.
		_ = os.Remove(tempPath)
	}

	session.Status = "completed"
	if err := s.repo.UpdateSession(ctx, session); err != nil {
		return "", err
	}

	_ = s.repo.DeleteChunksBySessionID(ctx, session.ID)

	return finalKey, nil
}

func (s *UploadService) GetUploadStatus(ctx context.Context, sessionUUID string) (*model.UploadSession, error) {
	return s.repo.GetSessionByUUID(ctx, sessionUUID)
}

func (s *UploadService) CancelUpload(ctx context.Context, sessionUUID string) error {
	session, err := s.repo.GetSessionByUUID(ctx, sessionUUID)
	if err != nil {
		return err
	}

	_ = s.repo.DeleteChunksBySessionID(ctx, session.ID)
	session.Status = "cancelled"
	return s.repo.UpdateSession(ctx, session)
}

func (s *UploadService) CleanupExpired(ctx context.Context) error {
	return s.repo.CleanupExpiredSessions(ctx, time.Now())
}

type UploadEvent struct {
	EventType string                 `json:"event_type"`
	SessionID uint                   `json:"session_id"`
	UUID      uuid.UUID              `json:"uuid"`
	UserID    uint                   `json:"user_id"`
	Filename  string                 `json:"filename"`
	Status    string                 `json:"status"`
	MinioPath string                 `json:"minio_path"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

func EncodeEvent(event UploadEvent) ([]byte, error) {
	return json.Marshal(event)
}
