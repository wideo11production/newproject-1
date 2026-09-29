package service

// Context-key collision ka regression test.
//
// YE TEST KYUN ZAROORI HAI:
// Pehle `clientIPKey` aur `clientUAKey` dono ek hi zero-size struct type
// the (`clientInfoKey{}`), isliye dono EQUAL the. Doosra `WithValue`
// pehle ko overwrite kar deta tha, aur result: har "IP" actually
// User-Agent hota tha.
//
// Iska real asar tha:
//   - `sessions.ip_address` me 100+ char ka UA ja raha tha
//   - jo `VARCHAR(45)` me fit nahi hota tha -> registration 500 fail
//   - superadmin panel me "IP address" column me UA text dikhta
//
// Ye test ensure karta hai ki IP aur UA alag alag keys par store hain aur
// cross-contaminate NAHI hote.

import (
	"context"
	"testing"
)

func TestClientInfoDoesNotCrossContaminate(t *testing.T) {
	const realIP = "203.0.113.42"
	const realUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"

	ctx := WithClientInfo(context.Background(), realIP, realUA)

	gotIP, gotUA := clientInfoFromContext(ctx)

	if gotIP != realIP {
		t.Errorf("IP contaminated: got %q, want %q", gotIP, realIP)
	}
	if gotUA != realUA {
		t.Errorf("UA contaminated: got %q, want %q", gotUA, realUA)
	}

	// Sabse zaroori check: IP field me UA ka text nahi aana chahiye
	// (ye wahi symptom tha jo 500 error kar raha tha).
	if gotIP == realUA {
		t.Error("ip field contains the user-agent string - context keys are colliding again")
	}
	if gotUA == realIP {
		t.Error("ua field contains the IP - context keys are colliding again")
	}
}

func TestClientInfoKeysAreDistinct(t *testing.T) {
	// Ye compile-time par guarantee hai ki types alag hain. Agar kabhi koi
	// dobara ek hi type use karta hai, to ye values EQUAL ho jayenge aur
	// test FAIL hoga.
	var ipK, uaK interface{} = ipKey{}, uaKey{}
	_ = ipK
	_ = uaK

	// Behavioural proof: dono values alag keys par store hoti hain
	ctx := context.WithValue(context.Background(), ipKey{}, "A")
	ctx = context.WithValue(ctx, uaKey{}, "B")

	if v := ctx.Value(ipKey{}); v != "A" {
		t.Errorf("ipKey overwritten: got %v, want A", v)
	}
	if v := ctx.Value(uaKey{}); v != "B" {
		t.Errorf("uaKey overwritten: got %v, want B", v)
	}
}

func TestTelemetryContextRoundTrip(t *testing.T) {
	want := DeviceInfoParsed{
		Country:    "IN",
		Continent:  "AS",
		DeviceType: "desktop",
		Browser:    "Chrome 131",
		OS:         "Windows 10/11",
	}
	ctx := WithTelemetryInContext(context.Background(), want)
	got := telemetryFromContext(ctx)

	if got != want {
		t.Errorf("telemetry round-trip failed: got %+v, want %+v", got, want)
	}
}

// Missing telemetry -> zero value (empty strings), NOT fabricated defaults
func TestTelemetryContextMissingReturnsEmpty(t *testing.T) {
	got := telemetryFromContext(context.Background())
	if got.Country != "" || got.Continent != "" || got.DeviceType != "" {
		t.Errorf("expected empty telemetry when absent, got %+v", got)
	}
}
