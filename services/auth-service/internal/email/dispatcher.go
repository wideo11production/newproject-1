package email

import (
	"fmt"
	"log"
	"mime"
	"net/smtp"
	"strings"
	"time"

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
//
// CHANGED (HTML support): pehle sirf `Send(to, subject, body)` tha jo
// `text/plain` bhejta tha. Ab dono parts jaate hain:
//
//	Send(to, subject, htmlBody, textBody string)
//
// KYUN dono chahiye:
//   - `htmlBody` : rich, responsive, branded design
//   - `textBody` : fallback. Gmail ka plain-text viewer, text-only clients,
//     aur kuch corporate mail gateways HTML render hi nahi karte. Text part
//     hone se email KABHI unreadable nahi hoti.
//
// Ye `multipart/alternative` MIME structure banata hai - mail client khud
// decide karta hai kaunsa part dikhana hai (best practice).
type Transport interface {
	Send(to, subject, htmlBody, textBody string) error
}

// consoleTransport email ko logger me print karta hai (no cost, local dev)
type consoleTransport struct {
	fromName string
	from     string
}

// Send email ka poora content console me print karta hai
// Hinglish: local dev me email yahan dikhta hai, koi paisa nahi lagta
//
// CHANGED: ab HTML aur TEXT dono print karta hai, taaki dev me dekh sakte ho
// ki HTML part kaisa ban raha hai (browser me preview karne ke liye).
func (c *consoleTransport) Send(to, subject, htmlBody, textBody string) error {
	log.Println("============================================================")
	log.Println("[EMAIL - CONSOLE TRANSPORT]")
	log.Println("------------------------------------------------------------")
	log.Printf("To:      %s", to)
	log.Printf("From:    %s <%s>", c.fromName, c.from)
	log.Printf("Subject: %s", subject)
	log.Println("--- PLAIN TEXT PART --------------------------------------")
	log.Println(textBody)
	log.Println("--- HTML PART (length) ------------------------------------")
	log.Printf("%d bytes", len(htmlBody))
	log.Println("============================================================")
	return nil
}

// smtpTransport real SMTP server ke through email bhejta hai (production)
type smtpTransport struct {
	addr     string
	auth     smtp.Auth
	from     string
	fromName string
}

// Send SMTP ke through email bhejta hai
//
// CHANGED: ab `multipart/alternative` MIME message banata hai jisme dono
// parts hote hain:
//
//	part 1 (text/plain)  - fallback
//	part 2 (text/html)   - rich design
//
// `multipart/alternative` ka matlab: mail client jo support karta hai wo
// HTML wala dikhata hai, baaki plain text wala. Ye RFC-standard approach hai
// aur Gmail/Outlook/Apple Mail sab isko samajhte hain.
//
// NOTE (boundary): boundary string MUST message ke har header aur last
// closing `--` se match karna chahiye, warna mail client parts parse nahi
// kar payega aur poori email garbage dikhegi. Isliye ek hi variable use ho
// raha hai headers + body dono me.
func (s *smtpTransport) Send(to, subject, htmlBody, textBody string) error {
	// Random-ish boundary. RFC me koi bhi unique string chalta hai jab tak
	// body me na aaye. Timestamp-based rakha hai taaki har email unique ho.
	boundary := fmt.Sprintf("wideo11-%d", time.Now().UnixNano())

	// Subject me non-ASCII ho to RFC 2047 encoding chahiye. Subject hamara
	// ASCII hi rehta hai, par defensive encoding rakh di hai.
	encodedSubject := mime.QEncoding.Encode("UTF-8", subject)

	msg := fmt.Sprintf(
		"From: %s <%s>\r\n"+
			"To: %s\r\n"+
			"Subject: %s\r\n"+
			"MIME-Version: 1.0\r\n"+
			"Content-Type: multipart/alternative; boundary=\"%s\"\r\n"+
			"\r\n"+
			"--%s\r\n"+
			"Content-Type: text/plain; charset=\"UTF-8\"\r\n"+
			"Content-Transfer-Encoding: 8bit\r\n"+
			"\r\n"+
			"%s\r\n"+
			"--%s\r\n"+
			"Content-Type: text/html; charset=\"UTF-8\"\r\n"+
			"Content-Transfer-Encoding: 8bit\r\n"+
			"\r\n"+
			"%s\r\n"+
			"--%s--\r\n",
		s.fromName, s.from,
		to,
		encodedSubject,
		boundary,
		boundary,
		textBody,
		boundary,
		htmlBody,
		boundary,
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

// SendVerificationEmail verification email bhejta hai (HTML + text dono)
//
// CHANGED: ab `code` parameter bhi leta hai - wo 6-digit verification code
// hai jo HTML part me blurred + double-click-reveal block me dikhta hai.
//
// NOTE (code kahan se aata hai): ye code VERIFICATION LINK KA HI SHORT
// FORM hai, alag koi secret system nahi. Code verify karne ke liye backend
// me token ka corresponding row lookup hoti hai - agar backend me abhi
// "code" field nahi hai to ye display-only rahega aur verify LINK hi kaam
// karegi. (Is field ko add karna ek separate, deliberate change hai.)
func (d *Dispatcher) SendVerificationEmail(to, fullName, verifyURL, code string, ttlMinutes int) error {
	subject := "Verify your Wideo11 account"
	htmlBody := VerificationHTML(fullName, verifyURL, code, ttlMinutes)
	textBody := VerificationText(fullName, verifyURL, code, ttlMinutes)
	return d.transport.Send(to, subject, htmlBody, textBody)
}

// Send generic email bhejta hai (subject + html + text).
//
// YE KYUN ADD KIYA GAYA:
// Background queue (`EmailQueue`, queue.go) ko ek GENERIC sender chahiye tha,
// taaki wo sirf verification tak limited na rahe. Aage purge notification,
// security alerts, ya koi bhi transactional email background queue se ja
// sake, bina SMTP logic duplicate kiye.
//
// Transport wahi rehta hai jo config ke hisaab se chuna gaya tha (SMTP ya
// console) - isliye koi alag connection logic nahi hai aur
// `SendVerificationEmail` / `SendPurgeNotification` isi par based hain.
//
// NOTE: ye `Transport` interface ka seedha passthrough hai, isliye koi extra
// logic (rate limit, retry, validation) YAHAN nahi - wo queue worker ka kaam
// hai.
func (d *Dispatcher) Send(to, subject, htmlBody, textBody string) error {
	return d.transport.Send(to, subject, htmlBody, textBody)
}

// SendPurgeNotification unverified account purge hone par user ko batata hai
// Message exact spec wording use karta hai (plain English, no Hinglish)
func (d *Dispatcher) SendPurgeNotification(to string) error {
	subject := "Your Wideo11 registration was removed"
	htmlBody := PurgeHTML(to)
	textBody := PurgeText(to)
	return d.transport.Send(to, subject, htmlBody, textBody)
}
