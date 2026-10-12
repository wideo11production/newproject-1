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
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

// Media upload limits.
//
// THE SIZE LIMITS ARE GONE, AND THEY WERE NEVER REAL.
//
// `DefaultMaxMediaBytes` used to be 8 GB and `DefaultMaxReelBytes` 512 MB.
// Neither was referenced anywhere - not by `validateMediaUpload`, not by the
// handler, not by a single call site in the tree. They were a limit printed in
// the upload UI ("up to 8 GB") and a pair of constants nobody read.
//
// That is not a belt-and-braces arrangement, it is a lie in the UI: a creator
// was told their file had a ceiling while nothing was checking. So the numbers
// are removed rather than kept as honest documentation, because a documented
// ceiling that is not enforced is worse than no ceiling - it stops a creator
// from trying something that would have worked.
//
// Uploading is now free and unlimited for every plan, which is the product
// decision, and the check that MATTERS is the format allowlist below. That one is
// real and is enforced at initiate; the actual bytes are re-checked by DECODING
// at the `scanning` stage, because a declared content type is a claim and this
// function only validates the claim.
//
// WHAT REPLACED THE SIZE CHECK
//
// Nothing. There is no byte ceiling to enforce. What each KIND still has is a
// DURATION rule (a reel is short, long-form is not) and a format rule, and those
// are the two things that are actually validated below.
const (
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
// transfer. With a presigned URL the bytes never touch this process, so a
// dropped connection is the browser's problem to retry against the same key
// rather than ours to resume.
//
// ---- THE CREDENTIAL, AND WHY THIS IS NOT THE AVATAR ONE ----
//
// The URL is signed with the write-only `video`-scoped account, NOT the
// avatars account. The avatars account is deliberately scoped to `avatars` and
// `covers` (so a leak there cannot reach anyone's source media), which means a
// URL it signs for `video/...` is rejected by MinIO with `AccessDenied`.
//
// That was the actual bug: every video upload failed, and no unit test caught
// it because they all used a mocked MinIO client. A missing credential is
// therefore REFUSED here with the variable named, rather than falling back to
// an account that would produce a URL that cannot work.
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

	// Fail loudly and specifically. The failure mode of a silent fallback is
	// worse than no upload at all: a URL that uploads fine locally and is
	// denied in production, with nothing in the logs to say why.
	if s.uploadPublicClient == nil || s.uploadClient == nil {
		return nil, fmt.Errorf(
			"media uploads are not configured: MINIO_UPLOAD_ACCESS_KEY / " +
				"MINIO_UPLOAD_SECRET_KEY are missing. They belong to the write-only " +
				"minio account scoped to the video bucket - see " +
				"infrastructure/storage/policies/auth-video-uploads.json")
	}

	objectKey, err := buildObjectKey(userID, ext)
	if err != nil {
		return nil, err
	}

	bucket := s.cfg.GetVideoBucket()
	ttl := time.Duration(s.cfg.GetPresignTTL()) * time.Minute

	uploadURL, err := s.presignedVideoPut(ctx, bucket, objectKey, ttl)
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

// presignedVideoPut signs a PUT for the `video` bucket with the media account,
// against the browser-facing host.
//
// Kept as its own function because it is the single place the upload
// credentials are used. If a second upload path is ever added, it comes here -
// and if it does not, the compiler keeps this one honest.
func (s *StorageService) presignedVideoPut(
	ctx context.Context, bucket, objectKey string, ttl time.Duration,
) (string, error) {
	presigned, err := s.uploadPublicClient.PresignedPutObject(ctx, bucket, objectKey, ttl)
	if err != nil {
		return "", err
	}
	return presigned.String(), nil
}

// SignedObjectURL mints a short-lived presigned GET for one artefact of an
// asset, so a browser can actually WATCH what was uploaded.
//
// ---- THE PREFIX IS THE ASSET ID, NOT THE SOURCE OBJECT KEY ----
//
// Two different prefixes exist in this bucket and they are not the same thing:
//
//	<userID>/<random>.mp4      the SOURCE object, uploaded by the browser
//	<assetID>/1080p/...        the RENDITIONS and packaging, written by the
//	                           transcoder
//
// Signing from the object key looked right and was wrong: it produced
// `.../<random>.mp4/poster.jpg`, which is `NoSuchKey`, while the poster actually
// lives at `<assetID>/poster.jpg`. Everything the transcoder writes - every
// rendition, the poster, the filmstrip, the peaks - is keyed by the asset id,
// which is also what makes it stable across a re-upload that reuses output.
//
// ---- WHY THIS EXISTS ----
//
// The `video` bucket is PRIVATE by design (SYSTEM-PLAN R6: video is paid and
// tiered, so it is never an open URL). That is correct, and it is also why the
// `hls_public_url` and `poster_public_url` fields are misleading: a plain
// `http://minio/video/...` URL returns `AccessDenied` for everyone, so a
// finished upload was unviewable.
//
// A signed URL is the answer. The signed request is presented to MinIO AS the
// signing account, so this has to be the media account and not the avatars one -
// which is why the policy carries `s3:GetObject`.
//
// ---- OWNERSHIP IS CHECKED BY THE CALLER, NOT HERE ----
//
// MinIO has no idea who owns an object; the media rows are in Postgres. The
// handler verifies ownership before calling this. Without that check anyone with
// an asset id could sign a URL to anyone else's video, and the private bucket
// would buy nothing.
//
// `rel` is a path RELATIVE to the asset's prefix - `1080p/playlist.m3u8`,
// `poster.jpg`. Not an absolute object key: a caller must not be able to name a
// path outside its own asset.
func (s *StorageService) SignedObjectURL(
	ctx context.Context,
	assetID uuid.UUID,
	rel string,
) (string, int, error) {
	// ---- Validate the path FIRST ----
	//
	// Before the credential check, deliberately: a malformed path is the caller's
	// fault and costs nothing to reject, whereas reaching the config check first
	// would report a missing credential for a request that was invalid anyway.
	// It also makes the traversal rules unit-testable without a MinIO client.
	trimmed := strings.TrimSpace(rel)
	if trimmed == "" {
		return "", 0, fmt.Errorf("no object requested")
	}
	if filepath.IsAbs(trimmed) || strings.HasPrefix(trimmed, "/") {
		return "", 0, fmt.Errorf("object path may not escape the asset prefix")
	}
	for _, seg := range strings.Split(trimmed, "/") {
		if seg == ".." {
			return "", 0, fmt.Errorf("object path may not escape the asset prefix")
		}
	}
	clean := filepath.Clean(trimmed)
	if clean == "." {
		return "", 0, fmt.Errorf("no object requested")
	}

	if s.uploadPublicClient == nil {
		return "", 0, fmt.Errorf(
			"media playback is not configured: MINIO_UPLOAD_ACCESS_KEY / " +
				"MINIO_UPLOAD_SECRET_KEY are missing")
	}

	// The asset id, which is the transcoder's key prefix for everything this
	// asset produced. See the note above. `clean` is already traversal-free and
	// has no leading slash, so this cannot become an absolute key.
	full := assetID.String() + "/" + clean

	bucket := s.cfg.GetVideoBucket()
	ttl := time.Duration(s.cfg.GetPresignTTL()) * time.Minute

	url, err := s.uploadPublicClient.PresignedGetObject(ctx, bucket, full, ttl, nil)
	if err != nil {
		return "", 0, err
	}
	return url.String(), int(ttl.Seconds()), nil
}

// DeleteAssetObjects removes every object an asset produced.
//
// An asset is not ONE object. It is two prefix families, and both have to go:
//
//	object_key          - the SOURCE, at `{userID}/{random}.ext`
//	{assetID}/...       - the RENDITIONS: `1080p/`, `720p/`, `480p/`, `reel/`,
//	                      `audio/`, plus `poster.jpg`, `filmstrip.jpg`,
//	                      `peaks.json`
//
// The two prefixes are different (one is namespaced by user, the other by asset)
// because the source is minted by the UPLOAD path and the renditions by the
// TRANSCODER. Deleting only the source would leave every rendition orphaned in
// the bucket, still billed, still nobody's - which is the whole reason this
// takes both keys rather than deriving one from the other.
//
// PREFIX deletion is why the caller must pass keys it already owns and already
// verified: the delete is unbounded except by what the caller asked for.
// `DeleteMedia` passes values read back off the row it just deleted, so the
// scope is exactly this asset.
//
// Best-effort by contract: the caller logs a failure and still reports success.
// An unreferenced blob is a storage leak, while a row that survives a failed
// byte-cleanup is a video the creator sees and cannot remove again.
func (s *StorageService) DeleteAssetObjects(ctx context.Context, objectKey, assetID string) error {
	if strings.TrimSpace(objectKey) == "" && strings.TrimSpace(assetID) == "" {
		return fmt.Errorf("no object key to delete")
	}
	// Traversal guard. A prefix delete has no natural bound, so an escaping key
	// must be refused rather than expanded into a wider delete.
	for _, k := range []string{objectKey, assetID} {
		if strings.Contains(k, "..") {
			return fmt.Errorf("invalid object key")
		}
	}

	bucket := s.cfg.GetVideoBucket()

	// Both prefixes, deduplicated: a source and a rendition tree that happen to
	// share a prefix would otherwise be listed and deleted twice.
	prefixes := make([]string, 0, 2)
	seen := make(map[string]bool, 2)
	add := func(p string) {
		p = strings.TrimSuffix(p, "/")
		if p == "" || seen[p] {
			return
		}
		seen[p] = true
		prefixes = append(prefixes, p+"/")
	}
	add(objectKey)
	add(assetID)

	var failed []string
	for _, prefix := range prefixes {
		// ListCh, not ListObjects: the prefix can hold hundreds of segments from
		// a long video, and buffering them all before deleting any of them means
		// holding the whole list in memory for a job the caller has already
		// declared non-blocking.
		objects := s.client.ListObjects(ctx, bucket,
			minio.ListObjectsOptions{Prefix: prefix, Recursive: true})

		for obj := range objects {
			if obj.Err != nil {
				log.Printf("[STORAGE] list error under %s: %v", prefix, obj.Err)
				failed = append(failed, prefix)
				continue
			}
			if err := s.client.RemoveObject(ctx, bucket, obj.Key, minio.RemoveObjectOptions{}); err != nil {
				log.Printf("[STORAGE] delete failed for %s/%s: %v", bucket, obj.Key, err)
				failed = append(failed, prefix)
			}
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("some objects under %v could not be deleted", failed)
	}
	return nil
}
