package client

import (
	"context"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

type Config struct {
	URLS           []string
	MaxReconnects  int
	ReconnectWait  time.Duration
	Timeout        time.Duration
	MaxConnections int
}

type ConnectionPool struct {
	mu     sync.RWMutex
	conns  []*nats.Conn
	config *Config
	idx    int
}

func NewConnectionPool(cfg *Config) (*ConnectionPool, error) {
	if cfg == nil {
		cfg = &Config{
			MaxReconnects:  10,
			ReconnectWait:  5 * time.Second,
			Timeout:        30 * time.Second,
			MaxConnections: 3,
		}
	}

	pool := &ConnectionPool{
		config: cfg,
		conns:  make([]*nats.Conn, 0, cfg.MaxConnections),
	}

	for i := 0; i < cfg.MaxConnections; i++ {
		nc, err := nats.Connect(cfg.URLS[0],
			nats.MaxReconnects(cfg.MaxReconnects),
			nats.ReconnectWait(cfg.ReconnectWait),
			nats.Timeout(cfg.Timeout),
		)
		if err != nil {
			return nil, err
		}
		pool.conns = append(pool.conns, nc)
	}

	return pool, nil
}

func (p *ConnectionPool) Get() *nats.Conn {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn := p.conns[p.idx]
	p.idx = (p.idx + 1) % len(p.conns)
	return conn
}

func (p *ConnectionPool) GetWithContext(ctx context.Context) (*nats.Conn, error) {
	return p.Get(), nil
}

func (p *ConnectionPool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, conn := range p.conns {
		_ = conn.Drain()
		conn.Close()
	}
	p.conns = p.conns[:0]
	log.Info().Msg("NATS connection pool closed")
}

func (p *ConnectionPool) Subscribe(subject string, handler nats.MsgHandler) (*nats.Subscription, error) {
	conn := p.Get()
	return conn.Subscribe(subject, handler)
}

func (p *ConnectionPool) QueueSubscribe(subject, queue string, handler nats.MsgHandler) (*nats.Subscription, error) {
	conn := p.Get()
	return conn.QueueSubscribe(subject, queue, handler)
}

func (p *ConnectionPool) Publish(subject string, data []byte) error {
	conn := p.Get()
	return conn.Publish(subject, data)
}

func (p *ConnectionPool) PublishMsg(msg *nats.Msg) error {
	conn := p.Get()
	return conn.PublishMsg(msg)
}

func (p *ConnectionPool) Request(subject string, data []byte, timeout time.Duration) (*nats.Msg, error) {
	conn := p.Get()
	return conn.Request(subject, data, timeout)
}

func (p *ConnectionPool) IsConnected() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, conn := range p.conns {
		if !conn.IsConnected() {
			return false
		}
	}
	return true
}

func (p *ConnectionPool) Stats() map[string]interface{} {
	p.mu.RLock()
	defer p.mu.RUnlock()
	stats := make(map[string]interface{})
	for i, conn := range p.conns {
		if conn != nil {
			s := conn.Statistics
			stats[string(rune('0'+i))] = map[string]interface{}{
				"in_msgs":   s.InMsgs,
				"out_msgs":  s.OutMsgs,
				"in_bytes":  s.InBytes,
				"out_bytes": s.OutBytes,
			}
		}
	}
	return stats
}
