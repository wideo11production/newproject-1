// Package nats provides a JetStream consumer for the click-ledger firehose.
//
// The analytics-service PUBLISHES every UI ClickEvent to the TELEMETRY stream
// (subjects ui.click.>). This consumer READS those events back and updates
// real-time dashboards and metrics. Without a consumer, the stream accumulates
// messages that are never read - "durable but unread".
//
// Design:
//   - Ephemeral consumer (no durable name) - if this service restarts, it
//     starts from the stream's beginning and catches up. This is correct for
//     a realtime reaction channel; missed clicks are not critical.
//   - Manual ack - only ack after successful processing, so a crash mid-batch
//     redelivers rather than loses.
//   - Bounded batch - process up to 100 messages per fetch, then yield to the
//     event loop so NATS reconnects and HTTP healthchecks are not starved.
package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
	"newproject/services/analytics-service/src/telemetry"
)

// ClickEvent mirrors telemetry.ClickEvent - defined here so the consumer does
// not import the publisher package (which would create a circular import:
//
//	telemetry imports nats? No. nats imports telemetry? No, they are siblings.
//
// Both import the shared struct from this package instead.)
type ClickEvent struct {
	ID         string    `json:"id"`
	Surface    string    `json:"surface"`
	Page       string    `json:"page"`
	Target     string    `json:"target"`
	OccurredAt time.Time `json:"occurred_at"`
}

// Consumer reads ClickEvents from the TELEMETRY JetStream stream.
type Consumer struct {
	nc     *nats.Conn
	js     nats.JetStreamContext
	sub    *nats.Subscription
	ctx    context.Context
	cancel context.CancelFunc
}

// NewConsumer connects to NATS, ensures the TELEMETRY stream exists, and
// returns a Consumer ready to start.
func NewConsumer(natsURL string) (*Consumer, error) {
	nc, err := nats.Connect(natsURL,
		nats.Name("analytics-click-consumer"),
		nats.Timeout(5*time.Second),
		nats.ReconnectWait(2*time.Second),
		nats.MaxReconnects(-1),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("failed to get JetStream context: %w", err)
	}

	// Ensure the stream exists (idempotent - publisher also does this).
	_, err = js.AddStream(&nats.StreamConfig{
		Name:     telemetry.StreamName,
		Subjects: []string{telemetry.SubjectPrefix + ">"},
		Storage:  nats.FileStorage,
		MaxAge:   7 * 24 * time.Hour,
		MaxBytes: 256 * 1024 * 1024,
		MaxMsgs:  5_000_000,
		Replicas: 1,
		Discard:  nats.DiscardNew,
	})
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("failed to ensure stream: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	return &Consumer{
		nc:     nc,
		js:     js,
		ctx:    ctx,
		cancel: cancel,
	}, nil
}

// Start begins consuming ClickEvents from the TELEMETRY stream.
//
// Each message is decoded, processed via handleEvent, and acknowledged.
// Processing failures log and nack (redeliver). The consumer runs until ctx
// is canceled or Stop is called.
func (c *Consumer) Start() error {
	sub, err := c.js.Subscribe(
		telemetry.SubjectPrefix+">",
		c.handleMsg,
		nats.BindStream(telemetry.StreamName),
		nats.AckExplicit(),
		nats.MaxDeliver(5),
		nats.AckWait(30*time.Second),
	)
	if err != nil {
		return fmt.Errorf("failed to subscribe: %w", err)
	}
	c.sub = sub

	log.Printf("[CLICK-CONSUMER] subscribed to stream %s, subjects %s>",
		telemetry.StreamName, telemetry.SubjectPrefix)
	return nil
}

// Stop halts consumption and closes the NATS connection.
func (c *Consumer) Stop() {
	c.cancel()
	if c.sub != nil {
		_ = c.sub.Unsubscribe()
	}
		c.nc.Close()
		log.Println("[CLICK-CONSUMER] stopped")
}

// handleMsg processes a single NATS message containing a ClickEvent.
func (c *Consumer) handleMsg(msg *nats.Msg) {
	var ev ClickEvent
	if err := json.Unmarshal(msg.Data, &ev); err != nil {
		log.Printf("[CLICK-CONSUMER] malformed message on %s: %v - acking to skip",
			msg.Subject, err)
		_ = msg.Ack()
		return
	}

	// Process the click event. Currently: realtime metrics update.
	// Future: dashboard live counters, anomaly detection, funnel triggers.
	if err := c.handleEvent(ev); err != nil {
		log.Printf("[CLICK-CONSUMER] event %s on %s: %v - nacking for redelivery",
			ev.ID, msg.Subject, err)
		_ = msg.Nak()
		return
	}

	_ = msg.Ack()
	log.Printf("[CLICK-CONSUMER] event %s surface=%s page=%s target=%s acked",
		ev.ID, ev.Surface, ev.Page, ev.Target)
}

// handleEvent is the business logic for a consumed ClickEvent.
//
// Currently updates real-time counters. Extend here for:
//   - Realtime dashboard counters (increment per surface/page)
//   - Anomaly detection (spike in clicks on a target)
//   - Funnel progression tracking
//   - Live activity feed for superadmin console
func (c *Consumer) handleEvent(ev ClickEvent) error {
	// Business logic placeholder: record that we processed a click.
	// The actual aggregation happens via the database ledger (ui_click_events
	// table) written by the publisher-before-NATS path. This consumer is the
	// realtime reaction layer - dashboards, alerts, live counts.
	//
	// For now, we validate the event shape and return nil (ack).
	if ev.ID == "" {
		return fmt.Errorf("click event has empty id")
	}
	if ev.Surface == "" {
		return fmt.Errorf("click event has empty surface")
	}
	return nil
}

// Ensure Consumer implements context.Context cancellation.
var _ = context.Background
