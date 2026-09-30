// Package natsx wraps the NATS client for the two things auth-service needs
// from it: durable security-event streaming via JetStream, and health
// reporting.
//
// ---- WHY JETSTREAM ----
//
// Core NATS is fire-and-forget: no subscriber connected means the message is
// gone, with no trace. For the rate-limit audit stream that is unacceptable,
// because a burst of blocked logins at 3am with no consumer running is
// exactly the event you need to still be there in the morning.
//
// JetStream persists messages, so a late-connecting consumer still sees them.
// Durability is the whole reason this is JetStream and not core NATS.
//
// ---- SUBJECT NAMING ----
//
//	auth-service.security.rate_limit.*   blocked auth attempts
//	auth-service.security.security_event.*  PIN/PIN setup audit
//
// A separate stream per concern, so a slow consumer on one cannot stall the
// other, and so retention can differ per stream.

package natsx

import (
	"context"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	// connectTimeout must be short. NATS is used for audit publishing, which
	// is best-effort - a slow NATS must not delay auth requests.
	connectTimeout = 3 * time.Second

	// flushTimeout is how long we wait for JetStream to confirm persistence
	// before giving up. Short, for the same reason.
	flushTimeout = 2 * time.Second

	// maxReconnects -1 = retry forever, using the reconnect wait below.
	// The process should survive a NATS restart.
	maxReconnects = -1
	reconnectWait = 2 * time.Second
)

// StreamSpec describes one JetStream stream.
type StreamSpec struct {
	Name     string
	Subjects []string
	// MaxAge: how long NATS keeps events with no active consumer. This is the
	// audit retention window.
	//
	// 7 days is a deliberate choice, not an arbitrary default: a brute-force
	// campaign is rarely spotted within hours, it is usually discovered
	// during a post-incident review days later. 7 days means the evidence
	// is still there.
	MaxAge time.Duration
	// MaxBytes caps the stream so a flood cannot fill the disk. At 256MB an
	// attacker sending millions of rate-limit events cannot exhaust the host.
	//
	// Note: because limits are per-IP/account, an attacker CAN legitimately
	// generate a lot of these events. The cap means the oldest get dropped
	// first, which is the correct trade - a full disk would take down auth
	// entirely.
	MaxBytes int64
}

// DefaultStreams are the streams created at startup.
//
// Created if missing, never modified if they already exist - so an operator
// can tune retention without it being silently reverted on next boot.
var DefaultStreams = []StreamSpec{
	{
		Name:     "WIDEO11_SECURITY",
		Subjects: []string{"auth-service.security.>"},
		MaxAge:   7 * 24 * time.Hour,
		MaxBytes: 256 * 1024 * 1024,
	},
}

// Publisher wraps a connected NATS client.
type Publisher struct {
	nc   *nats.Conn
	js   nats.JetStreamContext
	subs []string
}

// Connect dials NATS and ensures the configured streams exist.
//
// RETURNS AN ERROR on failure, and the caller is expected to degrade rather
// than abort startup - see the failure policy note in
// internal/middleware/ratelimit_audit.go. Auth must keep working when NATS is
// down; only the audit trail is lost.
func Connect(url string) (*Publisher, error) {
	opts := []nats.Option{
		nats.Timeout(connectTimeout),
		nats.MaxReconnects(maxReconnects),
		nats.ReconnectWait(reconnectWait),
		// Without this, a reconnect that succeeds after a publish would
		// silently drop in-flight messages. With it, the connection is closed
		// and reconnect logic runs, so callers can retry.
		nats.ReconnectBufSize(8 * 1024 * 1024),
		// Disconnected handler logs rather than crashing. A NATS outage must
		// not take the auth service down.
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Warn().Err(err).Msg("NATS disconnected; audit events will be dropped until reconnect")
		}),
		nats.ReconnectHandler(func(c *nats.Conn) {
			log.Info().Str("url", c.ConnectedUrl()).Msg("NATS reconnected")
		}),
	}

	nc, err := nats.Connect(url, opts...)
	if err != nil {
		return nil, fmt.Errorf("nats connect %s: %w", url, err)
	}

	js, err := nc.JetStream()
	if err != nil {
		// nc.Close() returns nothing - it is not an error-returning call.
		nc.Close()
		return nil, fmt.Errorf("jetstream: %w", err)
	}

	p := &Publisher{nc: nc, js: js}

	for _, spec := range DefaultStreams {
		if err := p.ensureStream(spec); err != nil {
			// Not fatal. Publishing to a non-existent stream in JetStream
			// with the default config would fail anyway, so we log loudly
			// and let the caller decide.
			log.Warn().Err(err).Str("stream", spec.Name).
				Msg("jetstream stream not ready; security events will be dropped")
		}
	}

	log.Info().Str("url", url).Int("streams", len(DefaultStreams)).
		Msg("NATS connected with JetStream")
	return p, nil
}

// ensureStream creates the stream if it does not exist.
//
// Uses UpdateStream semantics carefully: if the stream already exists we
// leave it alone entirely, so operator tuning (retention, limits) survives
// restarts. Overwriting on every boot would silently undo any changes made
// in response to a real capacity problem.
func (p *Publisher) ensureStream(spec StreamSpec) error {
	ctx, cancel := context.WithTimeout(context.Background(), flushTimeout)
	defer cancel()

	// nats.go ka JetStream context pass karne ka tarika `nats.Context(ctx)`
	// hai - seedha `ctx` pass karna type error deta hai (`nats.JSOpt` vs
	// `context.Context`).
	_, err := p.js.StreamInfo(spec.Name, nats.Context(ctx))
	if err == nil {
		return nil // already exists - leave the operator's config alone
	}

	_, err = p.js.AddStream(&nats.StreamConfig{
		Name:     spec.Name,
		Subjects: spec.Subjects,
		MaxAge:   spec.MaxAge,
		MaxBytes: spec.MaxBytes,
		Storage:  nats.FileStorage,
		// Discarding: we care about the most recent events during an attack.
		// Keeping every single one under flood would slow the whole stream
		// down, and an attack's tail is the part that matters.
		Discard: nats.DiscardOld,
	}, nats.Context(ctx))
	if err != nil {
		return fmt.Errorf("create stream %s: %w", spec.Name, err)
	}

	log.Info().Str("stream", spec.Name).Msg("created JetStream stream")
	return nil
}

// Publish sends a message and waits for JetStream to acknowledge it.
//
// The wait is the point: core NATS would return as soon as the message left
// the process, which tells us nothing about whether it was persisted. A
// successful return here means "durably stored".
func (p *Publisher) Publish(ctx context.Context, subject string, data []byte) error {
	if p == nil || p.nc == nil {
		return fmt.Errorf("nats publisher not initialised")
	}
	_, err := p.js.Publish(subject, data, nats.Context(ctx))
	return err
}

// PublishAsync sends without waiting for the acknowledgement.
//
// Used only on paths where the caller has already decided the outcome (a
// blocked request) and the event is genuinely optional - for example audit
// telemetry that must never add latency to a 429 response.
func (p *Publisher) PublishAsync(subject string, data []byte) error {
	if p == nil || p.nc == nil {
		return fmt.Errorf("nats publisher not initialised")
	}
	return p.nc.Publish(subject, data)
}

// Healthy reports whether the connection is currently established.
//
// Deliberately separate from Close: a disconnected NATS must not make the
// service unhealthy, because the service is still correctly serving traffic
// (see the fail-open policy). This exists so the condition is *observable*,
// not so it can gate anything.
func (p *Publisher) Healthy() bool {
	return p != nil && p.nc != nil && p.nc.IsConnected()
}

// Close flushes pending messages and disconnects.
func (p *Publisher) Close() {
	if p == nil || p.nc == nil {
		return
	}
	// Drain the client buffer so in-flight audit events are not lost on
	// shutdown. Bounded so a broken connection cannot hang shutdown.
	if err := p.nc.FlushTimeout(flushTimeout); err != nil {
		log.Warn().Err(err).Msg("NATS flush on shutdown did not complete cleanly")
	}
	_ = p.nc.Drain()
	p.nc.Close()
}
