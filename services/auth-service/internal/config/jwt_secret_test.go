package config

// Tests for the JWT signing-key validation.
//
// ----------------------------------------------------------------------------
// WHY THIS VALIDATION EXISTS AT ALL
// ----------------------------------------------------------------------------
//
// `jwt.secret_key` used to default to the literal string
// "your-secret-key-change-in-production". That default was committed here, so it
// was public.
//
// The consequence is not subtle and is worth writing down precisely, because the
// code looks fine either way. If `JWT_SECRET_KEY` is unset:
//
//   - viper yields the default
//   - the service starts, binds its port, and signs tokens with it
//   - every health check passes
//   - every test in the repository passes
//   - the app works completely
//
// and then anyone who has read this repository can mint a valid token:
//
//	payload := {"user_id":"<any uuid>","role":"superadmin",
//	            "aud":"wideo11-api","exp":<future>}
//	token   := b64(header)+"."+b64(payload)+"."+HMAC_SHA256(payload, default)
//
// Every app's gate uses `jose` against the SAME key. So the signature verifies,
// the audience matches, the expiry has not passed, and the request is served as
// the superadmin. There is no bug to exploit and no race to win - the key is the
// authentication system, and it was published.
//
// So there is no default at all, and an unset key stops the service. Compose has
// the same check independently (`${JWT_SECRET_KEY:?...}`), which means the
// failure happens before a container is created rather than after a port is open.

import (
	"strings"
	"testing"
)

// TestValidateRejectsAnEmptyJWTSecret is the base case.
//
// Not merely "a warning was logged". `LoadConfig` returns an error, and `main`
// fatals on it, so no port is ever bound with no signing key.
func TestValidateRejectsAnEmptyJWTSecret(t *testing.T) {
	c := &Config{}
	c.JWT.SecretKey = ""

	err := c.Validate()
	if err == nil {
		t.Fatal("Validate accepted an empty JWT signing key.\n" +
			"With no key, every app's gate fails closed and NOBODY can sign in -\n" +
			"or, if a default is ever reintroduced, everybody can. Neither may pass\n" +
			"silently.")
	}
	if !strings.Contains(err.Error(), "JWT_SECRET_KEY") {
		t.Errorf("the error does not name the variable, so nobody can fix it: %v", err)
	}
	// The message must say how to fix it. An error that says what is wrong but
	// not what to do is a support ticket.
	if !strings.Contains(err.Error(), "openssl rand") {
		t.Errorf("the error does not say how to generate a key: %v", err)
	}
}

// TestValidateRejectsEveryPreviouslyPublishedSecret is the specific regression.
//
// Checking only for "empty" would not catch the realistic mistake: somebody
// copying an `.env.example` from an older commit, which is exactly where people
// look. Those values are not weak by accident - they are weak because they were
// published here.
func TestValidateRejectsEveryPreviouslyPublishedSecret(t *testing.T) {
	for _, published := range KnownWeakJWTSecrets {
		t.Run(published, func(t *testing.T) {
			c := &Config{}
			c.JWT.SecretKey = published

			err := c.Validate()
			if err == nil {
				t.Fatalf("Validate accepted %q, which is committed in this repository.\n"+
					"Anybody who has read the source can forge a superadmin token with it.",
					published)
			}
			if !strings.Contains(err.Error(), "forge") {
				t.Errorf("the error does not explain the consequence: %v", err)
			}
		})
	}
}

// TestValidateRejectsAShortSecret.
//
// HMAC-SHA256 truncates silently below its block size, so a short key is accepted
// by every library without complaint while providing far less strength than its
// length suggests. That is why this is a refusal and not a note: nothing else in
// the stack will complain.
func TestValidateRejectsAShortSecret(t *testing.T) {
	c := &Config{}
	c.JWT.SecretKey = "short-but-not-empty"

	if err := c.Validate(); err == nil {
		t.Error("Validate accepted a 19-character signing key.\n" +
			"HMAC truncates silently below 64 bytes, so a short key is weaker than it\n" +
			"looks and no library will warn about it.")
	}
}

// TestValidateAcceptsARealSecret is the other direction, and it exists so the
// validation cannot be "fix"ed by rejecting everything.
//
// A check that always fails is indistinguishable from a working check to anyone
// reading the output, and gets disabled the first time it blocks a real
// deployment.
func TestValidateAcceptsARealSecret(t *testing.T) {
	c := &Config{}
	// 64 characters, as `openssl rand -base64 48` produces.
	c.JWT.SecretKey = strings.Repeat("a1b2c3d4", 8)

	if err := c.Validate(); err != nil {
		t.Errorf("Validate rejected a valid 64-character key: %v", err)
	}
}

// TestValidateAcceptsEveryOtherConfigurationDefault proves the check is narrow.
//
// `LoadConfig` is called by tests and tooling that are not deploying anything, and
// by anyone running the service locally. If `Validate` rejected missing database
// credentials or an unset Redis host, it would be a different check with a
// different purpose - and it would make local development and the test suite
// impossible for no security gain.
func TestValidateAcceptsEveryOtherConfigurationDefault(t *testing.T) {
	c := &Config{}
	c.JWT.SecretKey = strings.Repeat("f0e1d2c3", 8)

	// Everything else is the zero value - no database, no Redis, no storage.
	if err := c.Validate(); err != nil {
		t.Errorf("Validate demands non-security configuration and is therefore not a\n"+
			"security check any more: %v", err)
	}
}

// TestLoadConfigFailsWithoutASecret is the end-to-end assertion.
//
// Unit-testing `Validate` proves the function works. This proves it is CALLED -
// which is the thing that regresses, because a validation function nobody invokes
// is a function that documents an intention.
func TestLoadConfigFailsWithoutASecret(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", "")

	if _, err := LoadConfig(); err == nil {
		t.Error("LoadConfig returned a config with no JWT signing key.\n" +
			"Either the default is back, or Validate is not wired into LoadConfig.\n" +
			"Both are the same failure: a service that starts and cannot authenticate.")
	}
}

// TestLoadConfigFailsWithAPublishedSecret is the same, for the realistic mistake.
func TestLoadConfigFailsWithAPublishedSecret(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")

	if _, err := LoadConfig(); err == nil {
		t.Error("LoadConfig accepted the published default signing key.")
	}
}

// TestLoadConfigSucceedsWithAGoodSecret closes the loop: the happy path still
// works, so the two tests above cannot both be passing because LoadConfig always
// fails.
func TestLoadConfigSucceedsWithAGoodSecret(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig rejected a valid key: %v", err)
	}
	if cfg.JWT.SecretKey != testJWTSecret {
		t.Errorf("the key was not read from the environment: got %q", cfg.JWT.SecretKey)
	}
}
