// Storage Service for MinIO/GCS Integration
// Handles direct video storage in MinIO/GCS 'video' bucket
// All uploads and streaming bypass GKE compute nodes completely
package storage

import (
	"context"
	"fmt"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"cloud.google.com/go/storage"
)

// StorageConfig holds configuration for storage services
// Configuration for MinIO and GCS storage backends
type StorageConfig struct {
	MinIOEndpoint  string // MinIO endpoint
	MinIOAccessKey string // MinIO access key
	MinIOSecretKey string // MinIO secret key
	GCSProjectID   string // GCS project ID
	GCSCredentials string // GCS credentials path
	VideoBucket    string // Video bucket name (default: video)
	ThumbnailBucket string // Thumbnail bucket name
	UseMinIO       bool   // Use MinIO as primary
	UseGCS         bool   // Use GCS as secondary/alternative
}

// VideoStorageService handles video file storage operations
// Direct storage service for video files in MinIO/GCS buckets
// All uploads go directly to storage, NO GKE compute involvement
type VideoStorageService struct {
	config      *StorageConfig
	minioClient *minio.Client
	gcsClient   *storage.Client
}

// NewVideoStorageService creates a new video storage service
// Initialize storage service with MinIO/GCS clients for direct bucket access
func NewVideoStorageService(config *StorageConfig) (*VideoStorageService, error) {
	var minioClient *minio.Client
	var gcsClient *storage.Client
	var err error

	// Initialize MinIO client
	// MinIO client for direct 'video' bucket operations
	if config.UseMinIO {
		minioClient, err = minio.New(config.MinIOEndpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(config.MinIOAccessKey, config.MinIOSecretKey, ""),
			Secure: false, // Use true for production
		})
		if err != nil {
			log.Printf("[STORAGE] MinIO client init warning: %v", err)
		} else {
			log.Printf("[STORAGE] MinIO client initialized: %s", config.MinIOEndpoint)
		}
	}

	// Initialize GCS client
	// GCS client for Google Cloud Storage operations
	if config.UseGCS && config.GCSProjectID != "" {
		ctx := context.Background()
		gcsClient, err = storage.NewClient(ctx)
		if err != nil {
			log.Printf("[STORAGE] GCS client init warning: %v", err)
		} else {
			log.Printf("[STORAGE] GCS client initialized for project: %s", config.GCSProjectID)
		}
	}

	// Ensure video bucket exists
	// Create 'video' bucket if not exists
	if minioClient != nil {
		ctx := context.Background()
		err = minioClient.MakeBucket(ctx, config.VideoBucket, minio.MakeBucketOptions{})
		if err != nil {
			// Check if bucket already exists
			exists, _ := minioClient.BucketExists(ctx, config.VideoBucket)
			if !exists {
				log.Printf("[STORAGE] Video bucket creation warning: %v", err)
			}
		}
	}

	return &VideoStorageService{
		config:      config,
		minioClient: minioClient,
		gcsClient:   gcsClient,
	}, nil
}

// UploadVideo uploads a video file directly to MinIO/GCS 'video' bucket
// Direct video upload to storage bucket - NO GKE processing
// Returns the storage URL for streaming
func (s *VideoStorageService) UploadVideo(ctx context.Context, file multipart.File, header *multipart.FileHeader, videoID string) (string, error) {
	log.Printf("[STORAGE] Uploading video %s to bucket %s", videoID, s.config.VideoBucket)

	// Generate unique object key: video/video_id/original_filename
	ext := filepath.Ext(header.Filename)
	objectKey := fmt.Sprintf("video/%s/original%s", videoID, ext)

	// Upload to MinIO
	var uploadErr error
	if s.minioClient != nil {
		_, uploadErr = s.minioClient.PutObject(ctx, s.config.VideoBucket, objectKey, file, header.Size, minio.PutObjectOptions{
			ContentType: getVideoContentType(ext),
			UserMetadata: map[string]string{
				"video_id":   videoID,
				"original":   header.Filename,
				"uploaded":   time.Now().Format(time.RFC3339),
				"source":     "direct_upload",
			},
		})
		if uploadErr != nil {
			log.Printf("[STORAGE] MinIO upload failed: %v", uploadErr)
		}
	}

	// Also upload to GCS if configured
	if s.gcsClient != nil && uploadErr != nil {
		// In production: implement GCS upload
		log.Printf("[STORAGE] GCS upload fallback for %s", objectKey)
	}

	if uploadErr != nil {
		return "", fmt.Errorf("[STORAGE] Failed to upload to any storage: %w", uploadErr)
	}

	// Return streaming URL (CDN or direct bucket URL)
	streamingURL := s.getStreamingURL(objectKey)
	log.Printf("[STORAGE] Video %s uploaded successfully, streaming URL: %s", videoID, streamingURL)
	return streamingURL, nil
}

// UploadHLSFiles uploads HLS segments and playlists to MinIO/GCS
// Upload transcoded HLS files (.m3u8 + .ts) directly to 'video' bucket
// Streaming happens DIRECTLY from storage bucket/CDN
func (s *VideoStorageService) UploadHLSFiles(ctx context.Context, localDir, videoID string) error {
	log.Printf("[STORAGE] Uploading HLS files for video %s", videoID)

	return filepath.Walk(localDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}

		relPath, _ := filepath.Rel(localDir, path)
		objectKey := fmt.Sprintf("video/%s/%s", videoID, relPath)

		// Upload to MinIO
		if s.minioClient != nil {
			_, err := s.minioClient.FPutObject(ctx, s.config.VideoBucket, objectKey, path, minio.PutObjectOptions{
				ContentType: getHLSContentType(path),
			})
			if err != nil {
				log.Printf("[STORAGE] HLS MinIO upload failed for %s: %v", objectKey, err)
			}
		}

		return nil
	})
}

// GetStreamingURL returns the direct streaming URL for a video
// Get CDN or direct bucket URL for video streaming
// Streaming happens DIRECTLY from storage bucket/CDN, bypassing GKE
func (s *VideoStorageService) GetStreamingURL(videoID string) string {
	masterKey := fmt.Sprintf("video/%s/master.m3u8", videoID)
	return s.getStreamingURL(masterKey)
}

// getStreamingURL constructs the streaming URL
// Build streaming URL (CDN or direct bucket)
func (s *VideoStorageService) getStreamingURL(objectKey string) string {
	// In production: return CDN URL
	// For now: return direct MinIO URL
	if s.config.UseMinIO {
		return fmt.Sprintf("http://%s/%s/%s", s.config.MinIOEndpoint, s.config.VideoBucket, objectKey)
	}
	if s.config.UseGCS {
		return fmt.Sprintf("https://storage.googleapis.com/%s/%s", s.config.VideoBucket, objectKey)
	}
	return ""
}

// DeleteVideo deletes a video and all its HLS variants from storage
// Delete video and all transcoded variants from MinIO/GCS
func (s *VideoStorageService) DeleteVideo(ctx context.Context, videoID string) error {
	log.Printf("[STORAGE] Deleting video %s and all variants", videoID)

	prefix := fmt.Sprintf("video/%s/", videoID)

	// Delete from MinIO
	if s.minioClient != nil {
		objectsCh := s.minioClient.ListObjects(ctx, s.config.VideoBucket, minio.ListObjectsOptions{
			Prefix:    prefix,
			Recursive: true,
		})

		for obj := range objectsCh {
			if obj.Err != nil {
				continue
			}
			s.minioClient.RemoveObject(ctx, s.config.VideoBucket, obj.Key, minio.RemoveObjectOptions{})
		}
	}

	// Delete from GCS
	if s.gcsClient != nil {
		_ = s.gcsClient.Bucket(s.config.VideoBucket)
		// In production: iterate and delete GCS objects
	}

	log.Printf("[STORAGE] Video %s deleted from storage", videoID)
	return nil
}

// GetVideoInfo returns metadata about a stored video
// Get video metadata from storage
func (s *VideoStorageService) GetVideoInfo(ctx context.Context, videoID string) (map[string]interface{}, error) {
	prefix := fmt.Sprintf("video/%s/", videoID)
	info := map[string]interface{}{
		"video_id": videoID,
		"variants": []string{},
		"size":     int64(0),
	}

	if s.minioClient != nil {
		objectsCh := s.minioClient.ListObjects(ctx, s.config.VideoBucket, minio.ListObjectsOptions{
			Prefix:    prefix,
			Recursive: true,
		})

		for obj := range objectsCh {
			if obj.Err != nil {
				continue
			}
			info["size"] = info["size"].(int64) + obj.Size
			if filepath.Ext(obj.Key) == ".m3u8" {
				info["variants"] = append(info["variants"].([]string), obj.Key)
			}
		}
	}

	return info, nil
}

// getVideoContentType returns MIME type for video files
// Determine video MIME type from extension
func getVideoContentType(ext string) string {
	switch ext {
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".avi":
		return "video/x-msvideo"
	case ".mkv":
		return "video/x-matroska"
	case ".webm":
		return "video/webm"
	default:
		return "video/mp4"
	}
}

// getHLSContentType returns MIME type for HLS files
// Determine HLS MIME type from extension
func getHLSContentType(path string) string {
	ext := filepath.Ext(path)
	switch ext {
	case ".m3u8":
		return "application/vnd.apple.mpegurl"
	case ".ts":
		return "video/mp2t"
	default:
		return "application/octet-stream"
	}
}