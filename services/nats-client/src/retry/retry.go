package retry

import (
	"time"
)

type RetryPolicy struct {
	MaxRetries     int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
	Multiplier     float64
}

func DefaultPolicy() *RetryPolicy {
	return &RetryPolicy{
		MaxRetries:     5,
		InitialBackoff: 100 * time.Millisecond,
		MaxBackoff:     30 * time.Second,
		Multiplier:     2.0,
	}
}

func (p *RetryPolicy) Backoff(attempt int) time.Duration {
	if attempt <= 0 {
		return p.InitialBackoff
	}
	backoff := float64(p.InitialBackoff) * pow(p.Multiplier, float64(attempt))
	if backoff > float64(p.MaxBackoff) {
		return p.MaxBackoff
	}
	return time.Duration(backoff)
}

func pow(base, exp float64) float64 {
	if exp == 0 {
		return 1
	}
	result := 1.0
	for i := 0; i < int(exp); i++ {
		result *= base
	}
	return result
}

func (p *RetryPolicy) ShouldRetry(attempt int) bool {
	return attempt < p.MaxRetries
}
