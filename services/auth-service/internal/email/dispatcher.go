package email

import (
	"fmt"
	"log"
	"net/smtp"
	"strings"

	"github.com/wideo11/auth-service/internal/config"
)

// PurgeMessage exact purge notification text.
//
// Ye product spec me diya gaya EXACT wording hai, word-for-word use kiya gaya hai.
// Ye USER-FACING content hai isliye strictly plain international English hai -
// Hinglish sirf code comments me hai, user ke email me kabhi nahi.
// Hinglish: user email me English message jata hai - exactly as spec me diya hai
const PurgeMessage = "For security reasons, your unverified registration has been securely removed. You can now re-register a new account using this same email address as the prior records are completely purged from our systems."

// Transport abstraction - isse test me fake transport daala ja sakta hai
type Transport interface {
	Send(to, subject, body string) error
}

// consoleTransport email ko logger me print karta hai (no cost, local dev)
type consoleTransport struct {
	fromName string
	from     string
}

// Send email ka poora content console me print karta hai
// Hinglish: local dev me email yahan dikhta hai, koi paisa nahi lagta
func (c *consoleTransport) Send(to, subject, body string) error {
	log.Println("============================================================")
	log.Println("[EMAIL - CONSOLE TRANSPORT]")
	log.Println("------------------------------------------------------------")
	log.Printf("To:      %s", to)
	log.Printf("From:    %s <%s>", c.fromName, c.from)
	log.Printf("Subject: %s", subject)
	log.Println("------------------------------------------------------------")
	log.Println(body)
	log.Println("============================================================")
	return nil
}

// smtpTransport real SMTP server ke through email bhejta hai (production)
type smtpTransport struct {
	addr  string
	auth  smtp.Auth
	from  string
	fromName string
}

// Send SMTP ke through email bhejta hai
func (s *smtpTransport) Send(to, subject, body string) error {
	// MIME headers ke saath RFC-compliant message banata hai
	msg := fmt.Sprintf(
		"From: %s <%s>\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\n\r\n%s",
		s.fromName, s.from, to, subject, body,
	)

	return smtp.SendMail(s.addr, s.auth, s.from, []string{to}, []byte(msg))
}

// Dispatcher verification aur purge emails bhejta hai.
//
// COST DECISION: Ye koi paid provider (SendGrid / Mailgun / SES paid tier) use
// nahi karta. Do transport hain:
//  1. SMTP     - jab SMTP_HOST set ho (production)
//  2. Console  - jab SMTP_HOST khaali ho (local dev / tests)
//
// SSOT: from-address, from-name, credentials sab .env se aate hain.
// Code me koi email address ya password hardcoded NAHI hai.
// Hinglish: paid service nahi - apna SMTP ya console log, config se
type Dispatcher struct {
	cfg       *config.EmailConfig
	transport Transport
}

// NewDispatcher config ke hisaab se sahi transport chunta hai
// SMTP_HOST khaali hai to console transport (free/local), warna SMTP
func NewDispatcher(cfg *config.EmailConfig) *Dispatcher {
	d := &Dispatcher{cfg: cfg}

	// Config na ho to safe defaults (crash na ho)
	if cfg == nil {
		cfg = &config.EmailConfig{
			From:     "no-reply@wideo11.com",
			FromName: "Wideo11 Security",
			Port:     587,
		}
	}

	// From address/name config se - koi hardcoded value nahi
	from := cfg.From
	if strings.TrimSpace(from) == "" {
		from = "no-reply@wideo11.com"
	}
	fromName := cfg.FromName
	if strings.TrimSpace(fromName) == "" {
		fromName = "Wideo11 Security"
	}

	if strings.TrimSpace(cfg.Host) == "" {
		// Koi SMTP host nahi - console transport (zero cost)
		d.transport = &consoleTransport{from: from, fromName: fromName}
		return d
	}

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	var auth smtp.Auth
	if cfg.User != "" {
		auth = smtp.PlainAuth("", cfg.User, cfg.Password, cfg.Host)
	}
	d.transport = &smtpTransport{addr: addr, auth: auth, from: from, fromName: fromName}
	return d
}

// SetTransport custom transport set karta hai (tests ke liye)
func (d *Dispatcher) SetTransport(t Transport) {
	d.transport = t
}

// SendVerificationEmail verification email bhejta hai jisme clickable link hai
func (d *Dispatcher) SendVerificationEmail(to, fullName, verifyURL string, ttlMinutes int) error {
	// Ye body USER-FACING hai isliye plain English me hai (Hinglish nahi)
	body := fmt.Sprintf(`Hello %s,

Thank you for registering on Wideo11.

Please confirm your email address by opening the link below:

%s

This link expires in %d minutes. If it is not used within that time, your
registration will be permanently removed and you will be able to register
again with the same email address.

If you did not create this account, you can safely ignore this email.

Best regards,
The Wideo11 Team`, fullName, verifyURL, ttlMinutes)

	return d.transport.Send(to, "Verify your Wideo11 account", body)
}

// SendPurgeNotification unverified account purge hone par user ko batata hai
// Message exact spec wording use karta hai (plain English, no Hinglish)
func (d *Dispatcher) SendPurgeNotification(to string) error {
	return d.transport.Send(to, "Your Wideo11 registration was removed", PurgeMessage)
}
