package service

import (
	"context"
	"os/exec"
	"strings"
	"sync"
	"time"

	"newproject/services/transcoding-service/src/model"
	"newproject/services/transcoding-service/src/repository"
)

type TranscodingConfig struct {
	FFmpegPath    string
	InputDir      string
	OutputDir     string
	Qualities     []QualityProfile
	MaxConcurrent int
}

type QualityProfile struct {
	Height      int
	Bitrate     string
	Codec       string
	Profile     string
}

type TranscodingService struct {
	cfg       TranscodingConfig
	videoRepo repository.VideoRepository
	qualRepo  repository.QualityRepository
	jobRepo   repository.JobRepository
	mu        sync.Mutex
}

func NewTranscodingService(cfg TranscodingConfig, videoRepo repository.VideoRepository, qualRepo repository.QualityRepository, jobRepo repository.JobRepository) *TranscodingService {
	return &TranscodingService{
		cfg:       cfg,
		videoRepo: videoRepo,
		qualRepo:  qualRepo,
		jobRepo:   jobRepo,
	}
}

func (s *TranscodingService) QueueTranscoding(ctx context.Context, videoID uint) (*model.TranscodingJob, error) {
	job := &model.TranscodingJob{
		VideoID: videoID,
		Status:  "queued",
		Progress: 0,
	}
	if err := s.jobRepo.Create(ctx, job); err != nil {
		return nil, err
	}
	return job, nil
}

func (s *TranscodingService) ProcessNext(ctx context.Context) {
	jobs, err := s.jobRepo.ListQueued(ctx, s.cfg.MaxConcurrent)
	if err != nil {
		return
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, s.cfg.MaxConcurrent)

	for _, job := range jobs {
		s.mu.Lock()
		if job.Status != "queued" {
			s.mu.Unlock()
			continue
		}
		job.Status = "processing"
		s.jobRepo.Update(ctx, job)
		s.mu.Unlock()

		wg.Add(1)
		sem <- struct{}{}
		go func(j *model.TranscodingJob) {
			defer wg.Done()
			defer func() { <-sem }()
			s.processJob(ctx, j)
		}(job)
	}
	wg.Wait()
}

func (s *TranscodingService) processJob(ctx context.Context, job *model.TranscodingJob) {
	video, err := s.videoRepo.GetByID(ctx, job.VideoID)
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		s.jobRepo.Update(ctx, job)
		return
	}

	inputPath := s.cfg.InputDir + "/" + video.MinioPath
	if _, err := exec.LookPath(s.cfg.FFmpegPath); err != nil {
		job.Status = "failed"
		job.Error = "ffmpeg not found: " + err.Error()
		s.jobRepo.Update(ctx, job)
		return
	}

	for _, profile := range s.cfg.Qualities {
		outputPath := s.cfg.OutputDir + "/" + video.UUID.String() + "/" + profile.Codec + "_" + itoa(profile.Height) + ".m3u8"

		cmd := exec.CommandContext(ctx, s.cfg.FFmpegPath,
			"-i", inputPath,
			"-c:v", "libx264",
			"-b:v", profile.Bitrate,
			"-maxrate", profile.Bitrate,
			"-bufsize", profile.Bitrate,
			"-vf", "scale=-1:" + itoa(profile.Height),
			"-profile:v", profile.Profile,
			"-c:a", "aac",
			"-b:a", "128k",
			"-hls_time", "6",
			"-hls_list_size", "0",
			"-f", "hls",
			outputPath,
		)

		if err := cmd.Run(); err != nil {
			job.Status = "failed"
			job.Error = "ffmpeg failed for " + profile.Codec + ": " + err.Error()
			s.jobRepo.Update(ctx, job)
			return
		}

		variant := &model.QualityVariant{
			VideoID:   video.ID,
			Resolution: itoa(profile.Height) + "p",
			Bitrate:   parseInt(profile.Bitrate),
			Codec:     profile.Codec,
			MinioPath: outputPath,
			IndexFile: outputPath,
			Status:    "ready",
		}
		s.qualRepo.Create(ctx, variant)
	}

	now := time.Now()
	job.Status = "completed"
	job.Progress = 100
	job.CompletedAt = &now
	s.jobRepo.Update(ctx, job)

	video.Status = "processed"
	s.videoRepo.Update(ctx, video)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

func parseInt(s string) int {
	if len(s) == 0 {
		return 0
	}
	result := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			result = result*10 + int(c-'0')
		} else {
			break
		}
	}
	return result
}

func DefaultQualityProfiles() []QualityProfile {
	return []QualityProfile{
		{Height: 2160, Bitrate: "12000k", Codec: "h264", Profile: "high"},
		{Height: 1440, Bitrate: "8000k", Codec: "h264", Profile: "high"},
		{Height: 1080, Bitrate: "5000k", Codec: "h264", Profile: "high"},
		{Height: 720, Bitrate: "2500k", Codec: "h264", Profile: "main"},
		{Height: 480, Bitrate: "1000k", Codec: "h264", Profile: "main"},
		{Height: 360, Bitrate: "600k", Codec: "h264", Profile: "baseline"},
		{Height: 240, Bitrate: "400k", Codec: "h264", Profile: "baseline"},
		{Height: 144, Bitrate: "200k", Codec: "h264", Profile: "baseline"},
	}
}

func (s *TranscodingService) GetJobStatus(ctx context.Context, jobID uint) (*model.TranscodingJob, error) {
	return s.jobRepo.GetByID(ctx, jobID)
}

func (s *TranscodingService) GetVideoQualities(ctx context.Context, videoID uint) ([]*model.QualityVariant, error) {
	return s.qualRepo.GetByVideoID(ctx, videoID)
}

func (s *TranscodingService) GenerateHLSMaster(ctx context.Context, videoID uint) (string, error) {
	video, err := s.videoRepo.GetByID(ctx, videoID)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString("#EXTM3U\n#EXT-X-VERSION:6\n")

	variants, err := s.qualRepo.GetByVideoID(ctx, videoID)
	if err != nil {
		return "", err
	}

	for _, v := range variants {
		bandwidth := v.Bitrate * 1000
		sb.WriteString("#EXT-X-STREAM-INF:BANDWIDTH=" + itoa(bandwidth) + ",RESOLUTION=")
		parts := strings.Split(v.Resolution, "p")
		if len(parts[0]) > 0 {
			sb.WriteString(parts[0] + "x" + parts[0])
		}
		sb.WriteString("\n")
		sb.WriteString(v.MinioPath + "\n")
	}

	masterPath := s.cfg.OutputDir + "/" + video.UUID.String() + "/master.m3u8"
	return masterPath, nil
}
