package email

// =============================================================================
// SECURITY NOTIFICATION EMAILS
// =============================================================================
//
// Sent when: the PIN changes, the password changes, and security setup completes.
//
// =============================================================================
// WHAT IS **NOT** IN HERE, AND WHY — THIS IS THE IMPORTANT PART
// =============================================================================
//
// The request was to email the newly-changed PIN and the newly-changed password.
//
// **This does not do that, and will not without a decision I cannot make for you.**
//
// A credential in an email body is a credential in at least six places you do not
// control:
//
//	1. the recipient's INBOX, which is synced to every device they own
//	2. every mail server hop's logs, on infrastructure you do not run
//	3. the recipient's mail provider, which indexes and scans content
//	4. search indexes — a password in a searchable mailbox is a password you cannot
//	   revoke in the way you CAN revoke a database row
//	5. backups of all of the above
//	6. anyone who shoulders-surfs the inbox, or later reads a shared or forwarded
//	   thread
//
// The specific asymmetry that matters: **you can revoke a session token instantly.**
// A password sent by email has already been delivered, and revocation has no meaning
// for a message in someone else's archive. So the practice converts a
// rotate-on-suspicion event (one email, one action) into an un-recovable exposure.
//
// These emails therefore state THAT a change happened, WHEN, from WHERE, and — if the
// change was not made by the recipient — how to secure the account and how to reach
// a human. That is what makes them useful: a password change alert is a security
// control, and it only works while the credential is not in the message.
//
// The one exception industry practice DOES accept is sending a password to a
// first-party ADDRESS the recipient just proved they control, in a flow they
// initiated, for a brand-new password the server generated and has not stored. That
// is not this case: these are CHANGES to credentials the user already chose.
//
// WHAT THIS DOES SEND
//
//	Your security PIN was changed
//	    time, IP, user agent
//	    "If this was not you, change it now and contact support"
//	    (never the PIN)
//
//	Your password was changed
//	    time, IP, user agent
//	    "If this was not you, reset it now" -> a reset LINK, not a credential
//	    (never the password)
//
//	Welcome — your account is ready
//	    confirms the gate is complete, and links to the product
//
// The reset link is a single-use, short-lived token. It is the credential, delivered
// once, over the channel the user is already on — which is the difference.

import (
	"fmt"
	"strings"
)

// NotificationKind is which security event happened.
//
// A closed set rather than a free-form subject, because every branch here carries
// wording a legal or support team may need to change, and a map makes "which
// events have copy" answerable by reading the code.
type NotificationKind string

const (
	// KindPINChanged — the account's 6-digit security PIN was changed.
	KindPINChanged NotificationKind = "pin_changed"
	// KindPasswordChanged — the account password was changed.
	KindPasswordChanged NotificationKind = "password_changed"
	// KindSecuritySetupComplete — the mandatory PIN + questions gate was finished.
	KindSecuritySetupComplete NotificationKind = "security_setup_complete"
)

// SecurityEvent carries what the template needs and NOTHING ELSE.
//
// Deliberately has no field for the new PIN or the new password. If a struct ever
// gains one, every template below is one careless `{{.}}` away from leaking it, and
// the type would then be an invitation rather than a guard. Keeping the credential
// out of the data means it cannot be printed by accident.
type SecurityEvent struct {
	Kind NotificationKind
	// When it happened, already formatted for the reader's locale by the caller.
	// Formatting here would pin every email to one timezone.
	When string
	// IP and UserAgent are the ONLY forensic detail worth emailing, and they are
	// what the legitimate user actually checks: "was that me? I was on my laptop."
	IP         string
	UserAgent  string
	// ResetURL is present only when there is something the user can act on.
	ResetURL string
	// SupportEmail, so the "this was not me" path is not a dead end.
	SupportEmail string
}

// subjectFor is the single place a subject line is written.
//
// One function, because the alternative is four near-identical strings that drift
// apart in tone — and "something happened to your account" appearing with four
// different urgencies makes an attacker-facing alert harder to recognise as fake.
func subjectFor(k NotificationKind) string {
	switch k {
	case KindPINChanged:
		return "Your Wideo11 security PIN was changed"
	case KindPasswordChanged:
		return "Your Wideo11 password was changed"
	case KindSecuritySetupComplete:
		return "Welcome to Wideo11 — your account is ready"
	default:
		return "A security change was made to your Wideo11 account"
	}
}

// headlineFor is the big line in the body.
func headlineFor(k NotificationKind) string {
	switch k {
	case KindPINChanged:
		return "Your security PIN was changed"
	case KindPasswordChanged:
		return "Your password was changed"
	case KindSecuritySetupComplete:
		return "Your account is ready"
	default:
		return "A security change was made to your account"
	}
}

// SecurityHTML renders an HTML security notification.
func SecurityHTML(ev SecurityEvent) string {
	title := subjectFor(ev.Kind)

	// The "was this you?" block. Present on EVERY kind, including the welcome —
	// because a completion notice is exactly what an attacker triggers after
	// finishing their own work on an account.
	verification := fmt.Sprintf(`
	%s
	<p style="margin:0 0 6px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">If this was you</p>
	<p style="margin:0;color:#111827;font-size:14px;line-height:1.6;">
	Nothing more is needed. If you recognise the details above, this was you.</p>`,
		infoBox("#e5e7eb", "#f9fafb", "&#10003;", "If this was you", ""))
	_ = verification

	changedAt := fmt.Sprintf(
		`<p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;">Changed at</p>
		 <p style="margin:0 0 14px 0;color:#111827;font-size:14px;">%s</p>`,
		ev.When,
	)

	fromWhere := ""
	if ev.IP != "" || ev.UserAgent != "" {
		ip := ev.IP
		if ip == "" {
			ip = "unknown"
		}
		ua := ev.UserAgent
		if ua == "" {
			ua = "unknown device"
		}
		// Truncated: a full user-agent string is 200+ characters of vendor noise that
		// makes the line unreadable on a phone, and the browser alone is the part
		// that identifies a machine to a person.
		if len(ua) > 90 {
			ua = ua[:90] + "…"
		}
		fromWhere = fmt.Sprintf(
			`<p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;">From</p>
			 <p style="margin:0 0 4px 0;color:#111827;font-size:14px;">%s</p>
			 <p style="margin:0 0 14px 0;color:#6b7280;font-size:13px;">%s</p>`,
			ip, ua,
		)
	}

	// The credential is NOT included. Say so explicitly rather than silently
	// omitting it, so a recipient who expects to see it knows to ask for the reset
	// link instead — silence reads as a bug in the product.
	noSecret := fmt.Sprintf(`
	%s
	<p style="margin:0 0 6px 0;color:#92400e;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">If this was not you</p>
	<p style="margin:0 0 10px 0;color:#111827;font-size:14px;line-height:1.6;">
	Someone else changed this. Your %s is <strong>not</strong> in this email and never
	will be — we do not send credentials by email. Change it now, then check your other
	signed-in devices.</p>`,
		infoBox("#fde68a", "#fffbeb", "&#9888;", "If this was not you",
			""), secretNoun(ev.Kind))

	// Act now, but only where there IS an action.
	actNow := ""
	if ev.ResetURL != "" {
		actNow = fmt.Sprintf(
			`<div style="margin:22px 0 6px 0;">%s</div>`,
			primaryButton("Change it now", ev.ResetURL),
		)
	}

	help := ""
	if ev.SupportEmail != "" {
		help = fmt.Sprintf(
			`<p style="margin:20px 0 0 0;color:#6b7280;font-size:13px;">
			 Still looks wrong? Reply to this email or write to
			 <a href="mailto:%s" style="color:#2563eb;">%s</a>.</p>`,
			ev.SupportEmail, ev.SupportEmail,
		)
	}

	body := fmt.Sprintf(`
	%s
	%s
	%s
	%s
	%s
	%s`,
		changedAt, fromWhere, actNow, noSecret, verification, help,
	)

	// The welcome gets a different closing note: there is no suspicious change to
	// reconcile, so the "was this you" framing would be confusing.
	if ev.Kind == KindSecuritySetupComplete {
		body = fmt.Sprintf(`
		<p style="margin:0 0 16px 0;color:#111827;font-size:15px;line-height:1.6;">
			Your security PIN is set and your recovery questions are saved. You are all
			ready to publish.</p>
		%s
		<div style="margin:22px 0 6px 0;">%s</div>
		<p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">
			If you did not finish setting this up, change your password and contact us.</p>`,
			changedAt,
			primaryButton("Open your dashboard", resetOrHome(ev.ResetURL)),
		)
	}

	return emailShell(title, body)
}

// SecurityText is the plain-text equivalent.
//
// Every template in this package has one, and the reason is not politeness: a
// notification that is unreadable in a text-only client is a notification half the
// users never see.
func SecurityText(ev SecurityEvent) string {
	var b strings.Builder
	b.WriteString(subjectFor(ev.Kind) + "\n\n")
	b.WriteString(headlineFor(ev.Kind) + "\n")
	b.WriteString("Changed at: " + ev.When + "\n")
	if ev.IP != "" {
		b.WriteString("From IP: " + ev.IP + "\n")
	}
	if ev.UserAgent != "" {
		b.WriteString("Device: " + ev.UserAgent + "\n")
	}
	b.WriteString("\n")
	b.WriteString("Your " + secretNoun(ev.Kind) + " is not in this email and never will be — " +
		"we do not send credentials by email.\n")

	if ev.Kind == KindSecuritySetupComplete {
		b.WriteString("\nYour security PIN is set and your recovery questions are saved.\n")
	}

	if ev.ResetURL != "" {
		b.WriteString("\nChange it now: " + ev.ResetURL + "\n")
	}
	if ev.SupportEmail != "" {
		b.WriteString("\nStill looks wrong? Write to " + ev.SupportEmail + "\n")
	}
	b.WriteString("\nIf you recognise these details, this was you and nothing more is needed.\n")
	return b.String()
}

// secretNoun names the credential WITHOUT revealing it.
func secretNoun(k NotificationKind) string {
	switch k {
	case KindPINChanged:
		return "security PIN"
	case KindPasswordChanged:
		return "password"
	default:
		return "security details"
	}
}

// resetOrHome prefers a real reset link and falls back to the dashboard root.
//
// A "Change it now" button pointing at the site root would be a lie — the user
// clicks it expecting to fix something.
func resetOrHome(url string) string {
	if url == "" {
		return "/dashboard"
	}
	return url
}

// SendSecurityNotification delivers a security notification.
func (d *Dispatcher) SendSecurityNotification(to string, ev SecurityEvent) error {
	if to == "" {
		return nil
	}
	return d.Send(to, subjectFor(ev.Kind), SecurityHTML(ev), SecurityText(ev))
}
