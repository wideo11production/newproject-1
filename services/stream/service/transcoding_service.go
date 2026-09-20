package service

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"newproject/services/stream/client"
	"newproject/services/stream/config"
	"newproject/services/stream/ffmpeg"
	"newproject/services/stream/model"
	"newproject/services/stream/repository"
	"newproject/services/stream/worker"
)

var ErrJobNotFound = repository.ErrJobNotFound

// TranscodingService manages the transcoding worker pool and job queue
type TranscodingService struct {
	cfg           *config.Config
	jobRepo       repository.TranscodeJobRepository
	outputRepo    repository.TranscodeOutputRepository
	manifestRepo  repository.TranscodeManifestRepository
	minioClient   *client.MinIOClient
	transcoder    ffmpeg.Transcoder
	workerPool    []*worker.TranscodingWorker
	jobQueue      chan *model.TranscodeJob
	wg            sync.WaitGroup
	cancelCtx     context.Context
	cancelFunc    context.CancelFunc
}

// NewTranscodingService creates a new transcoding service
func NewTranscodingService(
	cfg *config.Config,
	jobRepo repository.TranscodeJobRepository,
	outputRepo repository.TranscodeOutputRepository,
	manifestRepo repository.TranscodeManifestRepository,
	minioClient *client.MinIOClient,
	transcoder ffmpeg.Transcoder,
) *TranscodingService {
	ctx, cancel := context.WithCancel(context.Background())
	
	s := &TranscodingService{
		cfg:           cfg,
		jobRepo:       jobRepo,
		outputRepo:    outputRepo,
		manifestRepo:  manifestRepo,
		minioClient:   minioClient,
		transcoder:    transcoder,
		jobQueue:      make(chan *model.TranscodeJob, cfg.Worker.QueueSize),
		wg:            sync.WaitGroup{},
		cancelCtx:     ctx,
		cancelFunc:    cancel,
	}
	
	// Create worker pool
	s.workerPool = make([]*worker.TranscodingWorker, cfg.Worker.PoolSize)
	for i := 0; i < cfg.Worker.PoolSize; i++ {
		s.workerPool[i] = worker.NewTranscodingWorker(
			i,
			s.jobQueue,
			&s.wg,
			transcoder,
			minioClient,
			jobRepo,
			outputRepo,
			manifestRepo,
			cfg,
		)
		s.workerPool[i].Start()
	}
	
	return s
}

// StartJobQueue begins monitoring for new jobs (in a real system, this might listen to a message queue)
func (s *TranscodingService) StartJobQueue() {
	// In a real implementation, this would:
	// 1. Listen for upload completion events from a message queue
	// 2. Or poll the database for completed uploads
	// 3. Or receive HTTP requests to start transcoding
	//
	// For this example, we'll simulate by periodically checking for pending jobs
	go s.pollForJobs()
}

// pollForJobs periodically checks for pending transcoding jobs
func (s *TranscodingService) pollForJobs() {
	ticker := time.NewTicker(s.cfg.Worker.PollInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-s.cancelCtx.Done():
			return
		case <-ticker.C:
			// Get pending jobs from database
			jobs, err := s.jobRepo.GetPendingJobs(s.cancelCtx, 10) // Get up to 10 jobs at a time
			if err != nil {
				log.Printf("Error getting pending jobs: %v", err)
				continue
			}
			
			// Send jobs to workers via the job queue
			for _, job := range jobs {
				// Mark job as processing to prevent duplicate processing
				job.Status = model.JobStatusProcessing
				job.CurrentStep = "queued_for_processing"
				job.UpdatedAt = time.Now()
				if err := s.jobRepo.Update(s.cancelCtx, job); err != nil {
					log.Printf("Failed to update job status: %v", err)
					continue
				}
				
				// Send to worker pool
				select {
				case s.jobQueue <- job:
					// Job sent successfully
				case <-s.cancelCtx.Done():
					return
				}
			}
		}
	}
}

// SubmitJob submits a transcoding job for processing
func (s *TranscodingService) SubmitJob(ctx context.Context, job *model.TranscodeJob) error {
	// Validate that we have an upload to transcode
	// In a real implementation, we'd check that the upload exists and is complete
	
	// Set initial job status
	job.Status = model.JobStatusPending
	job.CurrentStep = "queued"
	job.CreatedAt = time.Now()
	job.UpdatedAt = time.Now()
	
	if err := s.jobRepo.Create(ctx, job); err != nil {
		return err
	}
	
	// The job will be picked up by the polling mechanism
	// In a real system with a message queue, we would send it directly to the queue
	return nil
}

// GetJobStatus returns the status of a transcoding job
func (s *TranscodingService) GetJobStatus(ctx context.Context, jobID uuid.UUID) (*model.TranscodeJob, error) {
	return s.jobRepo.GetByJobID(ctx, jobID)
}

// GetJobOutputs returns the outputs for a transcoding job
func (s *TranscodingService) GetJobOutputs(ctx context.Context, jobID uuid.UUID) ([]*model.TranscodeOutput, error) {
	return s.outputRepo.GetByJobID(ctx, jobID)
}

// GetJobManifests returns the manifests for a transcoding job
func (s *TranscodingService) GetJobManifests(ctx context.Context, jobID uuid.UUID) ([]*model.TranscodeManifest, error) {
	return s.manifestRepo.GetByJobID(ctx, jobID)
}

// CancelJob cancels a transcoding job by updating its status
func (s *TranscodingService) CancelJob(ctx context.Context, job *model.TranscodeJob) error {
	return s.jobRepo.Update(ctx, job)
}

// Shutdown gracefully shuts down the transcoding service
func (s *TranscodingService) Shutdown() {
	log.Println("Shutting down transcoding service...")
	s.cancelFunc()
	
	// Wait for all workers to finish
	s.wg.Wait()
	
	// Close the job queue
	close(s.jobQueue)
	
	log.Println("Transcoding service shut down")
}
