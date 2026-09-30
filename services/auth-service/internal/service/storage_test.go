package service

// Tests for the shared image-upload primitives (Phase B1).
//
// Two of these guard bugs that were ACTUALLY PRESENT in the code, not
// hypothetical ones:
//
//  1. `objectKeyFromURL` returned the key WITH the bucket prefix, so
//     DeleteAvatar was issuing RemoveObject(bucket="avatars",
//     key="avatars/<uid>/...") - a silent no-op. Every replaced avatar left
//     a permanent orphan in storage.
//  2. `validateImageUpload` is now shared by avatars and covers. If it ever
//     weakens, BOTH paths weaken at once.

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/config"
)

func storageWith(host string, ssl bool) *StorageService {
	return &StorageService{
		cfg: &config.StorageConfig{
			PublicHost:        host,
			AvatarBucket:      "avatars",
			CoverBucket:       "covers",
			UseSSL:            ssl,
			PresignTTLMinutes: 15,
		},
	}
}

var testUser = uuid.MustParse("11111111-2222-3333-4444-555555555555")

// TestObjectKeyFromURLStripsBucketPrefix is the regression test for the
// double-prefix delete bug.
//
// The returned key MUST be bare (`{userID}/{rand}.ext`) because every caller
// passes it to MinIO alongside the bucket as a separate argument. If the key
// retains the bucket name, the delete silently targets a non-existent object.
func TestObjectKeyFromURLStripsBucketPrefix(t *testing.T) {
	s := storageWith("localhost:9000", false)

	const key = "11111111-2222-3333-4444-555555555555/abcdef0123456789.png"
	url := "http://localhost:9000/avatars/" + key

	got := s.objectKeyFromURL(url)
	if got != key {
		t.Fatalf("objectKeyFromURL returned %q, want the BARE key %q", got, key)
	}
	if strings.HasPrefix(got, "avatars/") {
		t.Errorf("SECURITY/BUG: key still carries the bucket prefix: %q", got)
	}
}

func TestObjectKeyFromURLRejectsForeignBuckets(t *testing.T) {
	s := storageWith("localhost:9000", false)
	// A cover URL must NOT be accepted by the avatar extractor, and vice
	// versa. Otherwise "delete my avatar" could delete a cover, or a crafted
	// URL could target a different bucket.
	coverURL := "http://localhost:9000/covers/" + testUser.String() + "/x.png"
	if got := s.objectKeyFromURL(coverURL); got != "" {
		t.Errorf("avatar extractor accepted a cover URL, got %q", got)
	}
	// ...but the covers extractor must accept it.
	avatarURL := "http://localhost:9000/avatars/" + testUser.String() + "/x.png"
	if got := s.objectKeyFromURLInBucket(avatarURL, "covers"); got != "" {
		t.Errorf("covers extractor accepted an avatar URL, got %q", got)
	}
}

func TestObjectKeyFromURLRejectsForeignHosts(t *testing.T) {
	s := storageWith("localhost:9000", false)
	// An attacker-supplied URL pointing at another host must yield "".
	// Otherwise the "delete" path becomes an SSRF-ish primitive.
	for _, bad := range []string{
		"http://evil.com/avatars/" + testUser.String() + "/x.png",
		"https://localhost:9000/avatars/" + testUser.String() + "/x.png", // scheme mismatch
		"http://localhost:9000/../avatars/" + testUser.String() + "/x.png",
		"",
	} {
		if got := s.objectKeyFromURL(bad); got != "" {
			t.Errorf("objectKeyFromURL(%q) = %q, want empty", bad, got)
		}
	}
}

func TestObjectKeyFromURLRejectsTraversal(t *testing.T) {
	s := storageWith("localhost:9000", false)
	bad := "http://localhost:9000/avatars/" + testUser.String() + "/../../secret.png"
	if got := s.objectKeyFromURL(bad); got != "" {
		t.Errorf("traversal must be rejected, got %q", got)
	}
}

// TestPublicObjectURLRoundTrip ties the two together: a URL produced by
// publicObjectURL must parse back to the same key through objectKeyFromURL.
// These are used as a pair (build then delete), so a mismatch between them
// means the delete can never find the object.
func TestPublicObjectURLRoundTrip(t *testing.T) {
	for _, host := range []string{"localhost:9000", "minio.example.com"} {
		for _, ssl := range []bool{false, true} {
			s := storageWith(host, ssl)
			const key = "11111111-2222-3333-4444-555555555555/deadbeef.png"
			for _, bucket := range []string{"avatars", "covers"} {
				url := s.publicObjectURL(bucket, key)
				got := s.objectKeyFromURLInBucket(url, bucket)
				if got != key {
					t.Errorf("round trip failed for %s (host=%s ssl=%v): url=%s got=%q want=%q",
						bucket, host, ssl, url, got, key)
				}
			}
		}
	}
}

func TestValidateImageUpload(t *testing.T) {
	good := []struct{ name, mime, wantType, wantExt string }{
		{"png", "image/png", "image/png", ".png"},
		{"jpeg with charset", "image/jpeg; charset=binary", "image/jpeg", ".jpg"},
		{"webp", "image/webp", "image/webp", ".webp"},
		{"gif", "image/gif", "image/gif", ".gif"},
		{"uppercase mime", "IMAGE/PNG", "image/png", ".PNG"},
	}
	for _, tc := range good {
		t.Run(tc.wantType, func(t *testing.T) {
			gotType, gotExt, err := validateImageUpload("file"+tc.wantExt, tc.mime)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if gotType != tc.wantType {
				t.Errorf("content type = %q, want %q", gotType, tc.wantType)
			}
			if gotExt != strings.ToLower(tc.wantExt) {
				t.Errorf("ext = %q, want %q", gotExt, strings.ToLower(tc.wantExt))
			}
		})
	}

	bad := []struct{ name, filename, mime string }{
		{"html disguised as png", "evil.png", "text/html"},
		{"html disguised as jpg", "evil.jpg", "application/octet-stream"},
		{"svg", "vector.svg", "image/svg+xml"},
		{"no extension", "noext", "image/png"},
		{"double extension mismatch", "x.png", "image/jpeg"},
		{"exe", "payload.exe", "image/png"},
		{"empty mime", "x.png", ""},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := validateImageUpload(tc.filename, tc.mime); err == nil {
				t.Errorf("SECURITY: validateImageUpload(%q, %q) was ACCEPTED", tc.filename, tc.mime)
			}
		})
	}
}

func TestBuildObjectKeyIsNamespacedAndRandom(t *testing.T) {
	key, err := buildObjectKey(testUser, ".png")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(key, testUser.String()+"/") {
		t.Errorf("key must be namespaced under the user id, got %q", key)
	}
	if !strings.HasSuffix(key, ".png") {
		t.Errorf("key must keep the validated extension, got %q", key)
	}

	// Two calls must not collide - otherwise a second upload silently
	// overwrites the first and the browser serves a cached old image.
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		k, err := buildObjectKey(testUser, ".png")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if seen[k] {
			t.Fatalf("buildObjectKey produced a duplicate key %q", k)
		}
		seen[k] = true
	}
}

func TestSniffImageTypeRejectsNonImages(t *testing.T) {
	// The magic-byte check is the real defence against an .html file named
	// .png. Pin it so a refactor cannot weaken it.
	rejects := [][]byte{
		[]byte("<!DOCTYPE html><html>"),
		[]byte("<?xml version=\"1.0\"?><svg onload=alert(1)>"),
		[]byte("MZ\x90\x00\x03"), // PE/EXE header
		[]byte("%PDF-1.4"),       // PDF
		[]byte("\x89PNG"),        // truncated PNG - too short
	}
	for _, b := range rejects {
		if mt, ok := sniffImageType(b); ok {
			t.Errorf("SECURITY: sniffImageType accepted %q as %q", b[:min(len(b), 8)], mt)
		}
	}

	accepts := []struct {
		header []byte
		want   string
	}{
		{[]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"), "image/png"},
		{[]byte("\xFF\xD8\xFF\xE0\x00\x10JFIF"), "image/jpeg"},
		{[]byte("GIF89a\x01\x00\x01\x00"), "image/gif"},
		{append([]byte("RIFF\x00\x00\x00\x00WEBP"), 0x00), "image/webp"},
	}
	for _, tc := range accepts {
		if got, ok := sniffImageType(tc.header); !ok || got != tc.want {
			t.Errorf("sniffImageType = (%q, %v), want (%q, true)", got, ok, tc.want)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
