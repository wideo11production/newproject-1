package service

// ============================================================================
// OBJECT STREAMING - reading bytes back out of the `video` bucket
// ============================================================================
//
// WHY THIS EXISTS AT ALL
//
// The `video` bucket is private, and every read out of it has to be authorised
// by a signature. That works for a BROWSER, which resolves `localhost:9000` and
// can present a URL MinIO signed for exactly that host.
//
// It does NOT work for a server. A presigned URL carries the Host in its
// signature, so a URL signed for `localhost:9000` is refused with `AccessDenied`
// when fetched from `minio:9000` - and inside the container network
// `localhost:9000` is the caller itself, so nothing is reachable at all.
//
// That dead end is what a playback proxy hits: the whole point of proxying HLS
// is that the browser stays same-origin, which means the SERVER has to fetch
// the object. Signing a URL and fetching it is a circle.
//
// So this opens the object instead. The client is bound to the INTERNAL
// endpoint, signs SigV4 itself against that host, and the Host header matches
// by construction. The MEDIA upload account carries `s3:GetObject` on
// `video/*` (see infrastructure/storage/policies/auth-video-uploads.json), so it
// is the one that reads.
//
// WHAT THIS DOES NOT GRANT
//
// Nothing at the bucket level. The same policy that forbids `s3:ListBucket`
// forbids it here: this can fetch ONE object it was asked about and cannot
// enumerate a single other. The caller decides which object is allowed, and that
// decision lives in the service layer against Postgres - never in MinIO.

import (
	"context"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
)

// ReadObject is one object's bytes, opened but not yet consumed.
//
// Returned rather than read into memory because a segment is a few hundred
// kilobytes and a playlist is a few hundred bytes, but the SAME code path serves
// both - and reading a 4 GB rendition into RAM to stream the first 2 KB would be
// the difference between a gallery that works and one that OOMs.
//
// The caller MUST Close it. A leaked object stream holds an HTTP connection to
// MinIO per leaked request, and a grid of hover previews is exactly the shape
// that leaks them.
type ReadObject struct {
	// Size is the full object length, not the length of the requested range.
	Size int64
	// ContentType as MinIO recorded it.
	ContentType string
	// ETag lets a client validate it has the right object.
	ETag string
	// Body is the (possibly ranged) content. Close it.
	Body io.ReadCloser
}

// Stat returns the object's metadata.
func (r *ReadObject) Stat() (minio.ObjectInfo, error) {
	return minio.ObjectInfo{Size: r.Size, ContentType: r.ContentType, ETag: r.ETag}, nil
}

// OpenVideoObject opens one object inside the `video` bucket for reading.
//
// This does NOT decide who may read what - it opens what it is handed. The gate
// is the caller's, because the same call serves the owner route (checked against
// a session) and the public route (checked against the visibility rule). A
// method that opened AND decided would have two policies bolted together.
//
// `relative` is a path RELATIVE to the bucket root - `{assetID}/1080p/playlist.m3u8`.
// It is NOT a caller-controlled absolute key: it is built as `{assetID}/{validated
// relative path}`, so it cannot name an object outside an asset's own prefix.
//
// `offset` and `length` support HTTP Range: hls.js ranges the playlist, and a
// seek ranges the segment. Both are zero for "the whole object".
func (s *StorageService) OpenVideoObject(
	ctx context.Context,
	relative string,
	offset, length int64,
) (*ReadObject, error) {
	if s.uploadClient == nil {
		return nil, fmt.Errorf(
			"media playback is not configured: MINIO_UPLOAD_ACCESS_KEY / " +
				"MINIO_UPLOAD_SECRET_KEY are missing")
	}

	opts := minio.GetObjectOptions{}
	// UserMetadata is off: it would cost a HeadObject round trip, and the
	// content type is already known from the object's own stored metadata.
	if offset > 0 || length > 0 {
		if err := opts.SetRange(offset, offset+length-1); err != nil {
			return nil, err
		}
	}

	obj, err := s.uploadClient.GetObject(ctx, s.cfg.GetVideoBucket(), relative, opts)
	if err != nil {
		return nil, err
	}

	stat, err := obj.Stat()
	if err != nil {
		// The stream has to be closed even on the failure path, or the HTTP
		// connection it already opened leaks.
		_ = obj.Close()
		return nil, err
	}

	return &ReadObject{
		Size:        stat.Size,
		ContentType: stat.ContentType,
		ETag:        stat.ETag,
		Body:        obj,
	}, nil
}
