package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
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

func (s *UploadService) InitSession(ctx context.Context, userID uint, filename, contentType string, fileSize int64) (*model.UploadSession, error) {
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
		ExpiresAt:   time.Now().Add(24 * time.Hour),
	}

	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, err
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
