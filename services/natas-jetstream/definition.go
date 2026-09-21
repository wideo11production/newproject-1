package natasjetstream

import "time"

// EventType represents the type of event in the Natas JetStream event backbone
type EventType string

// Define the supported event types
const (
    EventVideo   EventType = "VIDEO"
    EventWallet  EventType = "WALLET"
    EventAds     EventType = "ADS"
    EventNotificationEventType EventType = "NOTIFICATION"
    EventAudit   EventType = "AUDIT"
    EventUser    EventType = "USER"
    EventEditor  EventType = "EDITOR"
)

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

// TranscodingEvent represents a transcoding event in the JetStream
// Used for tracking transcoding operations across the event backbone
type TranscodingEvent struct {
    ID        string
    JobID     string
    Type      EventType
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
