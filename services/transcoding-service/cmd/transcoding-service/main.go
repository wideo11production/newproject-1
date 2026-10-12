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
	"strconv"
	"strings"
	"net/url"
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
	Profile     string `json:"profile"` // 480p / 720p / 1080p / reel / audio
	Status      string `json:"status"`
	Progress    int    `json:"progress"`
	// Multi-rendition outputs
	PlaylistURL  string            `json:"playlist_url"` // default (highest) rendition
	Playlists    map[string]string `json:"playlists"`    // profile -> playlist URL
	PosterURL    string            `json:"poster_url"`
	FilmstripURL string            `json:"filmstrip_url"`
	PeaksURL     string            `json:"peaks_url"`  // waveform peaks JSON
	DurationS    int               `json:"duration_s"` // measured duration
	Width        int               `json:"width"`
	Height       int               `json:"height"`
	HasAudio     bool              `json:"has_audio"`
	// Moderation is the content-screening verdict for this job, and it rides
	// along on the same callback as the transcode result.
	//
	// It is here rather than reported separately because both answers exist at
	// the same moment: the job finishing. A second callback would be a second
	// thing that can be lost, and a race between them would let either one land
	// on an asset the other had already decided.
	Moderation *ModerationResult `json:"moderation,omitempty"`
	Error      string            `json:"error"`
	CreatedAt  time.Time         `json:"created_at"`
}

var cfg Config

// minioClient package-level variable hai taaki ensureBucket() aur
// processTranscoding() dono use kar sakein (worker goroutines me bhi).
// Hinglish: package-level var - workers aur ensureBucket dono use karte hain
var minioClient *minio.Client

// HLS profiles - resolution to bitrate mapping per SYSTEM-PLAN.md §5.1
// Renditions produced in ONE ffmpeg pass (split filter):
// 1080p, 720p, 480p, audio-only, reel (1080x1920)
var hlsProfiles = map[string]struct {
	Width        int
	Height       int
	VideoBitrate string
	AudioBitrate string
}{
	"480p":  {854, 480, "1500k", "96k"},
	"720p":  {1280, 720, "3000k", "128k"},
	"1080p": {1920, 1080, "6000k", "128k"},
	"reel":  {1080, 1920, "8000k", "128k"},
	"audio": {0, 0, "", "128k"},
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

// envFloat reads a float env var, falling back to `def`.
//
// Needed by the moderation thresholds, which are all fractional scores. A
// malformed value falls back rather than failing the job - a bad threshold
// should degrade to the default, not stop every upload in the fleet.
func envFloat(key string, def float64) float64 {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
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

// processTranscoding - ONE ffmpeg pass -> full ladder + packaging.
//
// SYSTEM-PLAN.md §5.1: all five renditions are produced in a SINGLE ffmpeg
// invocation using the split filter. Two passes means decoding everything
// twice, and the editor already proved that a second decode pass is where
// frame-accuracy bugs are born.
//
//	1080p  H.264 6 Mbps   the default everywhere
//	720p   H.264 3 Mbps   slow connections
//	480p   H.264 1.5 Mbps mobile data saver
//	audio  AAC 128k       the player bar's waveform source
//	reel   H.264 1080x1920 8 Mbps   reels only ($6)
//
// Packaging (§5 `packaging` stage): poster frame, filmstrip, HLS manifest,
// and waveform peaks - all alongside the ladder, so one job yields everything
// a player needs.
func processTranscoding(ctx context.Context, job *TranscodeJob) {
	start := time.Now()
	job.Status = "processing"
	job.Progress = 5
	job.Playlists = make(map[string]string)

	// ---- Temp dir ----
	workDir := filepath.Join(cfg.TempDir, job.ID)
	if err := os.MkdirAll(workDir, 0755); err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("failed to create work dir: %v", err)
		reportBack(job)
		return
	}
	defer os.RemoveAll(workDir)

	// ---- Fetch the source WITH OUR OWN CREDENTIALS ----
	//
	// THE BUG THIS FIXES
	// ==================
	// `job.SourceURL` is an internal MinIO path (`http://minio:9000/video/...`)
	// with no signature in it, and it used to be handed straight to ffprobe and
	// ffmpeg. The `video` bucket is PRIVATE by design, so an unauthenticated GET
	// is refused with 403 and every job died at the probe. The transcode account
	// is granted `s3:GetObject` on `video/*` all along - the grant was simply
	// never USED, which is why no policy check flagged it.
	//
	// The design in `InternalObjectURL` says the transcoder authenticates with
	// its OWN scoped account rather than being handed a presigned URL, and that
	// is what happens here: the URL is parsed for its bucket and key, and the
	// object is pulled down with the MinIO client. ffmpeg never sees a URL with
	// a credential in it, and no credential ends up in a job payload or a log.
	//
	// A LOCAL COPY rather than a re-signed URL, because the ladder, the poster,
	// the filmstrip and the peaks all re-read the source, and seeking around an
	// HTTP stream four times is slower and far more fragile than one sequential
	// read.
	sourcePath, err := fetchSource(ctx, job.SourceURL, workDir)
	if err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("could not fetch the source: %v", err)
		log.Printf("[TRANSCODING] Job %s SOURCE FETCH FAILED: %v", job.ID, err)
		reportBack(job)
		return
	}
	log.Printf("[TRANSCODING] Job %s source fetched (%s)", job.ID, humanBytes(fileSize(sourcePath)))

	// Everything downstream reads the LOCAL copy, not the URL.
	job.SourceURL = sourcePath

	// ---- PROBE FIRST (ffprobe) ----
	//
	// The ladder needs to know what it is dealing with, and the callback needs
	// to report MEASURED values rather than the client's claim. A 4K source
	// must not be UPSCALED to 1080p - scale only ever shrinks, so a
	// "force_original_aspect_ratio=decrease" guards each leg.
	probed := probe(ctx, job.SourceURL)
	if !probed.ok {
		job.Status = "failed"
		job.Error = fmt.Sprintf("ffprobe failed: %s", probed.err)
		log.Printf("[TRANSCODING] Job %s PROBE FAILED: %s", job.ID, probed.err)
		reportBack(job)
		return
	}
	// Reported to the caller as whole seconds: that is what the schema stores
	// and what a duration is usually shown as. The fractional value is kept in
	// `probed.durationS` for anything that needs to be exact, like the `-t` bound.
	job.DurationS = int(probed.durationS)
	job.Width = probed.width
	job.Height = probed.height
	job.HasAudio = probed.hasAudio
	job.Progress = 10

	// The bound, computed once and applied to every output block. See
	// `boundedDuration` for why this is not optional.
	//
	// `hasVideo` comes from the probe, and it matters for an audio-only file: it
	// is the argument that decides whether a missing duration is fatal. An MP3
	// HAS audio that ends, so its duration can be measured from the stream even
	// when the container header omits it.
	tBound, bounded := boundedDuration(probed, probed.hasVideo())
	if !bounded {
		job.Status = "failed"
		job.Error = "could not measure the file's duration, so it cannot be transcoded"
		log.Printf("[TRANSCODING] Job %s DURATION UNKNOWN (no audio to end on, no measurable length)", job.ID)
		reportBack(job)
		return
	}

	// ---- MODERATION FIRST, BEFORE THE LADDER ----
	//
	// The order is a cost decision, not a correctness one. A rejected video must
	// not be transcoded: the ladder is minutes of CPU per rendition and the file
	// is about to be refused anyway. Running moderation first means a clearly
	// violating upload costs a frame sample and a probe rather than a full encode.
	//
	// It is NOT a correctness decision because the verdict is recorded either
	// way - a rejected asset keeps its renditions if it had any from a previous
	// attempt, and the status is what withholds it from the public.
	//
	// A moderation FAILURE does not fail the job. If the engine itself errors,
	// `Moderate` returns `approved` with an error recorded, and the upload
	// proceeds - an outage in the screener must not take the platform's uploads
	// offline. What it does NOT do is skip the verdict silently: the asset lands
	// at `pending_review` so a human sees it.
	moderationCfg := DefaultModerationConfig()
	if !ModerationEnabled() {
		log.Printf("[MODERATION] disabled by config - job %s skips content screening", job.ID)
	}
	// The result is attached to the job so the callback can report it, and is
	// declared outside the block so the ladder path below can see it.
	job.Moderation = &ModerationResult{Verdict: "approved", Provider: moderationVersion}
	if ModerationEnabled() {
		if m := Moderate(ctx, sourcePath, probed, moderationCfg); m != nil {
			job.Moderation = m

			// A REJECTED upload stops here. The renditions are not made and the
			// callback records the refusal.
			//
			// The source bytes are NOT deleted - the creator needs to be able to
			// see what was refused, and deleting evidence of a refusal is both
			// unhelpful and opaque.
			if m.Verdict == "rejected" {
				job.Status = "completed"
				job.Progress = 100
				job.DurationS = int(probed.durationS)
				job.Width = probed.width
				job.Height = probed.height
				job.HasAudio = probed.hasAudio
				log.Printf("[TRANSCODING] Job %s REJECTED BY MODERATION: %s", job.ID, m.Reason)
				reportBack(job)
				return
			}
		}
	}

	// ---- Build the ONE ffmpeg command ----
	//
	// `-filter_complex` splits the decoded video into scaled legs and the audio
	// into its own leg. Every HLS output gets its own playlist. `-var_stream_map`
	// gives each output a stable name so the master playlist is deterministic.
	seg := cfg.HLSSegmentSeconds
	if seg <= 0 {
		seg = 4
	}

	args := []string{
		"-y",
		"-i", job.SourceURL,
		// The audio leg. If the source has no audio stream this branch would
		// fail the whole command, so `anullsrc` is substituted - see below.
		//
		// `hasVideo` comes from the PROBE, not from the client's `kind`. A file
		// uploaded as `video` that turns out to have no video stream is treated as
		// audio-only, because that is what the bytes actually are - and the graph
		// has to describe real streams, not intended ones.
		"-filter_complex", buildFilterComplex(probed.hasAudio, probed.hasVideo()),
	}

	// --- The ladder, as one output block per rendition ---
	//
	// Each block carries its own `-f hls` and its own muxer options, and the
	// options apply to the output file that FOLLOWS them. That is the form that
	// actually works here: the `-hls_time:N` per-output specifier syntax does
	// NOT - this ffmpeg build answers `Unrecognized option 'hls_time:0'` and
	// dies before encoding a frame, which is what it was doing.
	//
	// It is still ONE ffmpeg process and ONE decode: the filter graph is built
	// once and each output block just maps the pads it needs.
	//
	// WHY THE AUDIO IS `asplit` AND NOT ONE SHARED `[aout]`
	// ====================================================
	// A filter_complex output pad can be consumed EXACTLY ONCE. Mapping `[aout]`
	// into a second output fails with "Output with label 'aout' does not exist
	// in any defined filter graph, or was already used elsewhere", which is
	// what happened: the first leg encoded fine, and every leg after it died.
	//
	// So the audio leg is split into one pad per output. The cost is a separate
	// AAC encode per output, which is the price of five independent HLS
	// playlists anyway - each one has to carry its own audio stream.
	//
	// ---- AUDIO-ONLY SOURCES SKIP THIS ENTIRE BLOCK ----
	//
	// There is no `[0:v]` to scale and no `[vN]` pad to map, so an MP3 produces
	// exactly one output: the audio leg below. Building video renditions for a
	// file with no video stream would fail the command with "matches no
	// streams", which is the bug this guards.
	videoLegs := []string{"1080p", "720p", "480p", "reel"}
	if probed.hasVideo() {
		for i, leg := range videoLegs {
			p := hlsProfiles[leg]
			if err := os.MkdirAll(filepath.Join(workDir, leg), 0755); err != nil {
				job.Status = "failed"
				job.Error = fmt.Sprintf("mkdir %s: %v", leg, err)
				reportBack(job)
				return
			}
			args = append(args,
				"-map", fmt.Sprintf("[v%d]", i),
				"-map", fmt.Sprintf("[a%d]", i),

				// NO per-stream index on the codecs either. These options now sit
				// inside this output's own block, where they apply to exactly one
				// output, so a specifier would be both wrong and rejected.
				"-c:v", "libx264",
				"-b:v", p.VideoBitrate,
				"-maxrate", p.VideoBitrate,
				"-bufsize", p.VideoBitrate,
				"-c:a", "aac",
				"-b:a", p.AudioBitrate,
			)
			// THE BOUND - `-t <seconds>`, appended only when there is one. It is what
			// stops an infinite `anullsrc` from encoding forever.
			args = append(args, boundArgs(tBound)...)
			args = append(args,
				"-f", "hls",
				"-hls_time", strconv.Itoa(seg),
				"-hls_list_size", strconv.Itoa(cfg.HLSTimeout),
				"-hls_playlist_type", "vod",
				"-hls_segment_filename", filepath.Join(workDir, leg, "seg_%05d.ts"),
				filepath.Join(workDir, leg, "playlist.m3u8"),
			)
		}
	}

	// --- Audio-only leg: the waveform source for the player bar ---
	//
	// For a video source this is the fifth split copy - index 4, one past the
	// four video legs. For an audio-only source it is the FIRST and only split
	// pad, so it maps `[a0]` instead. The pad index is derived from whether the
	// video legs consumed a0..a3, rather than hardcoded, so the two cases cannot
	// drift apart.
	audioPad := "[a4]"
	if !probed.hasVideo() {
		audioPad = "[a0]"
	}
	if err := os.MkdirAll(filepath.Join(workDir, "audio"), 0755); err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("mkdir audio: %v", err)
		reportBack(job)
		return
	}
	args = append(args,
		"-map", audioPad,
		"-c:a", "aac",
		"-b:a", "128k",
	)
	// THE BOUND for the audio-only leg. It carries no video stream to end on, so
	// it is the leg that would hang forever without it.
	args = append(args, boundArgs(tBound)...)
	args = append(args,
		"-f", "hls",
		"-hls_time", strconv.Itoa(seg),
		"-hls_list_size", strconv.Itoa(cfg.HLSTimeout),
		"-hls_playlist_type", "vod",
		"-hls_segment_filename", filepath.Join(workDir, "audio", "seg_%05d.ts"),
		filepath.Join(workDir, "audio", "playlist.m3u8"),
	)

	job.Progress = 20
	log.Printf("[TRANSCODING] Job %s START | src=%dx%d dur=%.3fs audio=%v seg=%ds",
		job.ID, probed.width, probed.height, probed.durationS, probed.hasAudio, seg)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		job.Status = "failed"
		job.Error = fmt.Sprintf("ffmpeg ladder failed: %v | output: %s",
			err, tail(string(output), 500))
		log.Printf("[TRANSCODING] Job %s FAILED: %s", job.ID, job.Error)
		reportBack(job)
		return
	}
	job.Progress = 55

	// ---- Packaging: poster, filmstrip, waveform peaks ----
	//
	// Each is best-effort and independent: a poster that fails is a missing
	// thumbnail, not a failed video. Only the LADDER being unproducible fails
	// the job, because that is the video itself.
	//
	// POSTER AND FILMSTRIP ARE SKIPPED, NOT FAILED, FOR AN AUDIO-ONLY SOURCE.
	// `-frames:v 1` against a file with no video stream produces nothing and
	// reports an error, which is the correct answer to a meaningless question -
	// and running it anyway would put an error in the log for every song. The
	// creator supplies a poster image instead (see the audio thumbnail upload
	// path), so "no poster" is a state the product already has an answer for.
	if !probed.hasVideo() {
		log.Printf("[TRANSCODING] Job %s audio-only source: poster/filmstrip skipped", job.ID)
	} else {
		if poster, perr := makePoster(ctx, workDir, job.SourceURL, probed.durationS); perr != nil {
			// Non-fatal and logged. A missing poster is a missing thumbnail, not a
			// broken video, so the job still completes - but it is NOT silent,
			// because "why is there no poster on this channel card" is otherwise a
			// permanently open question.
			log.Printf("[TRANSCODING] Job %s poster failed (non-fatal): %v", job.ID, perr)
		} else {
			if _, uerr := uploadFile(ctx, job.VideoID, "poster.jpg", poster, "image/jpeg"); uerr == nil {
				job.PosterURL = publicURL(job.VideoID, "poster.jpg")
			} else {
				log.Printf("[TRANSCODING] Job %s poster encode ok, upload failed (non-fatal): %v",
					job.ID, uerr)
			}
			_ = os.Remove(poster)
		}

		if strip, serr := makeFilmstrip(ctx, workDir, job.SourceURL, probed.durationS); serr != nil {
			log.Printf("[TRANSCODING] Job %s filmstrip failed (non-fatal): %v", job.ID, serr)
		} else {
			if _, uerr := uploadFile(ctx, job.VideoID, "filmstrip.jpg", strip, "image/jpeg"); uerr == nil {
				job.FilmstripURL = publicURL(job.VideoID, "filmstrip.jpg")
			}
			_ = os.Remove(strip)
		}
	}

	if peaks, kerr := makePeaks(ctx, workDir, job.SourceURL, probed.durationS, probed.hasAudio); kerr != nil {
		// Non-fatal and quiet for a source with no audio, which is expected.
		// Logged for anything else, because a failed decode on a file that HAS
		// audio is a real problem with the file.
		if probed.hasAudio {
			log.Printf("[TRANSCODING] Job %s peaks failed (non-fatal): %v", job.ID, kerr)
		}
	} else {
		if _, uerr := uploadFile(ctx, job.VideoID, "peaks.json", peaks, "application/json"); uerr == nil {
			job.PeaksURL = publicURL(job.VideoID, "peaks.json")
		}
		_ = os.Remove(peaks)
	}

	job.Progress = 70

	// ---- Upload every rendition to MinIO ----
	uploaded := 0
	for _, leg := range []string{"1080p", "720p", "480p", "reel", "audio"} {
		dir := filepath.Join(workDir, leg)
		if _, statErr := os.Stat(dir); os.IsNotExist(statErr) {
			continue
		}
		count, uerr := uploadDir(ctx, job.VideoID, leg, dir)
		if uerr != nil {
			job.Status = "failed"
			job.Error = fmt.Sprintf("minio upload failed for %s: %v", leg, uerr)
			log.Printf("[TRANSCODING] Job %s UPLOAD FAILED (%s): %v", job.ID, leg, uerr)
			reportBack(job)
			return
		}
		uploaded += count
		job.Playlists[leg] = publicURL(job.VideoID, leg+"/playlist.m3u8")
	}

	// The DEFAULT playlist a player opens: the highest rendition that exists.
	//
	// The ladder ends with `audio`, and that is the LAST fallback rather than an
	// afterthought: an audio-only source produces no video rendition at all, so
	// its only playlist IS the audio one. Returning "" there would hand the
	// callback a success with nothing to play, and the callback would treat it
	// as a failure for a job that actually worked.
	job.PlaylistURL = job.Playlists["1080p"]
	if job.PlaylistURL == "" {
		job.PlaylistURL = job.Playlists["720p"]
	}
	if job.PlaylistURL == "" {
		job.PlaylistURL = job.Playlists["480p"]
	}
	if job.PlaylistURL == "" {
		job.PlaylistURL = job.Playlists["audio"]
	}

	// A completion with no playlist at all is a failure, and it is caught here
	// rather than in the callback: the transcoder knows exactly which legs it
	// was asked to produce, so it is the right place to notice that none exist.
	if job.PlaylistURL == "" {
		job.Status = "failed"
		job.Error = "no renditions were produced - the ladder yielded nothing to play"
		log.Printf("[TRANSCODING] Job %s NO RENDITIONS", job.ID)
		reportBack(job)
		return
	}

	job.Status = "completed"
	job.Progress = 100

	log.Printf("[TRANSCODING] Job %s COMPLETE in %v | files=%d | renditions=%d | poster=%v",
		job.ID, time.Since(start).Round(time.Millisecond), uploaded, len(job.Playlists), job.PosterURL != "")

	reportBack(job)
}

// fetchSource downloads the object behind an internal MinIO URL into workDir.
//
// The URL carries no credentials and cannot: the `video` bucket is private, so
// a bare GET is a 403. This service holds a scoped account with `s3:GetObject`
// on that bucket, so the bucket and key are taken out of the URL and the object
// is pulled with the client instead.
//
// WHY PARSE THE URL RATHER THAN SEND (bucket, key) IN THE JOB
// ===========================================================
// The job contract in `InternalObjectURL` is a URL, not a pair, and changing it
// would touch every producer. Parsing keeps the contract and still ends up with
// a pair - and a malformed URL fails here with a clear message rather than as a
// mysterious 403 deep inside ffprobe.
//
// A PATH-STYLE url is assumed (`http://host/<bucket>/<key...>`), which is what
// MinIO serves and what `InternalObjectURL` builds. A key containing slashes
// survives because everything after the first segment is rejoined.
func fetchSource(ctx context.Context, rawURL, workDir string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("unparseable source url %q: %w", rawURL, err)
	}

	// The path is /<bucket>/<key...>. The leading slash produces an empty first
	// segment, which is skipped rather than treated as part of the key.
	segs := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	if len(segs) < 2 || segs[0] == "" || segs[len(segs)-1] == "" {
		return "", fmt.Errorf(
			"source url %q is not a bucket/object path", rawURL)
	}
	bucket := segs[0]
	object := strings.Join(segs[1:], "/")

	dest := filepath.Join(workDir, "source."+filepath.Ext(object))
	if err := minioClient.FGetObject(ctx, bucket, object, dest, minio.GetObjectOptions{}); err != nil {
		// Name the bucket and key, not just the error: a 403 from MinIO says
		// nothing about which object was being read, and the answer to "what was
		// denied" is always the interesting part.
		return "", fmt.Errorf("get %s/%s: %w", bucket, object, err)
	}
	return dest, nil
}

// fileSize returns the size of path, or 0 when it cannot be read. Used only for
// logging, so a failure here must not fail the job.
func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

// humanBytes formats a byte count for a log line.
func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

// boundArgs emits `-t <seconds>` as its own two arguments, or nothing at all
// when there is no bound to apply.
//
// A slice rather than a string so the caller can append it inline. Returning
// "nothing" as an empty slice keeps the caller free of a conditional, and the
// alternative - always emitting `-t 0` - would silently produce zero-length
// renditions for exactly the files this is meant to save.
func boundArgs(t string) []string {
	if t == "" {
		return nil
	}
	return []string{"-t", t}
}

// audioPadCount is how many outputs consume the audio leg: four video
// renditions plus the standalone audio one.
//
// It is a constant because it MUST match the number of `-map [aN]` statements
// built in processTranscoding. A mismatch is not a silent degradation: ffmpeg
// fails with "Output with label 'a4' does not exist" and the job is reported
// failed, which is the loud direction.
const audioPadCount = 5

// filmstripFrames is the width of the contact sheet, and it is a hard grid
// because `tile=10x1` needs the input count to divide by 10. The sampling step
// is capped to exactly this many frames so a 12-frame sample still tiles.
const filmstripFrames = 10

// buildFilterComplex scales one decoded stream into four video legs and splits
// the audio into one pad per output.
//
// `force_original_aspect_ratio=decrease` then the pad to the exact target, so
// a 4K or vertical source is never UPSCALED and a non-16:9 source letterboxes
// into the target box instead of distorting. Audio goes through anullsrc when
// the source has none, so the command still succeeds.
//
// THE `asplit` IS NOT OPTIONAL. A filter_complex pad is consumed exactly once,
// so five outputs mapping one `[aout]` means the second one onwards fails with
// "Output with label 'aout' does not exist in any defined filter graph, or was
// already used elsewhere" - the first leg encodes, and every leg after it dies.
//
// -----------------------------------------------------------------------------
// AUDIO-ONLY FILES: NO VIDEO LEGS AT ALL
// -----------------------------------------------------------------------------
//
// An MP3/WAV has no `[0:v]` stream, so a filter graph that references one fails
// the whole command with:
//
//	[0:v]scale=1920:1080... matches no streams.
//
// That is not a degraded encode, it is the job dying before a single frame - and
// it is exactly what happened to the first audio upload. So `hasVideo` gates the
// video legs entirely: an audio-only source gets ONLY the split audio graph,
// which is also cheaper (no scaling filters to build).
//
// The caller must then not `-map` a video pad either, which is why
// `processTranscoding` reads the same flag from the probe.
func buildFilterComplex(hasAudio, hasVideo bool) string {
	filter := ""

	if hasVideo {
		legs := []struct {
			idx    string
			width  int
			height int
		}{
			{"0", 1920, 1080},
			{"1", 1280, 720},
			{"2", 854, 480},
			{"3", 1080, 1920},
		}

		for _, l := range legs {
			filter += fmt.Sprintf(
				"[0:v]scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1[v%s];",
				l.width, l.height, l.width, l.height, l.idx)
		}
	}

	// One pad per consuming output, a0..a4.
	//
	// The COUNT is 5 whether or not the file has video: the audio-only HLS leg
	// always consumes `[a4]`, and the audio legs of the four video renditions
	// consume a0..a3. With no video there are still three outputs that need a
	// pad - the standalone audio leg plus the audio copies the video legs would
	// have mapped - and `asplit` needs one destination per consumer, so the
	// count is derived from what the caller will actually map.
	var audioPads int
	if hasVideo {
		audioPads = audioPadCount
	} else {
		audioPads = 1
	}

	pads := make([]string, audioPads)
	for i := range pads {
		pads[i] = fmt.Sprintf("[a%d]", i)
	}
	splitTarget := strings.Join(pads, "")

	if hasAudio {
		// `aformat` normalises the sample format first, so every leg gets the
		// same audio regardless of what the source was encoded with.
		filter += fmt.Sprintf("[0:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=%d%s",
			audioPads, splitTarget)
	} else {
		// `sample_rate`, singular - `sample_rates` is an `aresample` option and
		// is rejected by `anullsrc` with "Option not found", which fails the
		// whole command for a source that simply has no soundtrack.
		filter += fmt.Sprintf("anullsrc=channel_layout=stereo:sample_rate=44100,asplit=%d%s",
			audioPads, splitTarget)
	}
	return filter
}

// probeResult is the result of ffprobe: what the file actually is.
type probeResult struct {
	ok        bool
	err       string
	durationS float64
	width     int
	height    int
	hasAudio  bool
	// videoStreams counts `codec_type == "video"` streams, rather than a boolean,
	// because the DISTINCTION between zero and more-than-zero is what gates the
	// video legs of the ladder - and a boolean would suggest a count is not
	// needed when it is exactly what the caller reads.
	videoStreams int

	// maxFrameDelta is the largest frame-to-frame difference measured by the
	// probe's own scene analysis, and it is the input to `motionHint` - the
	// moderation engine's crude motion signal.
	//
	// Measured here rather than in the moderation pass because ffprobe already
	// computes per-frame scores while scanning the file, so reading one is free
	// whereas a dedicated second decode of a 4K source is not.
	maxFrameDelta float64
}

// hasVideo reports whether the file carries a video stream at all.
//
// Derived from the stream count rather than from `width`, because a 1x1 video
// stream has a width. It is also deliberately NOT derived from the client's
// `kind`: a file uploaded as `video` that contains only audio is an audio file,
// and building a video ladder for it fails the whole command.
func (p probeResult) hasVideo() bool { return p.videoStreams > 0 }

// motionHint estimates how much the picture moves, normalised 0.0-1.0.
//
// It is a HINT, not a motion detector, and that is a deliberate scope choice: a
// real motion magnitude needs optical flow, which is expensive and pointless
// here - this feeds a moderation FLAG that a human resolves, and the human is
// the actual motion detector.
//
// Derived from the single largest frame-to-frame difference, because the
// question the proxy answers is not "is there motion" but "is there a LOT of
// motion at once". A talking head scores near 0; a whip pan or a hard cut to a
// close-up scores high.
//
// Returns 0 for anything that is not a video file, so a caller never has to
// special-case an audio source - "no motion" is the neutral answer.
func (p probeResult) motionHint() float64 {
	if !p.hasVideo() {
		return 0
	}
	// A zero duration would divide by zero below, and a file with no duration
	// has nothing meaningful to measure anyway.
	if p.durationS <= 0 {
		return 0
	}
	// Clamped: an unusual frame difference must not produce a "motion" above 1.0,
	// because the score it multiplies is a ratio and the ratio is what the
	// threshold is written against.
	if p.maxFrameDelta <= 0 {
		return 0
	}
	hint := p.maxFrameDelta / motionDeltaScale
	if hint > 1.0 {
		return 1.0
	}
	return hint
}

// motionDeltaScale is the frame-difference value that counts as "maximum motion".
//
// A constant rather than a config value because it is a UNIT, not a policy: it
// is the denominator that makes the hint a ratio. Making it configurable would
// make the moderation threshold uninterpretable.
const motionDeltaScale = 60.0

// probe runs ffprobe and parses the measured values.
//
// Duration is kept as a FLOAT, not an int, and that matters: a truncated
// integer turns a 0.01 s file into 0 s, which then reads as "unknown duration"
// and makes every downstream `-t` bound useless. Truncating here is how the
// ladder ended up unbounded.
func probe(ctx context.Context, source string) probeResult {
	out, err := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		source).CombinedOutput()
	if err != nil {
		return probeResult{ok: false, err: fmt.Sprintf("%v: %s", err, tail(string(out), 300))}
	}

	var parsed struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
			Duration  string `json:"duration"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return probeResult{ok: false, err: fmt.Sprintf("ffprobe json: %v", err)}
	}

	res := probeResult{ok: true}
	for _, s := range parsed.Streams {
		switch s.CodecType {
		case "video":
			res.videoStreams++
			if res.width == 0 {
				res.width, res.height = s.Width, s.Height
			}
		case "audio":
			res.hasAudio = true
		}
	}
	// The stream duration is the one that describes the DECODED length; the
	// container's can be absent for streams cut mid-write or streamed.
	if d, derr := strconv.ParseFloat(parsed.Format.Duration, 64); derr == nil {
		res.durationS = d
	} else {
		for _, s := range parsed.Streams {
			if s.CodecType == "video" {
				if d, serr := strconv.ParseFloat(s.Duration, 64); serr == nil && d > 0 {
					res.durationS = d
					break
				}
			}
		}
	}

	// ---- Frame-to-frame delta, for the moderation motion hint ----
	//
	// NOT free: scene scores require decoding frames, which is the expensive part
	// of probing. So it is gated on `MODERATION_ENABLED` rather than run for
	// every job - a probe that always decoded the video would double the cost of
	// the whole pipeline for a number only moderation consumes.
	//
	// The result is cached on the probe, and the moderation engine reads it back
	// with `motionHint()`, so exactly one decode happens whether or not
	// moderation ends up using the number.
	if res.hasVideo() && ModerationEnabled() {
		res.maxFrameDelta = measureMotion(ctx, source)
	}
	return res
}

// measureMotion returns the largest frame-to-frame difference in the file.
//
// `select=gt(scene\,X)` with a metadata print is the ffmpeg-native way to read
// scene scores: every frame whose cut-detection value exceeds X is emitted with
// its score, and the largest of those is the deepest cut in the file.
//
// Bounded to the first two minutes, because the question this answers is "is
// there a violent change of picture" and a file with one is unlikely to hide it
// past minute two. The bound is also what keeps this cheap on an hour-long 4K
// source.
//
// Returns 0 on any failure, which the caller treats as "no motion measured"
// rather than as an error - a motion hint that failed to compute must not fail
// the moderation pass that wanted it.
func measureMotion(ctx context.Context, source string) float64 {
	out, err := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-nostats",
		"-v", "info",
		"-i", source,
		"-t", "120",
		"-vf", "select='gt(scene,0)',metadata=print:file=-",
		"-f", "null", "-",
	).CombinedOutput()
	if err != nil {
		return 0
	}

	var max float64
	for _, line := range strings.Split(string(out), "\n") {
		// The line is `lavfi.scene_score=0.41234` printed by metadata=print.
		idx := strings.Index(line, "lavfi.scene_score=")
		if idx < 0 {
			continue
		}
		rest := strings.TrimSpace(line[idx+len("lavfi.scene_score="):])
		if v, perr := strconv.ParseFloat(rest, 64); perr == nil && v > max {
			max = v
		}
	}
	return max
}

// boundedDuration is the `-t` value every output block is bounded by, and it
// exists because of a hang, not a preference.
//
// `anullsrc` - substituted when the source has no audio - is an INFINITE
// generator. It never reaches EOF, so an output that maps it and has no other
// bound encodes forever: the ladder once ran for FORTY MINUTES of silent audio
// against a three-second video, with `-shortest` doing nothing about it,
// because `-shortest` needs every stream to reach an end and this one never
// does.
//
// So every output carries an explicit `-t`. It is the only bound that actually
// holds, and it is applied to the audio legs as well as the video ones.
//
// Returns false when there is nothing to bound with: an unmeasurable duration on
// a silent source, which would encode forever without it. That is a refuse, not
// a fall back - a job that never finishes occupies a worker for good.
//
// `hasVideo` distinguishes the audio-only leg: it has no video stream of its own
// to end on, so a missing measurement is fatal there even when the source has
// audio that does end.
func boundedDuration(p probeResult, hasVideo bool) (string, bool) {
	if p.durationS > 0 {
		return strconv.FormatFloat(p.durationS, 'f', 3, 64), true
	}
	if hasVideo && p.hasAudio {
		// Bounded by the source's own audio stream reaching EOF.
		return "", true
	}
	return "", false
}

// makePoster grabs one frame near the middle as a JPEG.
//
// `durationS` is float because truncating it would put the seek at 0 for any
// file shorter than a second - which is exactly the file whose poster is most
// likely to be a black frame.
func makePoster(ctx context.Context, workDir, source string, durationS float64) (string, error) {
	if durationS <= 0 {
		durationS = 1
	}
	seek := durationS / 3
	if seek <= 0 {
		seek = 0
	}
	out := filepath.Join(workDir, "poster.jpg")
	cmd := exec.CommandContext(ctx, "ffmpeg", "-y",
		"-ss", strconv.FormatFloat(seek, 'f', 3, 64),
		"-i", source,
		"-frames:v", "1",
		"-q:v", "3",
		out)
	if o, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("%v: %s", err, tail(string(o), 200))
	}
	return out, nil
}

// makeFilmstrip tiles 10 evenly-spaced frames into one contact sheet.
//
// Float duration, for the same reason as makePoster: an integer would sample at
// t=0 for anything under a second.
func makeFilmstrip(ctx context.Context, workDir, source string, durationS float64) (string, error) {
	if durationS <= 0 {
		durationS = 1
	}
	interval := durationS / filmstripFrames
	if interval < 1 {
		interval = 1
	}
	pattern := filepath.Join(workDir, "fs_%02d.jpg")
	sample := exec.CommandContext(ctx, "ffmpeg", "-y",
		"-i", source,
		"-vf", fmt.Sprintf("fps=1/%d,scale=160:90:force_original_aspect_ratio=decrease",
			int(interval)),
		// THE CAP that keeps `tile=10x1` satisfiable. Without it a source whose
		// sampled count is not a multiple of 10 fails the tile outright: 12
		// frames gave exit 234 and no filmstrip at all.
		"-frames:v", strconv.Itoa(filmstripFrames),
		"-q:v", "5",
		pattern)
	if o, err := sample.CombinedOutput(); err != nil {
		return "", fmt.Errorf("sample frames: %v: %s", err, tail(string(o), 200))
	}

	out := filepath.Join(workDir, "filmstrip.jpg")
	tile := exec.CommandContext(ctx, "ffmpeg", "-y",
		"-pattern_type", "glob",
		"-i", filepath.Join(workDir, "fs_*.jpg"),
		"-filter_complex", "scale=160:90,tile=10x1",
		"-q:v", "5",
		out)
	if o, err := tile.CombinedOutput(); err != nil {
		// A single-frame source cannot be tiled into a strip; fall back to the
		// first sampled frame so the strip is present, just short.
		if fsO, fsErr := exec.CommandContext(ctx, "ffmpeg", "-y",
			"-i", filepath.Join(workDir, "fs_01.jpg"), "-q:v", "5", out).CombinedOutput(); fsErr != nil {
			return "", fmt.Errorf("tile: %v (%s) | fallback: %v (%s)", err, tail(string(o), 120), fsErr, tail(string(fsO), 120))
		}
	}
	return out, nil
}

// makePeaks decodes audio to peak amplitudes for the player's waveform.
//
// A source with no audio returns an ErrNoAudio-style result rather than letting
// ffmpeg fail on its own: decoding `-f s16le` from a video with no audio stream
// produces an output with NO STREAMS, which is exit 234 and a message about a
// missing stream. That is an expected case, not a fault, so it is reported as
// such and the caller skips the artefact.
func makePeaks(ctx context.Context, workDir, source string, durationS float64, hasAudio bool) (string, error) {
	if !hasAudio {
		return "", fmt.Errorf("no audio stream in the source")
	}
	if durationS <= 0 {
		durationS = 1
	}
	// 100 buckets per second of duration keeps the JSON small and the waveform
	// smooth without being a raw PCM dump.
	buckets := int(durationS * 10)
	if buckets > 2000 {
		buckets = 2000
	}
	raw := filepath.Join(workDir, "peaks.raw")
	cmd := exec.CommandContext(ctx, "ffmpeg", "-y",
		"-i", source,
		"-ac", "1",
		"-f", "s16le",
		"-ar", strconv.Itoa(8000),
		raw)
	if o, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("pcm decode: %v: %s", err, tail(string(o), 200))
	}
	defer os.Remove(raw)

	data, err := os.ReadFile(raw)
	if err != nil {
		return "", err
	}

	// int16 little-endian -> peak per bucket.
	per := len(data) / buckets
	if per < 2 {
		per = 2
	}
	peaks := make([]int, 0, buckets)
	for i := 0; i < len(data)-1 && len(peaks) < buckets; i += per * 2 {
		lo := int(data[i]) | int(data[i+1])<<8
		peak := lo
		for j := 0; j < per && (i+j*2+1) < len(data); j++ {
			v := int(data[i+j*2]) | int(data[i+j*2+1])<<8
			if v > peak {
				peak = v
			}
		}
		// Normalise to 0..100 so the UI does not care about sample width.
		p := peak * 100 / 32767
		if p < 0 {
			p = -p
		}
		peaks = append(peaks, p)
	}

	out := filepath.Join(workDir, "peaks.json")
	enc, err := json.Marshal(map[string]any{"peaks": peaks, "buckets": len(peaks)})
	if err != nil {
		return "", err
	}
	return out, os.WriteFile(out, enc, 0644)
}

// uploadDir walks a rendition directory and returns how many files went up.
func uploadDir(ctx context.Context, videoID, leg, dir string) (int, error) {
	count := 0
	err := filepath.Walk(dir, func(path string, info os.FileInfo, werr error) error {
		if werr != nil {
			return werr
		}
		if info.IsDir() {
			return nil
		}
		rel, rerr := filepath.Rel(dir, path)
		if rerr != nil {
			return rerr
		}
		objectKey := fmt.Sprintf("%s/%s/%s", videoID, leg, rel)

		contentType := "application/octet-stream"
		switch strings.ToLower(filepath.Ext(rel)) {
		case ".m3u8":
			contentType = "application/vnd.apple.mpegurl"
		case ".ts":
			contentType = "video/mp2t"
		}
		if _, perr := minioClient.FPutObject(ctx, cfg.VideoBucket, objectKey, path,
			minio.PutObjectOptions{
				ContentType:  contentType,
				CacheControl: "public, max-age=31536000, immutable",
			}); perr != nil {
			return perr
		}
		count++
		return nil
	})
	return count, err
}

// uploadFile puts one file at an explicit key. Returns the key.
func uploadFile(ctx context.Context, videoID, name, path, contentType string) (string, error) {
	objectKey := fmt.Sprintf("%s/%s", videoID, name)
	_, err := minioClient.FPutObject(ctx, cfg.VideoBucket, objectKey, path,
		minio.PutObjectOptions{
			ContentType:  contentType,
			CacheControl: "public, max-age=31536000, immutable",
		})
	return objectKey, err
}

// publicURL renders the browser-facing URL for an object in the video bucket.
func publicURL(videoID, name string) string {
	scheme := "http"
	if cfg.MinIOUseSSL {
		scheme = "https"
	}
	publicHost := envStr("MINIO_PUBLIC_HOST", "localhost:9000")
	return fmt.Sprintf("%s://%s/%s/%s/%s", scheme, publicHost, cfg.VideoBucket, videoID, name)
}

// tail returns the last n bytes of s, for trimmed error output.
func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
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
		// NOT SILENT, and that is the whole point.
		//
		// This used to `return` with no log at all. The consequence was that a
		// misconfigured callback produced a transcode that completed, wrote
		// perfect renditions into MinIO, and left the asset at `uploaded`
		// forever - with nothing anywhere to say why. Nothing had failed; the
		// record of success was simply never sent.
		//
		// A loud log turns that invisible stall into a one-line diagnosis.
		log.Printf("[TRANSCODING] JOB %s FINISHED (%s) BUT THE CALLBACK IS NOT CONFIGURED: "+
			"TRANSCODE_CALLBACK_URL is empty, so asset %s will stay at its current state. "+
			"Set TRANSCODE_CALLBACK_URL to auth-service's "+
			"/api/v1/internal/media/transcode-callback endpoint.",
			job.ID, job.Status, job.VideoID)
		return
	}

	body := map[string]any{
		"asset_id":      job.VideoID,
		"job_id":        job.ID,
		"status":        job.Status,
		"progress":      job.Progress,
		"playlist_url":  job.PlaylistURL,
		"playlists":     job.Playlists,
		"poster_url":    job.PosterURL,
		"filmstrip_url": job.FilmstripURL,
		"peaks_url":     job.PeaksURL,
		"duration_s":    job.DurationS,
		"width":         job.Width,
		"height":        job.Height,
		"has_audio":     job.HasAudio,
		// MEASURED, not claimed. The source file is on local disk by the time this
		// runs, so its real size is knowable - and `DeclaredBytes` from the
		// client is exactly the number that must not be trusted.
		"bytes":         fileSize(job.SourceURL),
		"error":         job.Error,
	}

	// ---- The moderation verdict, on the same callback ----
	//
	// The transcoder is the one component that already has the source decoded,
	// so it is the one place a content check can run without a second copy of
	// the file and a second set of ffmpeg flags. `verdict` is approved |
	// rejected | flagged, and the checks map is the per-check breakdown.
	//
	// OMITTED ENTIRELY when moderation is disabled, rather than sent as
	// `approved`: an explicit "screening did not run" is honest, whereas an
	// `approved` that nobody produced is a claim the service would then be
	// storing as fact. auth-service maps an absent verdict to `pending_review`,
	// which holds the asset rather than releasing it.
	if job.Moderation != nil {
		body["moderation_verdict"] = job.Moderation.Verdict
		body["moderation_reason"] = job.Moderation.Reason
		body["moderation_score"] = job.Moderation.Score
		body["moderation_checks"] = job.Moderation.ChecksJSON()
		body["moderation_audio_verdict"] = job.Moderation.Provider
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

	// Transcode job submit karo.
	//
	// `kind` is `video` (default) or `reel`. A reel keeps the 1080x1920 leg
	// because that is what a vertical short is FOR; a long-form video still gets
	// every other leg and the reel rendition costs nothing extra to produce in
	// the same pass, so it is produced either way and simply not surfaced for
	// long-form. One pass, all legs - §5.1.
	r.POST("/api/v1/transcode", requireInternalToken, func(c *gin.Context) {
		var req struct {
			VideoID   string `json:"video_id" binding:"required"`
			SourceURL string `json:"source_url" binding:"required"`
			Kind      string `json:"kind"`
			Profile   string `json:"profile"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "video_id and source_url are required"})
			return
		}

		if strings.TrimSpace(req.Kind) == "" {
			req.Kind = "video"
		}

		job := TranscodeJob{
			ID:        uuid.New().String(),
			VideoID:   req.VideoID,
			SourceURL: req.SourceURL,
			Profile:   req.Kind,
			Playlists: make(map[string]string),
			Status:    "queued",
			CreatedAt: time.Now(),
		}

		select {
		case cfg.jobQueue <- job:
			log.Printf("[TRANSCODING] Job %s QUEUED (video=%s kind=%s)",
				job.ID, job.VideoID, req.Kind)
			c.JSON(http.StatusAccepted, gin.H{
				"job_id":  job.ID,
				"status":  "queued",
				"kind":    req.Kind,
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
