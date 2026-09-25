// Job Queue Manager for Transcoding Service
// Manages transcoding job queue with Redis backend for distributed processing
// Runs OUTSIDE GKE compute nodes on dedicated transcoding infrastructure
package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wideo11/transcoding-service/src/internal/transcoder"
)

// JobQueue handles transcoding job queuing and processing
// Redis-based job queue for distributed transcoding workload management
type JobQueue struct {
	client     *redis.Client
	transcoder *transcoder.Transcoder
	queueName  string
	workerID   string
}

// NewJobQueue creates a new job queue instance
// Initialize job queue with Redis connection and transcoder
func NewJobQueue(redisAddr, queueName, workerID string, transcoder *transcoder.Transcoder) (*JobQueue, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: "", // No password for local development
		DB:       0,
	})

	// Test Redis connection
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("[JOB-QUEUE] Redis connection warning: %v", err)
	}

	return &JobQueue{
		client:     client,
		transcoder: transcoder,
		queueName:  queueName,
		workerID:   workerID,
	}, nil
}

// EnqueueJob adds a new transcoding job to the queue
// Add transcoding job to Redis queue for async processing
func (q *JobQueue) EnqueueJob(ctx context.Context, job *transcoder.TranscodeJob) error {
	jobData, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("[JOB-QUEUE] Failed to marshal job: %w", err)
	}

	// Push to Redis list (queue)
	err = q.client.LPush(ctx, q.queueName, jobData).Err()
	if err != nil {
		return fmt.Errorf("[JOB-QUEUE] Failed to enqueue job: %w", err)
	}

	log.Printf("[JOB-QUEUE] Job %s enqueued to %s", job.JobID, q.queueName)
	return nil
}

// DequeueJob retrieves and removes a job from the queue
// Get next transcoding job from Redis queue for processing
func (q *JobQueue) DequeueJob(ctx context.Context) (*transcoder.TranscodeJob, error) {
	// Blocking pop with timeout
	result, err := q.client.BRPop(ctx, 5*time.Second, q.queueName).Result()
	if err == redis.Nil {
		return nil, nil // Queue empty
	}
	if err != nil {
		return nil, fmt.Errorf("[JOB-QUEUE] Failed to dequeue job: %w", err)
	}

	if len(result) < 2 {
		return nil, nil
	}

	var job transcoder.TranscodeJob
	if err := json.Unmarshal([]byte(result[1]), &job); err != nil {
		return nil, fmt.Errorf("[JOB-QUEUE] Failed to unmarshal job: %w", err)
	}

	log.Printf("[JOB-QUEUE] Job %s dequeued by worker %s", job.JobID, q.workerID)
	return &job, nil
}

// ProcessJobs starts the worker loop to process jobs from the queue
// Worker loop: continuously process transcoding jobs from queue
func (q *JobQueue) ProcessJobs(ctx context.Context) {
	log.Printf("[JOB-QUEUE] Worker %s started processing queue %s", q.workerID, q.queueName)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[JOB-QUEUE] Worker %s stopping", q.workerID)
			return
		default:
			job, err := q.DequeueJob(ctx)
			if err != nil {
				log.Printf("[JOB-QUEUE] Dequeue error: %v", err)
				time.Sleep(1 * time.Second)
				continue
			}

			if job == nil {
				continue // Queue empty, wait for next iteration
			}

			// Process the transcoding job
			if err := q.transcoder.TranscodeToHLS(ctx, job); err != nil {
				log.Printf("[JOB-QUEUE] Job %s processing failed: %v", job.JobID, err)
				// Re-queue failed job with incremented retry count
				q.requeueJob(ctx, job)
			} else {
				log.Printf("[JOB-QUEUE] Job %s completed successfully", job.JobID)
			}
		}
	}
}

// requeueJob re-queues a failed job with retry logic
// Re-queue failed transcoding job with exponential backoff
func (q *JobQueue) requeueJob(ctx context.Context, job *transcoder.TranscodeJob) {
	// Increment retry count
	retryCount := 0
	if val, ok := job.Metadata["retry_count"]; ok {
		if count, ok := val.(float64); ok {
			retryCount = int(count)
		}
	}

	// Max 3 retries
	if retryCount >= 3 {
		log.Printf("[JOB-QUEUE] Job %s exceeded max retries, marking failed permanently", job.JobID)
		job.Status = "failed_permanent"
		job.Error = "Max retries exceeded"
		return
	}

	job.Metadata["retry_count"] = retryCount + 1
	job.Status = "queued"
	job.Error = ""

	// Exponential backoff: wait before re-queue
	backoff := time.Duration(retryCount+1) * 30 * time.Second
	time.Sleep(backoff)

	if err := q.EnqueueJob(ctx, job); err != nil {
		log.Printf("[JOB-QUEUE] Failed to re-queue job %s: %v", job.JobID, err)
	}
}

// GetQueueStats returns current queue statistics
// Get current queue statistics for monitoring
func (q *JobQueue) GetQueueStats(ctx context.Context) map[string]interface{} {
	length, _ := q.client.LLen(ctx, q.queueName).Result()
	return map[string]interface{}{
		"queue_name":    q.queueName,
		"pending_jobs":  length,
		"worker_id":     q.workerID,
		"timestamp":     time.Now().Unix(),
	}
}