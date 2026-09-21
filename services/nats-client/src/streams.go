package natsclient

import (
	"fmt"
)

// Stream represents a NATS JetStream stream definition
type Stream struct {
	Name        string // e.g., "VIDEO", "WALLET", "ADS", "NOTIFICATION", "AUDIT", "USER", "EDITOR"
	Description string // Human-readable description
	Partitions  int           // Number of partitions for the stream
	Retention   time.Duration // Retention period (e.g., 24h, 7d)
	AcknowledgmentPolicy string // "explicit", "all", "none"
	DeadLetterQueue string      // Name of DLQ stream if applicable
}

// StreamDefinition holds the complete definition for a stream
type StreamDefinition struct {
	Stream       *Stream
	ConsumerPatterns []ConsumerPattern
}

// ConsumerPattern defines how consumers should be configured for a stream
type ConsumerPattern struct {
	Type         string // "durable", "ephemeral"
	Throughput   int    // Target throughput in messages/sec
	AckPolicy   string // "explicit", "all", "none"
	ReplayPolicy string // "catch_up", "last_delivered"
	DeadLetter  bool // Whether to route failed messages to DLQ
}

// VIDEOStream defines the VIDEO domain stream
func VIDEOStream() *Stream {
	return &Stream{
		Name:        "VIDEO",
		Description: "Video lifecycle events (upload, processing, completed, failed, thumbnail, subtitle)",
		Partitions:  4,
		Retention:   7*24*time.Hour,
		AcknowledgmentPolicy: "explicit",
	}
}

// WALLETStream defines the WALLET domain stream
func WALLETStream() *Stream {
	return &Stream{
		Name:        "WALLET",
		Description: "Wallet transaction events (transaction, balance_change, withdrawal, royalty)",
		Partitions:  4,
		Retention:   30*24*time.Hour,
		AcknowledgmentPolicy: "explicit",
	}
}

// ADSStream defines the ADS domain stream
func ADSStream() *Stream {
	return &Stream{
		Name:        "ADS",
		Description: "Advertising events (impression, click, conversion, revenue)",
		Partitions:  4,
		Retention:   7*24*time.Hour,
		AcknowledgmentPolicy: "explicit",
	}
}

// NOTIFICATIONStream defines the NOTIFICATION domain stream
func NOTIFICATIONStream() *Stream {
	return &Stream{
		Name:        "NOTIFICATION",
		Description: "Notification events (push, email, in_app, sms)",
		Partitions:  4,
		Retention:   30*24*time.Hour,
		AcknowledgmentPolicy: "explicit",
	}
}

// AUDITStream defines the AUDIT domain stream
func AUDITStream() *Stream {
	return &Stream{
		Name:        "AUDIT",
		Description: "Audit trail (auth, admin, security, compliance)",
		Partitions:  4,
		Retention:   90*24*time.Hour,
		AcknowledgmentPolicy: "all",
	}
}

// USERStream defines the USER domain stream
func USERStream() *Stream {
	return &Stream{
		Name:        "USER",
		Description: "User lifecycle events (created, updated, deleted, device, session)",
		Partitions:  4,
		Retention:   30*24*time.Hour,
		AcknowledgmentPolicy: "explicit",
	}
}

// EDITORStream defines the EDITOR domain stream
func EDITORStream() *Stream {
	return &Stream{
		Name:        "EDITOR",
		Description: "Editor operations (project, asset, render, export, autosave)",
		Partitions:  4,
		Retention:   7*24*time.Hour,
		AcknowledgmentPolicy: "explicit",
	}
}

// BuildStreamDefinitions returns all stream definitions
func BuildStreamDefinitions() []*StreamDefinition {
	return []*StreamDefinition{
		{Stream: VIDEOStream(), ConsumerPatterns: []ConsumerPattern{{Type: "durable", Throughput: 100, AckPolicy: "explicit"}}},
		{Stream: WALLETStream(), ConsumerPatterns: []ConsumerPattern{{Type: "durable", Throughput: 50, AckPolicy: "explicit"}}},
		{Stream: ADSStream(), ConsumerPatterns: []ConsumerPattern{{Type: "durable", Throughput: 200, AckPolicy: "explicit"}}},
		{Stream: NOTIFICATIONStream(), ConsumerPatterns: []ConsumerPattern{{Type: "durable", Throughput: 500, AckPolicy: "explicit"}}},
		{Stream: AUDITStream(), ConsumerPatterns: []ConsumerPattern{{Type: "durable", Throughput: 100, AckPolicy: "all"}}},
		{Stream: USERStream(), ConsumerPatterns: []ConsumerPattern{{Type: "durable", Throughput: 50, AckPolicy: "explicit"}}},
		{Stream: EDITORStream(), ConsumerPatterns: []ConsumerPattern{{Type: "durable", Throughput: 100, AckPolicy: "explicit"}}},
	}
}
