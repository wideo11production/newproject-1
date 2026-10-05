package handler

// =============================================================================
// SECURITY NOTIFICATIONS - a small interface so the handler does not depend on the
// email package's internals
// =============================================================================
//
// Why an interface rather than `*email.Dispatcher`:
//
//   - the handler package already imports `service`, `model`, `middleware` and
//     `config`. Adding `email` would make every handler test drag in the SMTP
//     transport's shape even when the test only wants to know whether a notifier
//     was CALLED.
//
//   - a test can then assert "this change notified somebody" by supplying a fake,
//     which is the assertion that actually matters. Before this there was no
//     assertion at all, because there was no call.
//
//   - and it keeps the "never send the credential" rule checkable at compile time.
//     `SecurityEvent` in the `email` package has no field for the new PIN or the new
//     password, so it is not merely a convention — a notifier here cannot be handed
//     a credential, because there is nowhere to put one.
//
// Nil is a legitimate state: a deployment with mail disabled has none, and must
// still be able to change a PIN.

import (
	"context"
	"log"
	"strings"

	"github.com/wideo11/auth-service/internal/email"
)

// SecurityNotifier is what the handler needs from a mailer.
type SecurityNotifier interface {
	SendSecurityNotification(to string, ev email.SecurityEvent) error
}

// SetSecurityNotifier attaches the mailer for PIN, password and welcome alerts.
//
// Nil clears it, which is a legitimate configuration rather than an error.
func (h *AuthHandler) SetSecurityNotifier(n SecurityNotifier) {
	h.securityNotifier = n
}

// notifySecurity sends one security notification, and never fails the request.
//
// EVERY failure is swallowed and logged, and that is the deliberate design:
//
//   - the user's action ALREADY SUCCEEDED. The PIN is changed and persisted before
//     this is called. Returning 500 would tell somebody their password was not
//     changed when it was — the worst possible lie, because they would then keep
//     using the old one believing it had failed.
//
//   - a monitoring/queue failure must not become an availability incident on a
//     credential-change endpoint.
//
//   - the log line is what makes the drop visible. A silent failure here means an
//     account takeover leaves no trace on the one channel that would have warned
//     about it.
//
// `to` is the account's email, resolved by the caller so this function has no
// database access of its own.
func (h *AuthHandler) notifySecurity(ctx context.Context, to string, ev email.SecurityEvent) {
	if h.securityNotifier == nil || to == "" {
		return
	}
	if err := h.securityNotifier.SendSecurityNotification(to, ev); err != nil {
		// The address is PARTIALLY masked in the log.
		//
		// A log line containing a full address is a searchable list of every
		// account that changed a credential — which is a list of every account worth
		// targeting. `j***@example.com` is enough to correlate a failure with a
		// user in the support tool; it is not enough to be useful to anyone reading
		// the log file who should not have been.
		log.Printf("[SECURITY-NOTIFY] %s notification to %s failed: %v (the change itself was applied)",
			ev.Kind, maskEmail(to), err)
	}
}

// maskEmail redacts the local part of an address for logging.
//
// Keeps enough to identify the account (`j***@example.com`) and drops enough to be
// useless to a reader of the log.
func maskEmail(addr string) string {
	at := strings.Index(addr, "@")
	if at <= 0 {
		return "***"
	}
	local := addr[:at]
	if len(local) <= 1 {
		return "***" + addr[at:]
	}
	return local[:1] + "***" + addr[at:]
}
