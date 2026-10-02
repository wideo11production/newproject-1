package service

// Media upload: the presigned-PUT ticket for video and audio source files.
//
// =============================================================================
// WHAT REPLACES WHAT
// =============================================================================
//
// There is a `services/upload-service` on disk (701 lines, chunked upload through
// the service, six routes). It is NOT being adopted, and the reasons are not
// stylistic:
//
//   1. IT HAS NO AUTHENTICATION. Its middleware is `gin.Logger()` and
//      `gin.Recovery()`, nothing else. So `GET /uploads/:uuid/status` is an IDOR -
//      anyone who learns a UUID can read another user's filename, size, status and
//      MinIO object path. And `POST /uploads/cleanup` is an unauthenticated
//      mutation that deletes rows.
//
//   2. ITS `UserID` IS A `uint`. `auth_service.users.id` is a `uuid`. So it needs
//      a second answer to "where does a user live" - the exact anti-pattern that
//      makes a codebase impossible to reason about. It also declares
//      `port: "8085"`, the same port as auth-service.
//
//   3. CHUNKED-THROUGH-THE-SERVICE IS THE WRONG SHAPE FOR VIDEO. The budget here
//      is 8 GB. Funnelling that through a Go handler holds a request open for
//      minutes, ties up a worker for the whole transfer, and makes retries
//      hopeless - a dropped connection at 90% loses the upload.
//
// The browser PUTs straight to MinIO with a presigned URL. This file mints that
// URL and validates the claim; it never touches the bytes, and it never touches
// the database - `StorageService` has no `db` handle and should not grow one. The
// `MediaService` next door owns the `media_assets` row and the quota.
//
// Everything MinIO-related is REUSED from the image path - `buildObjectKey`,
// `presignedPutURL`, `publicObjectURL`, `EnsureBucket` - rather than
// reimplemented. Only the VALIDATION is new, because `createImageUploadTicket`
// hardcodes `validateImageUpload`.

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Media upload limits. The `.env` values from SYSTEM-PLAN.md §10 feed the
// accessors in `media_limits.go`; these are the fallbacks used when they are unset.
const (
	// DefaultMaxMediaBytes - 8 GB. Matches `UPLOAD_MAX_BYTES`.
	DefaultMaxMediaBytes int64 = 8 * 1024 * 1024 * 1024

	// DefaultMaxReelBytes - 512 MB for reels. Reels are short and vertical, so
	// this is already generous - and deliberately far below the long-form cap, so
	// the short-clip path cannot be used to push 8 GB through a route that
	// promises short vertical videos.
	DefaultMaxReelBytes int64 = 512 * 1024 * 1024

	// DefaultMaxReelSeconds - 90s.
	//
	// 90 is the ceiling Instagram, TikTok and YouTube Shorts all accept without a
	// split, so a reel above it would be rejected on upload rather than trimmed.
	// Shorts caps at 60s for the shelf, which `ReelPlatformChecks` handles per
	// destination.
	DefaultMaxReelSeconds = 90

	// DefaultMaxMediaDurationSeconds - 4 hours, long-form.
	DefaultMaxMediaDurationSeconds = 4 * 60 * 60
)

// allowedMediaTypes is the content-type allowlist.
//
// An allowlist, not a denylist: a denylist has to be updated every time something
// new turns out to be dangerous, and the thing that turns out to be dangerous is
// always the thing nobody thought of.
var allowedMediaTypes = map[string]bool{
	"video/mp4":        true, // .mp4  - universal, and what browsers can seek
	"video/webm":       true, // .webm - VP8/VP9; what MediaRecorder produces
	"video/quicktime":  true, // .mov  - what iPhones actually record
	"video/x-matroska": true, // .mkv  - the common raw-camera container
	"audio/mpeg":       true, // .mp3  - audio-only uploads
	"audio/wav":        true, // .wav
}

// allowedMediaExtensions maps extension -> the ONE content type it may claim.
//
// One value per extension, deliberately. If `.mp4` could be declared as
// `video/quicktime`, the declared type stops meaning anything and the content
// type - which is what downstream tooling trusts - becomes decoration.
var allowedMediaExtensions = map[string]string{
	".mp4":  "video/mp4",
	".m4v":  "video/mp4",
	".webm": "video/webm",
	".mov":  "video/quicktime",
	".mkv":  "video/x-matroska",
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
}

// validateMediaUpload checks a client's CLAIM about the file it is about to upload.
//
// IMPORTANT: this validates a claim, not the file. A caller can send any content
// type and extension it likes. That is why the actual bytes are re-checked by
// DECODING them at the `scanning` stage (ffprobe) - see `MediaAsset`. This
// function rejects mistakes cheaply and early so a user does not upload 4 GB
// before being told the format is wrong. It is not the security boundary, and
// nothing here should be described as one.
func validateMediaUpload(filename, mimeType string) (normalized, ext string, err error) {
	// ---- 1. Content type ----
	normalized = strings.ToLower(strings.TrimSpace(mimeType))
	// Browsers append a charset to the odd media type. Take the type, drop the
	// parameters, rather than failing on a cosmetic difference.
	if idx := strings.Index(normalized, ";"); idx >= 0 {
		normalized = strings.TrimSpace(normalized[:idx])
	}
	if !allowedMediaTypes[normalized] {
		return "", "", fmt.Errorf(
			"unsupported media type %q - allowed: mp4, webm, mov, mkv, mp3, wav", mimeType)
	}

	// ---- 2. Extension, cross-checked against the type ----
	//
	// Both halves are required. A `.php` renamed to `.mp4` passes the extension
	// check and fails nothing here either - which is exactly why the decode at
	// `scanning` is the real gate.
	ext = strings.ToLower(filepath.Ext(filename))
	expected, ok := allowedMediaExtensions[ext]
	if !ok {
		return "", "", fmt.Errorf(
			"unsupported file extension %q - allowed: %s", ext, strings.Join(allowedMediaExtList(), ", "))
	}
	if expected != normalized {
		return "", "", fmt.Errorf(
			"file extension (%s) does not match content type (%s) - %s must be %s",
			ext, normalized, ext, expected)
	}

	return normalized, ext, nil
}

func allowedMediaExtList() []string {
	out := make([]string, 0, len(allowedMediaExtensions))
	for e := range allowedMediaExtensions {
		out = append(out, e)
	}
	return out
}

// CreateMediaUploadTicket mints a presigned PUT so the browser can upload
// DIRECTLY to MinIO.
//
// Why presigned rather than chunked through us: an 8 GB body through a Go
// handler holds a request open for minutes and blocks a worker for the whole
// transfer. With a presigned URL the bytes never touch this process, so a dropped
// connection is the browser's problem to retry against the same key rather than
// ours to resume.
//
// `ensureBucket=false`, like the cover ticket: the video bucket is created by
// `minio-init`, and the scoped service account has no `s3:CreateBucket`. `true`
// would only make `EnsureBucket` do an existence check, which costs a round trip
// to learn something the bucket's own error message would tell us.
func (s *StorageService) CreateMediaUploadTicket(
	ctx context.Context,
	userID uuid.UUID,
	filename, mimeType string,
) (*UploadTicket, error) {
	normalized, ext, err := validateMediaUpload(filename, mimeType)
	if err != nil {
		return nil, err
	}

	if err := s.EnsureBucket(ctx); err != nil {
		return nil, err
	}

	objectKey, err := buildObjectKey(userID, ext)
	if err != nil {
		return nil, err
	}

	bucket := s.cfg.GetVideoBucket()
	ttl := time.Duration(s.cfg.GetPresignTTL()) * time.Minute

	uploadURL, err := s.presignedPutURL(ctx, bucket, objectKey, ttl)
	if err != nil {
		return nil, err
	}

	return &UploadTicket{
		ObjectKey:        objectKey,
		UploadURL:        uploadURL,
		PublicURL:        s.publicObjectURL(bucket, objectKey),
		Method:           "PUT",
		ExpiresInSeconds: int(ttl.Seconds()),
		ContentType:      normalized,
	}, nil
}
