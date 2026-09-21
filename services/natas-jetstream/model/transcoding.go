package model

import "time"

// TranscodingJob represents a transcoding job in the JetStream event backbone
type TranscodingJob struct {
    ID        string
    VideoID   uint
    Status    string // e.g., "queued", "processing", "completed", "failed"
    Progress  float64
    CreatedAt time.Time
    CompletedAt *time.Time
    Error     string
}

// QualityVariant represents a quality variant for transcoding
// Used to define different bitrate/resolution combinations for video encoding
type QualityVariant struct {
    VideoID   uint
    Resolution string // e.g., "1080p", "720p", "480p"
    Bitrate   string // e.g., "12000k", "8000k"
    Codec     string // e.g., "h264", "hevc"
    MinioPath string // Path where the encoded file is stored
    IndexFile string // Index file for the encoded video
    Status    string // "ready", "processing", "failed"
}

// TranscodingEvent represents a transcoding event in the JetStream
// Used for tracking transcoding operations across the event backbone
type TranscodingEvent struct {
    ID        string
    JobID     string
    Type      string // EventType enum value
    InputID   string
    OutputID  string
    Status    string
    Timestamp time.Time
}

// EventBackbone represents the entire event backbone system
type EventBackbone struct {
    Events         []TranscodingEvent
    Jobs           []TranscodingJob
    Metadata       map[string]string
}
