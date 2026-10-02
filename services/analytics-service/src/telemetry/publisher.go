// The realtime firehose: every UI click also goes onto NATS JetStream.
//
// =============================================================================
// WHY BOTH A DATABASE AND A STREAM
// =============================================================================
//
// They answer different questions, and neither can answer the other's:
//
//   the ledger (Postgres, 90 days)  ->  "what happened, and what does it add up to"
//   the stream (JetStream, 7 days)  ->  "what is happening RIGHT NOW"
//
// A database poll cannot answer the second. A stream cannot answer the first, and
// a stream kept for 90 days would be a very large, very expensive way to store
// data that belongs in a relational table with indexes on it.
//
// The lifetimes differ on purpose. Same number for both would mean either an
// expensive stream or a record you cannot trust. See SYSTEM-PLAN.md section 3.2.
//
// =============================================================================
// WHY THIS IS BUILT TO DROP, NOT TO BLOCK
// =============================================================================
//
// Every design choice below follows from one rule:
//
//     A user's click must never be delayed, blocked or failed by telemetry.
//
// So:
//
//   - Publishing happens AFTER the database write, never before. If NATS is down,
//     the click is still recorded. The reverse order would mean a NATS outage
//     silently discards real interactions.
//   - The queue is BOUNDED and full means DROP, not block. Backpressuring here
//     would push NATS's latency into the browser's click path - the most direct
//     way to turn a monitoring problem into a product problem.
//   - Drops are COUNTED. A publisher that silently discards is worse than no
//     publisher, because it looks healthy. `TelemetryPublishDropped` exists so
//     that "we are dropping telemetry" is an alert, not a discovery.
//   - Reconnection BACKOFFS. A dead NATS should not produce a reconnect storm
//     from every service on the network, every few seconds, forever.

package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Stream definition. Mirrors what the config file *would* have said; see
// `docker/nats/nats.conf` for why it lives here instead.
const (
	StreamName    = "TELEMETRY"
	SubjectPrefix = "ui.click."

	// 7 days. A reaction channel, not the record.
	streamMaxAge   = 7 * 24 * time.Hour
	streamMaxBytes = 256 * 1024 * 1024
	streamMaxMsgs  = 5_000_000
)

// ---- metrics ----
//
// `surface` is sanitised before it reaches here, so this label stays bounded to
// the eight known values plus `unknown`. Same rule as the ingest counters, and
// for the same reason: an unbounded label takes out Prometheus, not just this
// metric.
var (
	Published = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "wideo11_telemetry_published_total",
			Help: "Click events published to NATS JetStream.",
		},
		[]string{"surface"},
	)

	Dropped = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "wideo11_telemetry_publish_dropped_total",
			Help: "Click events DROPPED because the publish queue was full. Non-zero means telemetry is lossy and the database is the only complete record.",
		},
		[]string{"surface"},
	)

	PublishFailures = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "wideo11_telemetry_publish_errors_total",
			Help: "Errors talking to NATS.",
		},
	)

	Connected = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "wideo11_telemetry_nats_connected",
			Help: "1 when the NATS connection is up, 0 otherwise. Alerts fire on this being 0 for long enough to matter.",
		},
	)
)

// ClickEvent is what goes on the wire.
//
// Deliberately NOT the whole ledger row. A message is a notification, and
// carrying twenty columns of PII through a broker to save a consumer a database
// query would be a bad trade - consumers need to react, not to re-read the row.
// A consumer that wants the detail follows `id` to the database.
type ClickEvent struct {
	ID         string    `json:"id"`
	Surface    string    `json:"surface"`
	Page       string    `json:"page"`
	Target     string    `json:"target"`
	OccurredAt time.Time `json:"occurred_at"`
}

// Publisher owns the NATS connection and the bounded queue.
type Publisher struct {
	url     string
	queue   chan ClickEvent
	nc      *nats.Conn
	js      nats.JetStreamContext
	mu      sync.RWMutex
	stopped chan struct{}
	once    sync.Once
}

// New builds a publisher. It does NOT connect - connection is attempted in
// `Start`, so a NATS outage delays nothing at construction time and `main` can
// start serving regardless.
func New(url string, queueSize int) *Publisher {
	if queueSize <= 0 {
		// 4096 batches-worth of headroom. Sized for the post-deploy flush burst:
		// every app is holding queued clicks and releases them at once.
		queueSize = 4096
	}
	return &Publisher{
		url:     url,
		queue:   make(chan ClickEvent, queueSize),
		stopped: make(chan struct{}),
	}
}

// Start connects, ensures the stream, and begins draining the queue.
//
// Every step is non-fatal. A service that cannot reach NATS still serves
// requests and still records clicks; it just does not publish them.
//
// The drain loop is started here, once, rather than per connection attempt: it
// must run even while NATS is DOWN, because a disconnected publisher still needs
// to accept events and count them as DROPPED. If it only ran while connected,
// the queue would silently grow during an outage and then burst on reconnect -
// turning a NATS problem into a latency spike for every user at the worst
// moment.
func (p *Publisher) Start(ctx context.Context) {
	go p.drain()
	go p.run(ctx)
}

func (p *Publisher) run(ctx context.Context) {
	// Reconnect loop with backoff. The first attempt is immediate; after a
	// failure the delay doubles up to a minute, so a long NATS outage does not
	// become a reconnect storm from every service on the network.
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-p.stopped:
			return
		default:
		}

		err := p.connectOnce(ctx)
		if err == nil {
			backoff = time.Second // a success resets the delay
			// Connection ended. Wait for the drain loop to notice, then retry.
			select {
			case <-ctx.Done():
				return
			case <-p.stopped:
				return
			case <-time.After(time.Second):
			}
			continue
		}

		log.Printf("[TELEMETRY] NATS unavailable (%v) - clicks are still recorded, just not published. Retrying in %s", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-p.stopped:
			return
		case <-time.After(backoff):
		}
		if backoff < time.Minute {
			backoff *= 2
		}
	}
}

func (p *Publisher) connectOnce(ctx context.Context) error {
	nc, err := nats.Connect(p.url,
		nats.Timeout(3*time.Second),
		nats.ReconnectWait(2*time.Second),
		nats.MaxReconnects(-1),
	)
	if err != nil {
		return err
	}

	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return fmt.Errorf("jetstream context: %w", err)
	}

	if err := p.ensureStream(js); err != nil {
		nc.Close()
		return fmt.Errorf("ensure stream: %w", err)
	}

	p.mu.Lock()
	p.nc, p.js = nc, js
	p.mu.Unlock()

	Connected.Set(1)
	log.Printf("[TELEMETRY] connected to NATS at %s (stream %s ensured)", p.url, StreamName)

	nc.SetDisconnectHandler(func(*nats.Conn) {
		Connected.Set(0)
		log.Println("[TELEMETRY] NATS disconnected - clicks still recorded, not published")
	})
	nc.SetReconnectHandler(func(*nats.Conn) {
		Connected.Set(1)
		log.Println("[TELEMETRY] NATS reconnected")
	})

	// Block until the connection closes, so this function owns the lifetime.
	<-ctx.Done()
	nc.Close()
	Connected.Set(0)
	return nil
}

// ensureStream creates the stream if it is absent.
//
// Idempotent by read-then-create. JetStream has no single "create if absent"
// call, and its own definition store means a stream created here survives
// restarts exactly like one declared in the config file.
func (p *Publisher) ensureStream(js nats.JetStreamContext) error {
	if _, err := js.StreamInfo(StreamName); err == nil {
		return nil // already there
	} else if !strings.Contains(strings.ToLower(err.Error()), "not found") {
		return err
	}

	_, err := js.AddStream(&nats.StreamConfig{
		Name:     StreamName,
		Subjects: []string{SubjectPrefix + ">"},
		Storage:  nats.FileStorage,
		MaxAge:   streamMaxAge,
		MaxBytes: streamMaxBytes,
		MaxMsgs:  streamMaxMsgs,

		// ONE replica: single-node dev stack. Three replicas of a stream on one
		// node is three copies of the same file, so the redundancy is imaginary.
		// This is the number that changes first when this moves to a real cluster.
		//
		// The field is `Replicas` in nats.go, serialised as `num_replicas`.
		Replicas: 1,

		// Drop the NEWEST at the limit rather than evicting the oldest. The
		// default is right for a log; for a reaction feed it is backwards - the
		// oldest message is the least interesting one by definition.
		Discard: nats.DiscardNew,
	})
	return err
}

// Publish enqueues an event. It NEVER blocks and never returns an error.
//
// The signature is a deliberate lie about the failure case: there is no error to
// return because there is nothing the caller could do with one. The caller is a
// click handler, and the correct answer to "could not publish telemetry" is to
// carry on. Dropping is counted in `Dropped`.
func (p *Publisher) Publish(ev ClickEvent) {
	select {
	case <-p.stopped:
		return
	default:
	}

	select {
	case p.queue <- ev:
	default:
		// FULL. This is the whole point of the bounded queue: a NATS outage
		// must not become a latency spike on the user's click.
		Dropped.WithLabelValues(ev.Surface).Inc()
	}
}

// drain forwards queued events to NATS until the publisher is stopped.
//
// This is the only place that talks to the network, so the queue's ordering is
// preserved and a slow NATS can never touch the request path.
func (p *Publisher) drain() {
	for {
		select {
		case ev := <-p.queue:
			p.publishOne(ev)
		case <-p.stopped:
			// Flush what is left so a graceful shutdown does not throw away
			// events that were already accepted from the caller.
			for {
				select {
				case ev := <-p.queue:
					p.publishOne(ev)
				default:
					return
				}
			}
		}
	}
}

func (p *Publisher) publishOne(ev ClickEvent) {
	p.mu.RLock()
	js, nc := p.js, p.nc
	p.mu.RUnlock()

	if js == nil || nc == nil || !nc.IsConnected() {
		Dropped.WithLabelValues(ev.Surface).Inc()
		return
	}

	subject := SubjectPrefix + ev.Surface
	if ev.Surface == "" {
		subject = SubjectPrefix + "unknown"
	}

	// `Msg-Id` is the event id, so a redelivery of the same event is
	// de-duplicated by JetStream's window rather than double-counted by a
	// consumer.
	//
	// `js.Publish` takes raw bytes, so the struct is marshalled here rather than
	// passed as-is - a click payload is a few hundred bytes, far below NATS's
	// max payload, so no size guard is needed.
	body, err := json.Marshal(ev)
	if err != nil {
		PublishFailures.Inc()
		return
	}

	if _, err := js.Publish(subject, body, nats.MsgId(ev.ID)); err != nil {
		PublishFailures.Inc()
		Dropped.WithLabelValues(ev.Surface).Inc()
		return
	}
	Published.WithLabelValues(ev.Surface).Inc()
}

// Stop shuts the publisher down and flushes what it can.
func (p *Publisher) Stop() {
	p.once.Do(func() { close(p.stopped) })
}
