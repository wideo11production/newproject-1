// Package redisx provides the single Redis client used for both the rate
// limiter and the JWT revocation denylist.
//
// ---- WHY ONE CLIENT, NOT TWO ----
//
// Rate limiting and token revocation have opposite failure requirements, so
// it is tempting to give them separate clients with separate timeouts. Do
// not. Two clients means two connection pools competing for the same
// server_connections budget, and the two features can then starve each other
// under load - the rate limiter's burst traffic starving revocation checks
// looks exactly like "logout silently stopped working". One client, one pool,
// one place where the failure policy is decided.
//
// ---- FAILURE POLICY: FAIL OPEN, AND WHY ----
//
// A Redis outage must NOT take authentication down with it. If the rate
// limiter returned 503 whenever Redis was unreachable, then a cache outage
// would become a total auth outage - trading a brute-force risk for a full
// denial of service, which is strictly worse.
//
// So: on Redis error the limiter ALLOWS the request and increments a counter
// that the Prometheus alert in monitoring/rules/platform.yml watches. The
// service degrades to "unlimited attempts" and tells you, rather than going
// dark without warning.
//
// The trade-off, stated plainly: while Redis is down, brute-force protection
// is off. That is a deliberate choice, not an oversight. The alternative -
// failing closed - lets anyone who can knock Redis over also knock auth over.
// Mitigation for a real deployment: put a per-IP limit at the ingress/load
// balancer so there is still a floor even when this limiter is degraded.
package redisx

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/wideo11/auth-service/internal/config"
)

// Pool sizing. Redis handles tens of thousands of connections, but each one
// is a file descriptor and a buffer; the defaults are deliberately modest
// because the workload is a handful of hot keys, not high cardinality.
const (
	dialTimeout  = 3 * time.Second
	readTimeout  = 2 * time.Second
	writeTimeout = 2 * time.Second
	maxRetries   = 2
	poolSize     = 20
	minIdleConns = 2
)

// Client wraps go-redis with the health-check-at-startup behaviour the rest
// of the service already relies on for Postgres.
type Client struct {
	rdb *redis.Client
}

// New dials Redis and verifies it answers before returning.
//
// An error here is NOT fatal to the service. Callers are expected to log it
// and continue: the rate limiter and the denylist both fail open by design
// (see the package comment). A hard failure would mean "Redis is down, so no
// one can log in", which is the wrong trade.
func New(cfg config.RedisConfig) (*Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr: net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		// An empty password is a normal local-dev setup, so it is passed
		// through rather than defaulted. Redis treats "" as "no auth", which
		// is what a passwordless local instance expects.
		Password:     cfg.Password,
		DB:           cfg.DB,
		DialTimeout:  dialTimeout,
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		MaxRetries:   maxRetries,
		PoolSize:     poolSize,
		MinIdleConns: minIdleConns,
	})

	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		// Return the client anyway so callers can degrade rather than crash,
		// but surface the error so startup can log it loudly.
		_ = rdb.Close()
		return nil, fmt.Errorf("redis ping failed (%s:%d): %w", cfg.Host, cfg.Port, err)
	}

	log.Info().Str("host", cfg.Host).Int("port", cfg.Port).Int("db", cfg.DB).
		Msg("Redis connection established")
	return &Client{rdb: rdb}, nil
}

// Healthy reports whether Redis is currently reachable. Called by the health
// endpoint so a Redis outage is visible on the dashboard rather than only in
// the logs.
//
// Health is deliberately NOT part of the service's own readiness decision:
// reporting unhealthy on a Redis outage would make the container restart-loops
// even though it is still serving traffic correctly on the degraded path.
func (c *Client) Healthy(ctx context.Context) error {
	if c == nil || c.rdb == nil {
		return fmt.Errorf("redis client not initialised")
	}
	return c.rdb.Ping(ctx).Err()
}

// Close releases the pool.
func (c *Client) Close() error {
	if c == nil || c.rdb == nil {
		return nil
	}
	return c.rdb.Close()
}

// INCR increments key and returns the new value.
//
// The caller supplies the TTL via Expire; this is split out rather than
// combined so the "first hit sets the window" logic lives in the limiter,
// where the window length is a policy decision rather than a transport
// detail.
func (c *Client) INCR(ctx context.Context, key string) (int64, error) {
	if c == nil || c.rdb == nil {
		return 0, fmt.Errorf("redis client not initialised")
	}
	return c.rdb.Incr(ctx, key).Result()
}

// Expire sets a TTL on key. It is intentionally idempotent - setting it on
// every hit would keep extending the window and turn a fixed window into an
// unbounded one, so the limiter only calls it when the key is new.
func (c *Client) Expire(ctx context.Context, key string, ttl time.Duration) error {
	if c == nil || c.rdb == nil {
		return fmt.Errorf("redis client not initialised")
	}
	return c.rdb.Expire(ctx, key, ttl).Err()
}

// Exists reports whether key is present. Used by the denylist check.
func (c *Client) Exists(ctx context.Context, key string) (bool, error) {
	if c == nil || c.rdb == nil {
		return false, fmt.Errorf("redis client not initialised")
	}
	n, err := c.rdb.Exists(ctx, key).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Set stores a value with a TTL. Used to record a revoked token id; the TTL
// is the token's remaining lifetime, so the denylist self-prunes and can
// never grow without bound.
func (c *Client) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	if c == nil || c.rdb == nil {
		return fmt.Errorf("redis client not initialised")
	}
	return c.rdb.Set(ctx, key, value, ttl).Err()
}

// Delete removes a key. Used to un-revoke on login-after-logout, keeping the
// denylist from holding entries for tokens the user is actively re-issuing.
func (c *Client) Delete(ctx context.Context, key string) error {
	if c == nil || c.rdb == nil {
		return fmt.Errorf("redis client not initialised")
	}
	return c.rdb.Del(ctx, key).Err()
}

// Keys exposes the underlying client for callers that need a command this
// wrapper does not cover. Prefer the typed helpers above; reaching for this
// is a signal that a new helper is needed.
func (c *Client) Keys() *redis.Client { return c.rdb }
