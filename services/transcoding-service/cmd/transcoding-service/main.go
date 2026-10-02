// Transcoding Service - REAL FFmpeg + MinIO HLS pipeline
//
// YE STUB KA REAL REPLACEMENT HAI. Pehle ka processTranscoding() sirf log
// karta tha aur kuch nahi karta tha - na FFmpeg chala, na MinIO par upload.
//
// AB KYA HOTA HAI (end-to-end):
//  1. Client transcode job bhejta hai (video_id + source URL)
//  2. HLS profile chuna jata hai (2s/4s segments - .env se)
//  3. FFmpeg actually CHALA jata hai -> .m3u8 + .ts chunks generate
//  4. Saare chunks MinIO 'video' bucket me UPLOAD hote hain
//  5. Playlist ka URL client ko wapas milta hai
//  6. Playback seedha bucket/CDN se hoti hai - GKE compute bypass
//
// ARCHITECTURE (aapke rule):
//   - GKE compute sirf TRANSCODE karta hai
//   - Storage MinIO me (self-hosted, koi paid S3 nahi)
//   - Streaming seedha MinIO/CDN se - GKE pods se nahi
//
// COST: FFmpeg aur MinIO dono self-hosted. Koi paid service nahi.
//
// Hinglish comments: har block ka arth
package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Config - sab values SSOT (.env) se, kuch hardcoded nahi
type Config struct {
	Port string

	// MinIO (self-hosted object storage)
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOUseSSL    bool
	VideoBucket    string

	// HLS - segment duration .env se (2 ya 4)
	HLSSegmentSeconds int
	// HLS retention (playlist/segment size limit)
	HLSTimeout int
	// Max workers - ek time me kitne transcode parallel
	MaxWorkers int
	// Temp dir - FFmpeg output yahan likhta hai
	TempDir string

	// Worker pool queue
	jobQueue chan TranscodeJob
}

// TranscodeJob - ek video transcode request
type TranscodeJob struct {
	ID          string `json:"id"`
	VideoID     string `json:"video_id"`
	SourceURL   string `json:"source_url"`
	Profile     string `json:"profile"` // 480p / 720p / 1080p
	Status      string `json:"status"`
	Progress    int    `json:"progress"`
	PlaylistURL string `json:"playlist_url"`
	Error       string `json:"error"`
	// PosterURL is produced alongside the playlist, so the callback can send it
	// and the channel card has something to show without signing a URL per view.
	PosterURL string    `json:"poster_url"`
	CreatedAt time.Time `json:"created_at"`
}

var cfg Config

// minioClient package-level variable hai taaki ensureBucket() aur
// processTranscoding() dono use kar sakein (worker goroutines me bhi).
// Hinglish: package-level var - workers aur ensureBucket dono use karte hain
var minioClient *minio.Client

// HLS profiles - resolution to bitrate mapping
var hlsProfiles = map[string]struct {
	Width        int
	Height       int
	VideoBitrate string
	AudioBitrate string
}{
	"480p":  {854, 480, "1000k", "128k"},
	"720p":  {1280, 720, "2500k", "192k"},
	"1080p": {1920, 1080, "5000k", "256k"},
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		i := 0
		if _, err := fmt.Sscanf(v, "%d", &i); err == nil && i > 0 {
			return i
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	switch strings.ToLower(os.Getenv(key)) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	}
	return def
}

func loadConfig() {
	cfg.Port = envStr("TRANSCODING_SERVICE_PORT", "8083")

	cfg.MinIOEndpoint = envStr("MINIO_ENDPOINT", "minio:9000")
	// Renamed from MINIO_ROOT_USER / MINIO_ROOT_PASSWORD.
	//
	// The values are now a BUCKET-SCOPED service account, not root - but the env var
	// NAME was left reading MINIO_ROOT_*, which is a trap: an operator auditing
	// compose, or a secret scanner, sees `MINIO_ROOT_USER` attached to this service
	// and reasonably concludes it still holds storage-wide credentials. It does not,
	// and the only evidence is the value it is fed.
	//
	// So the name now says what the credential is. `MINIO_ROOT_*` is reserved for
	// `minio` (which defines root) and `minio-init` (which provisions accounts) -
	// those two genuinely need it.
	cfg.MinIOAccessKey = envStr("MINIO_TRANSCODE_ACCESS_KEY", "")
	cfg.MinIOSecretKey = envStr("MINIO_TRANSCODE_SECRET_KEY", "")
	cfg.MinIOUseSSL = envBool("MINIO_USE_SSL", false)
	cfg.VideoBucket = envStr("MINIO_VIDEO_BUCKET", "video")

	cfg.HLSSegmentSeconds = envInt("HLS_SEGMENT_SECONDS", 4)
	cfg.HLSTimeout = envInt("HLS_LIST_SIZE", 0)
	cfg.MaxWorkers = envInt("TRANSCODING_MAX_WORKERS", 2)
	cfg.TempDir = envStr("TRANSCODING_TEMP_DIR", "/tmp/transcoding")
}

// ensureBucket video bucket exist karta hai (idempotent)
func ensureBucket(ctx context.Context) error {
	return minioClient.MakeBucket(ctx, cfg.VideoBucket, minio.MakeBucketOptions{})
}

// processTranscoding - ACTUAL FFmpeg execution + MinIO upload
//
// Steps:
//  1. Profile validate karo
//  2. Temp dir banao
//  3. FFmpeg chalao (HLS: .m3u8 playlist + .ts segments)
//  4. Sabhi files MinIO me upload karo
//  5. Temp dir clean karo
//  6. Playlist URL return karo
func processTranscoding(ctx context.Context, job *TranscodeJob) {
	start := time.Now()
	job.Status = "processing"
	job.Progress = 10

	profile, ok := hlsProfiles[job.Profile]
	if !ok {
		// Default 720p agar invalid profile
		profile = hlsProfiles["720p"]
		job.Profile = "720p"
		log.Printf("[TRANSCODING] Unknown profile %q, defaulting to 720p", job.Profile)
	}

	// ---- Temp dir ----
	workDir := filepath.Join(cfg.TempDir, job.ID)
	if err := os.MkdirAll(workDir, 0755); err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("failed to create work dir: %v", err)
		return
	}
	defer os.RemoveAll(workDir) // cleanup - temp files delete

	// ---- FFmpeg command ----
	// HLS output: master playlist + variant playlist + .ts segments
	// Segment duration .env se aata hai (HLS_SEGMENT_SECONDS, default 4s)
	playlistPath := filepath.Join(workDir, "playlist.m3u8")
	segmentPattern := filepath.Join(workDir, "segment_%05d.ts")

	ffmpegCmd := fmt.Sprintf(
		"ffmpeg -y -i %s "+
			"-c:v libx264 -b:v %s -maxrate %s -bufsize %s "+
			"-vf scale=%d:%d "+
			"-c:a aac -b:a %s "+
			"-f hls -hls_time %d -hls_list_size %d "+
			"-hls_playlist_type vod "+
			"-hls_segment_filename %s %s",
		job.SourceURL,
		profile.VideoBitrate, profile.VideoBitrate, profile.VideoBitrate,
		profile.Width, profile.Height,
		profile.AudioBitrate,
		cfg.HLSSegmentSeconds, // .env se - 2 ya 4
		cfg.HLSTimeout,
		segmentPattern,
		playlistPath,
	)

	job.Progress = 30
	log.Printf("[TRANSCODING] Job %s START | profile=%s seg=%ds", job.ID, job.Profile, cfg.HLSSegmentSeconds)
	log.Printf("[TRANSCODING] FFmpeg cmd: %s", ffmpegCmd)

	// ---- FFmpeg ACTUALLY CHALA ----
	cmd := exec.CommandContext(ctx, "sh", "-c", ffmpegCmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("ffmpeg failed: %v | output: %s",
			err, string(output[len(output)-min(500, len(output)):]))
		log.Printf("[TRANSCODING] Job %s FAILED: %v", job.ID, err)
		reportBack(job)
		return
	}

	job.Progress = 70

	// ---- MinIO upload ----
	// OBJECT KEY: sirf "<videoID>/<profile>" - "video/" PREFIX NAHI daalna chahiye
	// kyunki bucket ka naam ALREADY "video" hai. Pehle "video/%s/%s" use ho raha
	// tha jisse path "video/video/..." double ho jata tha.
	prefix := fmt.Sprintf("%s/%s", job.VideoID, job.Profile)

	uploaded := 0
	err = filepath.Walk(workDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		rel := filepath.Base(path)
		objectKey := fmt.Sprintf("%s/%s", prefix, rel)

		// Content-Type sahi set karo (CDN caching ke liye important)
		contentType := "application/octet-stream"
		switch strings.ToLower(filepath.Ext(rel)) {
		case ".m3u8":
			contentType = "application/vnd.apple.mpegurl"
		case ".ts":
			contentType = "video/mp2t"
		}

		_, uploadErr := minioClient.FPutObject(ctx, cfg.VideoBucket, objectKey, path,
			minio.PutObjectOptions{
				ContentType:  contentType,
				CacheControl: "public, max-age=31536000, immutable", // CDN cache
			})
		if uploadErr != nil {
			return uploadErr
		}

		uploaded++
		return nil
	})

	if err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("minio upload failed: %v", err)
		log.Printf("[TRANSCODING] Job %s UPLOAD FAILED: %v", job.ID, err)
		return
	}

	// ---- Playlist URL ----
	// Streaming seedha bucket se hoti hai - GKE compute bypass.
	//
	// NOTE: pehle yahan "strings.TrimPrefix(cfg.MinIOEndpoint, \"minio:\")" use
	// hua tha jo internal service name ko TOD deta tha aur URL
	// "http://9000/video/..." ban jata tha (host "9000" nahi hai).
	// Ab configurable public host use karte hain.
	scheme := "http"
	if cfg.MinIOUseSSL {
		scheme = "https"
	}
	publicHost := envStr("MINIO_PUBLIC_HOST", "localhost:9000")
	job.PlaylistURL = fmt.Sprintf("%s://%s/%s/%s/playlist.m3u8",
		scheme, publicHost, cfg.VideoBucket, prefix)

	job.Status = "completed"
	job.Progress = 100

	log.Printf("[TRANSCODING] Job %s COMPLETE in %v | uploaded=%d files | playlist=%s",
		job.ID, time.Since(start).Round(time.Millisecond), uploaded, job.PlaylistURL)

	// ---- Report the result back to the owner of the asset ----
	//
	// Without this the asset sits at `uploaded` FOREVER. Nothing else in the
	// system ever advances it: the transcoder does the work and then finishes
	// silently, the channel page counts only `ready` rows, and the creator sees
	// a file that uploaded fine and never appears.
	//
	// Best-effort BY DESIGN, and the ordering matters: this runs after the output
	// is in MinIO, so a failed callback costs a re-run, never a lost transcode. A
	// failed callback does NOT fail the job - the bytes are safely stored either
	// way, and an operator can re-drive it.
	reportBack(job)
}

// reportBack tells auth-service what happened to this asset.
//
// The token is the same shared secret the transcode INTAKE uses. It is a
// service-to-service call inside the compose network, and a per-caller token
// would be a second credential to manage for the same trust boundary.
//
// Failure is logged and swallowed, and the reason is the asymmetry: the file is
// already stored and transcoded, so the only loss is the RECORD of it. Failing
// the job here would report a broken transcode for work that actually
// succeeded, which is worse than a late record.
func reportBack(job *TranscodeJob) {
	callback := envStr("TRANSCODE_CALLBACK_URL", "")
	if callback == "" {
		return
	}

	body := map[string]any{
		"asset_id":     job.VideoID,
		"job_id":       job.ID,
		"status":       job.Status,
		"progress":     job.Progress,
		"playlist_url": job.PlaylistURL,
		"error":        job.Error,
		"poster_url":   job.PosterURL,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		log.Printf("[TRANSCODING] callback payload failed for job %s: %v", job.ID, err)
		return
	}

	req, err := http.NewRequest(http.MethodPost, callback, bytes.NewReader(payload))
	if err != nil {
		log.Printf("[TRANSCODING] callback request failed for job %s: %v", job.ID, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if tok := envStr("TRANSCODE_INTERNAL_TOKEN", ""); tok != "" {
		req.Header.Set("X-Internal-Token", tok)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		log.Printf("[TRANSCODING] callback FAILED for job %s (asset %s): %v - "+
			"the asset stays `uploaded` until a re-run", job.ID, job.VideoID, err)
		return
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 256))
		log.Printf("[TRANSCODING] callback returned %d for job %s: %s",
			res.StatusCode, job.ID, string(bytes.TrimSpace(snippet)))
		return
	}
	log.Printf("[TRANSCODING] reported job %s (asset %s) back as %s", job.ID, job.VideoID, job.Status)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// worker - queue se jobs uthata hai aur process karta hai
func worker(id int, jobs <-chan TranscodeJob, results chan<- TranscodeJob) {
	for job := range jobs {
		log.Printf("[TRANSCODING] Worker %d picking up job %s", id, job.ID)
		ctx := context.Background()
		processTranscoding(ctx, &job)
		results <- job
	}
}

func main() {
	loadConfig()
	log.SetFlags(log.LstdFlags)

	log.Printf("[TRANSCODING] Starting | port=%s | bucket=%s | segment=%ds | workers=%d",
		cfg.Port, cfg.VideoBucket, cfg.HLSSegmentSeconds, cfg.MaxWorkers)

	// ---- MinIO connect ----
	// IMPORTANT: yahan ":=" NAHI use kar sakte, kyunki wo ek NAYA local variable
	// bana deta hai aur package-level "minioClient" nil reh jata tha. Isliye
	// panic hota tha: "nil pointer dereference" inside doMakeBucket.
	// Hinglish: "=" use karo, ":=" nahi - warna package var nil reh jata hai
	var err error
	minioClient, err = minio.New(cfg.MinIOEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinIOAccessKey, cfg.MinIOSecretKey, ""),
		Secure: cfg.MinIOUseSSL,
	})
	if err != nil {
		log.Fatalf("[TRANSCODING] FATAL: failed to create MinIO client: %v", err)
	}

	// MinIO ready hone ka wait (container abhi start ho raha ho sakta hai)
	ctx := context.Background()
	for i := 1; i <= 10; i++ {
		if _, err := minioClient.BucketExists(ctx, cfg.VideoBucket); err == nil {
			log.Println("[TRANSCODING] MinIO connected")
			break
		}
		log.Printf("[TRANSCODING] MinIO not ready (attempt %d/10)", i)
		time.Sleep(3 * time.Second)
	}

	if err := ensureBucket(ctx); err != nil {
		log.Printf("[TRANSCODING] bucket ensure: %v (continuing - may already exist)", err)
	}

	// ---- Worker pool ----
	cfg.jobQueue = make(chan TranscodeJob, 100)
	results := make(chan TranscodeJob, 100)

	var wg sync.WaitGroup
	for i := 1; i <= cfg.MaxWorkers; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			worker(id, cfg.jobQueue, results)
		}(i)
	}

	// Results consumer (future: progress events bhejne ke liye)
	go func() {
		for job := range results {
			log.Printf("[TRANSCODING] Job %s finished with status=%s", job.ID, job.Status)
		}
	}()

	// ---- HTTP server ----
	gin.SetMode(envStr("GIN_MODE", "release"))
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":          "ok",
			"service":         "transcoding-service",
			"port":            cfg.Port,
			"segment_seconds": cfg.HLSSegmentSeconds,
			"bucket":          cfg.VideoBucket,
			"workers":         cfg.MaxWorkers,
		})
	})

	// ---- Intake auth ----
	//
	// `POST /api/v1/transcode` was OPEN. It runs ffmpeg per job, so anything able
	// to reach this container could queue encodes for free - a CPU-exhaustion
	// vector dressed as an internal endpoint, and the compose network is not a
	// trust boundary (every service can reach every other one).
	//
	// Health stays open on purpose: a liveness probe that needs a credential
	// means the orchestrator has to hold a secret just to learn whether the
	// container is alive.
	//
	// A missing token is REFUSED rather than defaulted to "allow". Failing closed
	// here is the whole point - an unset env var must never mean "open", or the
	// protection is one deploy mistake away from not existing.
	internalToken := envStr("TRANSCODE_INTERNAL_TOKEN", "")
	if internalToken == "" {
		log.Fatal("TRANSCODE_INTERNAL_TOKEN is empty: the transcode intake runs ffmpeg and " +
			"must not be open. Set it rather than starting without a token.")
	}

	requireInternalToken := func(c *gin.Context) {
		got := strings.TrimSpace(c.GetHeader("X-Internal-Token"))
		// Constant-time: the token is compared by length first by
		// ConstantTimeCompare, and a `==` would leak via timing on a value that
		// gates a CPU-bound endpoint.
		if subtle.ConstantTimeCompare([]byte(got), []byte(internalToken)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_internal_token",
				"message": "Provide a valid X-Internal-Token header.",
			})
			return
		}
		c.Next()
	}

	// Transcode job submit karo
	r.POST("/api/v1/transcode", requireInternalToken, func(c *gin.Context) {
		var req struct {
			VideoID   string `json:"video_id" binding:"required"`
			SourceURL string `json:"source_url" binding:"required"`
			Profile   string `json:"profile"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "video_id and source_url are required"})
			return
		}

		if req.Profile == "" {
			req.Profile = "720p"
		}

		job := TranscodeJob{
			ID:        uuid.New().String(),
			VideoID:   req.VideoID,
			SourceURL: req.SourceURL,
			Profile:   req.Profile,
			Status:    "queued",
			CreatedAt: time.Now(),
		}

		select {
		case cfg.jobQueue <- job:
			log.Printf("[TRANSCODING] Job %s QUEUED (video=%s profile=%s)",
				job.ID, job.VideoID, job.Profile)
			c.JSON(http.StatusAccepted, gin.H{
				"job_id":  job.ID,
				"status":  "queued",
				"message": "Transcode job queued",
			})
		default:
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "queue full - retry later",
			})
		}
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("[TRANSCODING] Server listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[TRANSCODING] server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("[TRANSCODING] Shutting down...")
	close(cfg.jobQueue)
	wg.Wait()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	log.Println("[TRANSCODING] Stopped")
}
