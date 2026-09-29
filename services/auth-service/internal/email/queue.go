package email

// ============================================================================
// BACKGROUND EMAIL QUEUE
// ============================================================================
//
// PROBLEM YE SOLVE KARTA HAI:
// Verification email BILKUL SYNCHRONOUS bhejta tha request ke andar, yaani
// HTTP handler ke andar. Gmail ka SMTP handshake + TLS + send ~5 seconds
// leta hai, isliye:
//     POST /api/auth/register -> ~5000ms  (user ka button disabled rehta hai)
//     POST /api/auth/resend   -> ~4700ms
// User ko 5 second "kuch nahi ho raha" lagta hai.
//
// SOLUTION: email ko request se DETACH karo. Request turant return hoti hai,
// aur ek background worker email bhejta hai.
//
// ---- GUARANTEES (soch kar rakhi hain) ----
//
//  1. REQUEST CONTEXT NAHI USE HOTA
//     `http.Request.Context()` request khatam hone par CANCEL ho jata hai.
//     Agar wo background worker me use hota, to SMTP send beech me fail
//     ho jata. Isliye har job apna zyada-detailed send karta hai, aur
//     worker goroutine REQ se completely independent hai.
//
//  2. ERROR LOG HOTA HAI
//     Fire-and-forget me error kahin nahi jaata. Isliye har failure log +
//     ek retry. Permanent failure par bhi log - token ban chuka hai aur user
//     ke paas RESEND endpoint hai (30 min window), to recoverable hai.
//
//  3. QUEUE FULL PAR BLOCK NAHI HOTA
//     Buffered channel + `select/default` se turant drop. Worker backlog
//     pe block nahi hota. (Request path slow hona worse hai.)
//
//  4. SHUTDOWN PAR QUEUE DRAIN
//     `Close()` queue khatam hone tak wait karta hai, taaki restart par
//     emails drop na hon.
//
// ---- NAMING NOTE ----
// Ye file jaan-boojh kar alag rakhi hai (`queue.go`), kyunke `dispatcher.go`
// me already ek `Dispatcher` type hai (wo SMTP-vs-console choose karta hai).
// Pehle maine galti se wahi file overwrite kar di thi - git se restore kiya.
// Ab dono saath-saath rehte hain bina koi naam takraav.
//
// Hinglish comments: har block ka arth

import (
	"log"
	"sync"
	"time"
)

// queueSender - ek email bhejne ka function.
//
// DI (dependency injection) isliye: ye dispatcher ko transport ki
// implementation ke baare me nahi jaanne deta. Test me stub daal sakte
// hain, aur console transport bhi reuse ho sakta hai.
type queueSender interface {
	Send(to, subject, htmlBody, textBody string) error
}

// emailJob - ek bhejne ka kaam
type emailJob struct {
	to       string
	subject  string
	htmlBody string
	textBody string
	retries  int // total attempts (1 = no retry)
}

// EmailQueue background email worker.
type EmailQueue struct {
	sender queueSender
	jobs   chan emailJob
	stop   chan struct{}
	done   chan struct{}

	mu      sync.Mutex
	started bool
}

// NewEmailQueue banata hai (worker shuru nahi hota - Start() call karo)
func NewEmailQueue(sender queueSender, bufferSize int) *EmailQueue {
	if bufferSize <= 0 {
		bufferSize = 256
	}
	return &EmailQueue{
		sender: sender,
		jobs:   make(chan emailJob, bufferSize),
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
}

// Start background worker launch karta hai. Idempotent hai.
func (q *EmailQueue) Start() {
	q.mu.Lock()
	if q.started {
		q.mu.Unlock()
		return
	}
	q.started = true
	q.mu.Unlock()

	go func() {
		defer close(q.done)
		for {
			select {
			case job := <-q.jobs:
				q.deliver(job)
			case <-q.stop:
				q.drain()
				return
			}
		}
	}()
	log.Printf("[EMAIL] Background queue started (buffer=%d)", cap(q.jobs))
}

// drain queue ke bache jobs bhejta hai (bounded, taaki shutdown na atke)
func (q *EmailQueue) drain() {
	deadline := time.After(10 * time.Second)
	for {
		select {
		case job := <-q.jobs:
			q.deliver(job)
		case <-deadline:
			log.Printf("[EMAIL] Shutdown: %d job(s) dropped", len(q.jobs))
			return
		}
	}
}

// deliver ek job bhejta hai, retry ke saath
func (q *EmailQueue) deliver(job emailJob) {
	attempts := job.retries
	if attempts < 1 {
		attempts = 1
	}

	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		err := q.sender.Send(job.to, job.subject, job.htmlBody, job.textBody)
		if err == nil {
			log.Printf("[EMAIL] Sent to=%s subject=%q", job.to, job.subject)
			return
		}
		lastErr = err
		if attempt < attempts {
			// Chhota backoff before retry (transient SMTP hiccup cover hota hai)
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
	}

	// ---- PERMANENT FAILURE ----
	// Token ban chuka hai, user ke paas RESEND hai (30 min), to recoverable.
	// Sirf LOG - request fail nahi karni, kyunki account valid hai.
	log.Printf("[EMAIL] FAILED to=%s subject=%q after %d attempt(s): %v",
		job.to, job.subject, attempts, lastErr)
}

// Enqueue background me bhejne ke liye daalta hai.
//
// KABHI block nahi karta: queue bhari ho to `default` branch chalti hai.
func (q *EmailQueue) Enqueue(job emailJob) bool {
	q.mu.Lock()
	started := q.started
	q.mu.Unlock()
	if !started {
		log.Printf("[EMAIL] Queue not started - dropping email to=%s", job.to)
		return false
	}
	select {
	case q.jobs <- job:
		return true
	default:
		log.Printf("[EMAIL] Queue full (%d) - dropping email to=%s", cap(q.jobs), job.to)
		return false
	}
}

// Close worker ko gracefully stop karta hai (queue drain karke)
func (q *EmailQueue) Close() {
	q.mu.Lock()
	if !q.started {
		q.mu.Unlock()
		return
	}
	q.started = false
	q.mu.Unlock()

	close(q.stop)
	<-q.done
	log.Println("[EMAIL] Background queue stopped")
}

// QueueVerificationEmail verification email background queue me daalta hai.
//
// Ye method service layer ke `verificationEmailQueuer` optional interface ko
// satisfy karta hai. Service type-assertion se ye detect karta hai aur email
// DETACH kar deta hai - jisse registration ka ~5s wait GAAV ho jata hai.
//
// FALLBACK: agar queue nahi shuru hui ya bhar gayi hai to `false` return
// hota hai, aur service SYNCHRONOUS path par gir jata hai (email drop nahi
// hota, bas slow ho jata hai - jo slow hone se behtar hai).
func (q *EmailQueue) QueueVerificationEmail(
	to, fullName, verifyURL, code string, ttlMinutes int,
) bool {
	return q.Enqueue(emailJob{
		to:       to,
		subject:  "Verify your Wideo11 account",
		htmlBody: VerificationHTML(fullName, verifyURL, code, ttlMinutes),
		textBody: VerificationText(fullName, verifyURL, code, ttlMinutes),
		retries:  2, // ek retry - transient SMTP hiccup cover ho jaye
	})
}
