package middleware

// ============================================================================
// RATE LIMIT AUDIT EVENTS -> NATS JETSTREAM
// ============================================================================
//
// WHY THIS EXISTS
//
// A blocked login attempt is the single most security-relevant event this
// service produces. Right now it exists only as a log line, which means:
//
//   - it is not queryable ("show me every rate-limit hit in the last hour
//     for this account")
//   - it is lost when the container restarts
//   - nothing correlates it with the `security_events` audit table
//
// Publishing to NATS makes it a first-class event: durable (JetStream keeps
// it), and consumable by whatever wants to react - an alerting consumer, a
// SIEM forwarder, the superadmin activity grid.
//
// ---- WHY JETSTREAM AND NOT CORE NATS ----
//
// Core NATS is fire-and-forget. If no subscriber is connected, the message is
// simply GONE. For a security audit trail that is unacceptable - you would
// lose exactly the events you cannot afford to lose, and you would not know.
//
// JetStream persists messages, so a consumer that connects later still sees
// them. That is the whole point for an audit stream: a rate-limit attack that
// happens at 3am while no consumer is up must still be there in the morning.
//
// ---- FAIL-OPEN, AND WHY ----
//
// A rate-limit block is already decided before we publish. If the publish
// fails, the user stays blocked (correct) and we only lose the event
// (acceptable). The reverse - failing the REQUEST because an audit publish
// failed - would let an attacker who can knock NATS over also disable
// rate limiting, which is a strictly worse outcome.
//
// This is also why publishing is done inline and synchronously rather than in
// a goroutine: a goroutine would silently drop events on shutdown, and the
// whole value here is that events are not droppable.

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// RateLimitEvent is the wire format published to NATS.
//
// Field names are snake_case to match the rest of the event schema in this
// service (security_events table). Identity is already truncated by the
// caller, so no raw email is ever published - see truncateIdentity.
type RateLimitEvent struct {
	EventType     string    `json:"event_type"`
	LimitName     string    `json:"limit_name"`
	IP            string    `json:"ip"`
	Identity      string    `json:"identity"`
	Path          string    `json:"path"`
	Method        string    `json:"method"`
	MaxRequests   int       `json:"max_requests"`
	WindowSeconds int       `json:"window_seconds"`
	UserAgent     string    `json:"user_agent,omitempty"`
	UserID        string    `json:"user_id,omitempty"`
	OccurredAt    time.Time `json:"occurred_at"`
}

// streamName is the JetStream stream for security-relevant events. It is
// defined in internal/natsx, which also creates the stream; this constant
// exists only for documentation, because the authoritative subject prefix
// lives with the stream definition.
const streamName = "WIDEO11_SECURITY"

// RateLimitAuditSink publishes events. Nil-safe: a nil sink drops events
// rather than panicking, so startup order never matters.
type RateLimitAuditSink interface {
	PublishRateLimited(ctx RateLimitEvent)
}

// jetStreamSink is the real implementation, backed by nats.go with JetStream.
type jetStreamSink struct {
	js     JetStreamPublisher
	stream string
}

// JetStreamPublisher is the narrow slice of the JetStream API we use. Kept as
// an interface so tests can substitute a fake without a running NATS.
type JetStreamPublisher interface {
	Publish(ctx context.Context, subject string, data []byte) error
}

func NewRateLimitAuditSink(js JetStreamPublisher) *jetStreamSink {
	return &jetStreamSink{js: js, stream: streamName}
}

// subjectFor maps a limit name to a NATS subject.
//
// ---- THIS MUST MATCH THE STREAM'S SUBJECT FILTER ----
//
// The stream `WIDEO11_SECURITY` is created with subjects
// `auth-service.security.>` (see natsx.DefaultStreams). A publish to any
// subject OUTSIDE that filter gets:
//
//	nats: no response from stream
//
// because JetStream has no stream that would accept it. That is exactly what
// happened while the two used different prefixes (`WIDEO11_SECURITY.*` here,
// `auth-service.security.*` there) - the audit stream existed, reported
// healthy, and silently accepted nothing.
//
// SUBJECT NAMING (matches natsx):
//
//	auth-service.security.rate_limit.login
//	auth-service.security.rate_limit.register
//	auth-service.security.rate_limit.verify
//	auth-service.security.rate_limit.password_reset
//	auth-service.security.rate_limit.other.<name>
//
// Subjects are also chosen from a fixed set rather than interpolating the
// limit name raw, so a crafted policy name cannot inject subject wildcards
// (`*`, `>`) and reach into other streams.
func subjectFor(limitName string) string {
	const base = "auth-service.security.rate_limit."

	switch limitName {
	case "login", "login_sustained", "login_account", "login_ip":
		return base + "login"
	case "register", "verify", "password_reset":
		return base + limitName
	default:
		return base + "other." + limitName
	}
}

func (s *jetStreamSink) PublishRateLimited(ev RateLimitEvent) {
	if s == nil || s.js == nil {
		return
	}

	payload, err := json.Marshal(ev)
	if err != nil {
		log.Warn().Err(err).Msg("rate limit audit: marshal failed")
		return
	}

	// 2s timeout: an audit publish must not sit in the request path. If NATS
	// is slow we log and move on - the request is already blocked correctly.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := s.js.Publish(ctx, subjectFor(ev.LimitName), payload); err != nil {
		log.Warn().Err(err).Str("limit", ev.LimitName).Str("ip", ev.IP).
			Msg("rate limit audit: publish to NATS failed (request stays blocked)")
	}
}

// AuditRateLimited builds and publishes the event. Safe to call with a nil
// sink (no-op).
func AuditRateLimited(c *gin.Context, p Policy, identity, clientIP string) {
	sink := rateLimitSinkFromContext(c)
	if sink == nil {
		return
	}

	ev := RateLimitEvent{
		EventType:     "rate_limit_exceeded",
		LimitName:     p.Name,
		IP:            clientIP,
		Identity:      truncateIdentity(identity),
		Path:          c.Request.URL.Path,
		Method:        c.Request.Method,
		MaxRequests:   p.Max,
		WindowSeconds: int(p.Window.Seconds()),
		OccurredAt:    time.Now().UTC(),
	}

	// UserAgent: attacker-controlled, so truncated. Unbounded UA is a known
	// log-injection vector (newlines in headers can forge log lines).
	if ua := c.GetHeader("User-Agent"); ua != "" {
		if len(ua) > 200 {
			ua = ua[:200]
		}
		ev.UserAgent = sanitizeLogString(ua)
	}

	// UserID only present if the request was authenticated. Useful for
	// correlating a block with a specific account after the fact.
	if uid, ok := c.Get("user_id"); ok {
		if s, ok := uid.(string); ok {
			ev.UserID = s
		}
	}

	sink.PublishRateLimited(ev)
}

// WithRateLimitAudit attaches a sink to the request context. Call once,
// globally, before any rate-limited route.
func WithRateLimitAudit(sink RateLimitAuditSink) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(rateLimitSinkKey, sink)
		c.Next()
	}
}

const rateLimitSinkKey = "__rate_limit_sink"

func rateLimitSinkFromContext(c *gin.Context) RateLimitAuditSink {
	if v, ok := c.Get(rateLimitSinkKey); ok {
		if s, ok := v.(RateLimitAuditSink); ok {
			return s
		}
	}
	return nil
}

// sanitizeLogString strips characters that could forge a log line.
//
// Newline injection: an attacker sending a User-Agent containing "\n" could
// otherwise make a fake entry appear in the audit log. Removing control
// characters is the standard mitigation.
func sanitizeLogString(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == '\n' || r == '\r' || r == '\t' || r < 0x20 {
			out = append(out, ' ')
			continue
		}
		out = append(out, r)
	}
	return string(out)
}
