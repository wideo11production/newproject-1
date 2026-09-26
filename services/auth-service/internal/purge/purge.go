package purge

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/config"
	"github.com/wideo11/auth-service/internal/email"
	"github.com/wideo11/auth-service/internal/repository"
)

// Worker background me chalta rehta hai aur unverified accounts ko
// 30 minute ke baad PERMANENTLY delete karta hai.
//
// DESIGN: Ye ek Go background worker hai - PostgreSQL ke pg_cron ya kisi
// paid scheduling service ki zaroorat NAHI hai. Isse infrastructure cost
// zero rehta hai aur scheduling bhi predictable rehti hai (in-process ticker).
//
// FLOW:
//  1. Har interval (default 60s) par DB se unverified users dhooldta hai
//     jinke created_at 30 minute se purana hai
//  2. Unke verification tokens delete karta hai
//  3. Unki user row HARD delete karta hai (permanent, soft-delete nahi)
//  4. Unhe notification email bhejta hai (exact spec wording)
//
// Hinglish: 30 minute purana unverified account = permanently delete + email
type Worker struct {
	cfg         *config.Config
	purgeRepo   repository.PurgeRepository
	verifRepo   repository.VerificationTokenRepository
	emailer     *email.Dispatcher
	stopCh      chan struct{}
	interval    time.Duration
	ttl         time.Duration
}

// NewWorker naya purge worker banata hai
func NewWorker(cfg *config.Config, purgeRepo repository.PurgeRepository,
	verifRepo repository.VerificationTokenRepository, emailer *email.Dispatcher) *Worker {

	// Interval aur TTL config se aati hain, hardcoded nahi (SSOT)
	interval := time.Duration(cfg.Purge.IntervalSeconds) * time.Second
	if interval <= 0 {
		interval = 60 * time.Second
	}

	// TTL 30 minute (product spec). Config se override ho sakta hai
	ttl := time.Duration(cfg.Verification.TTLMinutes) * time.Minute
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}

	return &Worker{
		cfg:       cfg,
		purgeRepo: purgeRepo,
		verifRepo: verifRepo,
		emailer:   emailer,
		stopCh:    make(chan struct{}),
		interval:  interval,
		ttl:       ttl,
	}
}

// Start worker ko background me chalata hai
// Hinglish: background me chalu kar deta hai
func (w *Worker) Start(ctx context.Context) {
	if !w.cfg.Purge.Enabled || !w.cfg.Verification.PurgeEnabled {
		log.Println("[PURGE] Worker disabled - skipping start")
		return
	}

	go w.loop(ctx)

	log.Printf("[PURGE] Worker started | interval=%v | unverified TTL=%v", w.interval, w.ttl)
}

// Stop worker ko rok deta hai
func (w *Worker) Stop() {
	close(w.stopCh)
}

// loop ticker se worker chalata rehta hai
func (w *Worker) loop(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[PURGE] Worker stopping (context cancelled)")
			return
		case <-w.stopCh:
			log.Println("[PURGE] Worker stopping (Stop called)")
			return
		case <-ticker.C:
			w.RunOnce(ctx)
		}
	}
}

// RunOnce ek purge cycle chalata hai
// Ye exported hai taaki tests manually trigger kar sakein
func (w *Worker) RunOnce(ctx context.Context) {
	// Cutoff = abhi - TTL. Isse purane created_at wale users pakde jate hain
	cutoff := time.Now().Add(-w.ttl)

	batchSize := w.cfg.Purge.BatchSize
	if batchSize <= 0 {
		batchSize = 100
	}

	users, err := w.purgeRepo.FindExpiredUnverified(ctx, cutoff, batchSize)
	if err != nil {
		log.Printf("[PURGE] Failed to find expired unverified users: %v", err)
		return
	}

	if len(users) == 0 {
		return
	}

	log.Printf("[PURGE] Found %d expired unverified account(s) older than %v - purging", len(users), w.ttl)

	for _, user := range users {
		w.purgeOne(ctx, user.ID, user.Email)
	}
}

// purgeOne ek user ko purge karta hai
// Hinglish: ek user ko delete karke email bhejte hain
func (w *Worker) purgeOne(ctx context.Context, userID uuid.UUID, emailAddr string) {
	// Step 1: Verification tokens hatao (FK integrity + "delete tokens entirely")
	if err := w.verifRepo.DeleteByUserID(ctx, userID); err != nil {
		log.Printf("[PURGE] Failed to delete verification tokens for %s: %v", emailAddr, err)
		// Return nahi karte - user delete karna zaroori hai
	}

	// Step 2: User row ko PERMANENTLY delete karo (Unscoped - soft delete nahi)
	if err := w.purgeRepo.HardDelete(ctx, userID); err != nil {
		log.Printf("[PURGE] Failed to hard delete user %s: %v", emailAddr, err)
		return
	}

	log.Printf("[PURGE] PURGED unverified user %s (all tokens deleted)", emailAddr)

	// Step 3: Notification email bhejo (exact spec wording, plain English)
	if w.emailer != nil {
		if err := w.emailer.SendPurgeNotification(emailAddr); err != nil {
			// Email fail hone par user delete revert NAHI hota - deletion authoritative hai
			// Email best-effort hai. User already delete ho chuka hai.
			log.Printf("[PURGE] User purged but notification email failed for %s: %v", emailAddr, err)
		}
	}
}
