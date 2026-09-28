package email

// Template render test - verify karta hai ki HTML email sahi ban rahi hai.
//
// Ye test real SMTP nahi chodta (koi network nahi). Ye sirf HTML/text
// structure validate karta hai + ek preview file likhta hai jo browser
// me dekh sakte hain.
//
// Hinglish: HTML email generate karke check karo ki structure theek hai

import (
	"os"
	"strings"
	"testing"
)

func TestVerificationTemplateRenders(t *testing.T) {
	html := VerificationHTML(
		"Aarav Sharma",
		"http://localhost:3000/auth/verify?token=abc123",
		"482913",
		30,
	)
	text := VerificationText(
		"Aarav Sharma",
		"http://localhost:3000/auth/verify?token=abc123",
		"482913",
		30,
	)

	// ---- Structural checks ----
	checks := []struct {
		name    string
		cond    bool
		message string
	}{
		{"has DOCTYPE", strings.Contains(html, "<!DOCTYPE html>"), "missing doctype"},
		{"has viewport meta", strings.Contains(html, `name="viewport"`), "missing viewport - mobile will render tiny"},
		{"has table layout", strings.Contains(html, "<table"), "must use tables for email"},
		{"has 600px container", strings.Contains(html, `width="600"`), "standard email width is 600px"},
		{"has dark bg token", strings.Contains(html, "#111217"), "grafana bg missing"},
		{"has primary btn", strings.Contains(html, "#5794f2"), "primary color missing"},
		{"has verify link", strings.Contains(html, "auth/verify?token=abc123"), "verify link missing"},
		{"has 6-digit code", strings.Contains(html, "482913"), "code missing in html"},
		{"code is blurred", strings.Contains(html, "blur(6px)"), "code should be blurred initially"},
		{"has dblclick reveal", strings.Contains(html, "ondblclick"), "double-click reveal missing"},
		{"has reveal hint", strings.Contains(html, "Double-click the code"), "reveal instruction missing"},
		{"has 30 min expiry", strings.Contains(html, "30 minutes"), "expiry not mentioned"},
		{"no external images", !strings.Contains(html, "<img"), "no external images (blocked/slow)"},
		{"no external links in css", !strings.Contains(html, "@import"), "css import not allowed in email"},

		// Text part checks
		{"text has code", strings.Contains(text, "482913"), "code missing in text fallback"},
		{"text has link", strings.Contains(text, "auth/verify?token=abc123"), "link missing in text"},
		{"text has expiry", strings.Contains(text, "30 minutes"), "expiry missing in text"},
	}

	for _, c := range checks {
		if !c.cond {
			t.Errorf("FAIL %s: %s", c.name, c.message)
		}
	}

	// ---- Write preview files so a human can eyeball the design ----
	// Ye test artifacts temp dir me jate hain, repo me nahi.
	_ = os.WriteFile(os.TempDir()+"/wideo11-verification-preview.html", []byte(html), 0o644)
	t.Logf("HTML preview written to %s (open in a browser to review the design)", os.TempDir()+"/wideo11-verification-preview.html")
}

func TestPurgeTemplateRenders(t *testing.T) {
	html := PurgeHTML("user@example.com")
	text := PurgeText("user@example.com")

	checks := []struct {
		name string
		cond bool
	}{
		{"has DOCTYPE", strings.Contains(html, "<!DOCTYPE html>")},
		{"has viewport", strings.Contains(html, `name="viewport"`)},
		{"has spec wording", strings.Contains(html, "unverified registration has been securely removed")},
		{"text has spec wording", strings.Contains(text, "unverified registration has been securely removed")},
		{"has re-register CTA", strings.Contains(html, "Register again")},
		{"no external images", !strings.Contains(html, "<img")},
	}
	for _, c := range checks {
		if !c.cond {
			t.Errorf("FAIL %s", c.name)
		}
	}
	_ = os.WriteFile(os.TempDir()+"/wideo11-purge-preview.html", []byte(html), 0o644)
}
