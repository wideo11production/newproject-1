package worker

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"newproject/services/stream/config"
	"newproject/services/stream/ffmpeg"
	"newproject/services/stream/model"
	"newproject/services/stream/repository"
)

// TranscodingWorker handles video transcoding jobs
type TranscodingWorker struct {
	ID           int
	jobs         chan *model.TranscodeJob
	wg           *sync.WaitGroup
	transcoder   ffmpeg.Transcoder
	minioClient  interface{}
	jobRepo      repository.TranscodeJobRepository
	outputRepo   repository.TranscodeOutputRepository
	manifestRepo repository.TranscodeManifestRepository
	cfg          *config.Config
	cancelCtx    context.Context
	cancelFunc   context.CancelFunc
}

// NewTranscodingWorker creates a new transcoding worker
func NewTranscodingWorker(
	id int,
	jobChan chan *model.TranscodeJob,
	wg *sync.WaitGroup,
	transcoder ffmpeg.Transcoder,
	minioClient interface{},
	jobRepo repository.TranscodeJobRepository,
	outputRepo repository.TranscodeOutputRepository,
	manifestRepo repository.TranscodeManifestRepository,
	cfg *config.Config,
) *TranscodingWorker {
	ctx, cancel := context.WithCancel(context.Background())
	return &TranscodingWorker{
		ID:           id,
		jobs:         jobChan,
		wg:           wg,
		transcoder:   transcoder,
		minioClient:  minioClient,
		jobRepo:      jobRepo,
		outputRepo:   outputRepo,
		manifestRepo: manifestRepo,
		cfg:          cfg,
		cancelCtx:    ctx,
		cancelFunc:   cancel,
	}
}

// Start begins the worker's job processing loop
func (w *TranscodingWorker) Start() {
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		for {
			select {
			case <-w.cancelCtx.Done():
				return
			case job, ok := <-w.jobs:
				if !ok {
					return
				}
				if err := w.ProcessJob(w.cancelCtx, job); err != nil {
					log.Printf("Worker %d: Job %s failed: %v", w.ID, job.JobID, err)
					// Update job status to failed
					job.Status = model.JobStatusFailed
					job.ErrorMessage = err.Error()
					job.UpdatedAt = time.Now()
					if err := w.jobRepo.Update(w.cancelCtx, job); err != nil {
						log.Printf("Worker %d: Failed to update job status: %v", w.ID, err)
					}
				} else {
					log.Printf("Worker %d: Job %s completed successfully", w.ID, job.JobID)
				}
			}
		}
	}()
}

// Stop signals the worker to stop
func (w *TranscodingWorker) Stop() {
	w.cancelFunc()
}

// ProcessJob handles a single transcoding job
func (w *TranscodingWorker) ProcessJob(ctx context.Context, job *model.TranscodeJob) error {
	// Update job status to processing
	job.Status = model.JobStatusProcessing
	job.StartedAt = &[]time.Time{time.Now()}[0]
	job.CurrentStep = model.StepDownloading
	job.UpdatedAt = time.Now()
	if err := w.jobRepo.Update(ctx, job); err != nil {
		return fmt.Errorf("failed to update job status: %w", err)
	}

	// Download the input file from MinIO to temporary storage
	inputPath := fmt.Sprintf("%s/%s", w.cfg.Transcode.TempStoragePath, job.InputPath)
	if err := w.downloadFile(ctx, job.UploadID, job.InputPath, inputPath); err != nil {
		return fmt.Errorf("failed to download input file: %w", err)
	}

	// Get video metadata
	job.CurrentStep = "getting_metadata"
	job.UpdatedAt = time.Now()
	if err := w.jobRepo.Update(ctx, job); err != nil {
		return fmt.Errorf("failed to update job status: %w", err)
	}

	metadata, err := w.transcoder.GetVideoMetadata(ctx, inputPath)
	if err != nil {
		return fmt.Errorf("failed to get video metadata: %w", err)
	}

	// Define output resolutions and bitrates
	resolutions := []struct {
		Name    string
		Width   int
		Height  int
		Bitrate int // kbps
	}{
		{Name: "360p", Width: 480, Height: 360, Bitrate: 800},
		{Name: "480p", Width: 854, Height: 480, Bitrate: 1500},
		{Name: "720p", Width: 1280, Height: 720, Bitrate: 3000},
		{Name: "1080p", Width: 1920, Height: 1080, Bitrate: 5000},
	}

	// Transcode to each resolution
	var outputs []*model.TranscodeOutput
	var manifests []*model.TranscodeManifest

	for i, res := range resolutions {
		// Check if context is cancelled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		job.CurrentStep = fmt.Sprintf("transcoding_%s", res.Name)
		job.Progress = float64(i) / float64(len(resolutions)) * 80 // 0-80% for transcoding
		job.UpdatedAt = time.Now()
		if err := w.jobRepo.Update(ctx, job); err != nil {
			return fmt.Errorf("failed to update job status: %w", err)
		}

		// Generate output paths
		outputFilename := fmt.Sprintf("%s_%s.%s", job.JobID, res.Name, "m3u8") // HLS segment playlist
		outputPath := fmt.Sprintf("%s/%s", w.cfg.Transcode.TempStoragePath, outputFilename)
		minioOutputPath := fmt.Sprintf("transcodes/%s/%s", job.JobID, outputFilename)

		// Transcode video
		if err := w.transcoder.TranscodeVideo(ctx, inputPath, outputPath, res.Width, res.Height, res.Bitrate*1000, metadata.Framerate); err != nil {
			return fmt.Errorf("failed to transcode to %s: %w", res.Name, err)
		}

		// Generate HLS manifest for this resolution
		manifestPath := fmt.Sprintf("%s/%s_manifest.m3u8", w.cfg.Transcode.TempStoragePath, job.JobID)
		minioManifestPath := fmt.Sprintf("transcodes/%s/%s_manifest.m3u8", job.JobID, res.Name)
		if err := w.transcoder.GenerateHLSManifest(ctx, []string{outputPath}, manifestPath, 4); err != nil {
			return fmt.Errorf("failed to generate HLS manifest for %s: %w", res.Name, err)
		}

		// Upload output file to MinIO
		if err := w.uploadFile(ctx, outputPath, minioOutputPath); err != nil {
			return fmt.Errorf("failed to upload transcoded file: %w", err)
		}

		// Upload manifest to MinIO
		if err := w.uploadFile(ctx, manifestPath, minioManifestPath); err != nil {
			return fmt.Errorf("failed to upload manifest: %w", err)
		}

		// Create output record
		output := &model.TranscodeOutput{
			JobID:      job.JobID,
			Resolution: res.Name,
			Format:     "HLS",
			Path:       minioOutputPath,
			Bitrate:    res.Bitrate,
			Framerate:  metadata.Framerate,
			FileSize:   0,  // Would need to get actual size from MinIO or file
			Checksum:   "", // Would need to calculate
		}
		if err := w.outputRepo.Create(ctx, output); err != nil {
			return fmt.Errorf("failed to create output record: %w", err)
		}
		outputs = append(outputs, output)

		// Create manifest record
		manifest := &model.TranscodeManifest{
			JobID:        job.JobID,
			ManifestType: fmt.Sprintf("HLS_%s", res.Name),
			Path:         minioManifestPath,
			Content:      nil, // Would need to read the file content
		}
		if err := w.manifestRepo.Create(ctx, manifest); err != nil {
			return fmt.Errorf("failed to create manifest record: %w", err)
		}
		manifests = append(manifests, manifest)
	}

	// Generate main manifest that references all variants
	job.CurrentStep = model.StepGeneratingManifest
	job.Progress = 90
	job.UpdatedAt = time.Now()
	if err := w.jobRepo.Update(ctx, job); err != nil {
		return fmt.Errorf("failed to update job status: %w", err)
	}

	mainManifestPath := fmt.Sprintf("%s/%s_main.m3u8", w.cfg.Transcode.TempStoragePath, job.JobID)
	minioMainManifestPath := fmt.Sprintf("transcodes/%s/main.m3u8", job.JobID)

	// In a real implementation, we would generate the actual HLS master manifest
	// For this example, we'll create a simple placeholder
	mainManifestContent := []byte(fmt.Sprintf(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d
%s_360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d
%s_480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d
%s_720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d
%s_1080p.m3u8
`,
		800*1000, 480, 360, "360p.m3u8",
		1500*1000, 854, 480, "480p.m3u8",
		3000*1000, 1280, 720, "720p.m3u8",
		5000*1000, 1920, 1080, "1080p.m3u8"))

	if err := w.uploadData(ctx, mainManifestPath, minioMainManifestPath, mainManifestContent); err != nil {
		return fmt.Errorf("failed to upload main manifest: %w", err)
	}

	// Create main manifest record
	mainManifest := &model.TranscodeManifest{
		JobID:        job.JobID,
		ManifestType: "HLS_MAIN",
		Path:         minioMainManifestPath,
		Content:      mainManifestContent,
	}
	if err := w.manifestRepo.Create(ctx, mainManifest); err != nil {
		return fmt.Errorf("failed to create main manifest record: %w", err)
	}

	// Update job as completed
	job.Status = model.JobStatusCompleted
	job.CurrentStep = model.StepCompleted
	job.Progress = 100
	job.CompletedAt = &[]time.Time{time.Now()}[0]
	job.UpdatedAt = time.Now()
	if err := w.jobRepo.Update(ctx, job); err != nil {
		return fmt.Errorf("failed to update job status: %w", err)
	}

	return nil
}

// downloadFile downloads a file from MinIO to local storage
func (w *TranscodingWorker) downloadFile(ctx context.Context, uploadID interface{}, remotePath string, localPath string) error {
	// In a real implementation, this would use the MinIO client to get the object
	// For this example, we'll simulate the work

	// Create directory if it doesn't exist
	if err := os.MkdirAll(w.cfg.Transcode.TempStoragePath, 0o755); err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}

	// Simulate download time based on file size (we don't have the actual size here)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(3 * time.Second): // Simulate download
		// In reality, we'd write the data to localPath
		return nil
	}
}

// uploadFile uploads a file from local storage to MinIO
func (w *TranscodingWorker) uploadFile(ctx context.Context, localPath string, remotePath string) error {
	// In a real implementation, this would use the MinIO client to put the object
	// For this example, we'll simulate the work

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(2 * time.Second): // Simulate upload
		return nil
	}
}

// uploadData uploads raw data to MinIO
func (w *TranscodingWorker) uploadData(ctx context.Context, localPath string, remotePath string, data []byte) error {
	// In a real implementation, this would use the MinIO client to put the object
	// For this example, we'll simulate the work

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(1 * time.Second): // Simulate upload
		return nil
	}
}
