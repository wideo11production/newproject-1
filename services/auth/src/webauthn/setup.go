package webauthn

import (
	"github.com/duo-labs/webauthn/webauthn"
	"newproject/services/auth/src/config"
)

// WebAuthnHolder holds the webauthn instance
type WebAuthnHolder struct {
	*webauthn.WebAuthn
}

// NewWebAuthn creates a new WebAuthn instance based on config
func NewWebAuthn(cfg *config.WebAuthnConfig) (*WebAuthnHolder, error) {
	webAuthn, err := webauthn.New(&webauthn.Config{
		DisplayName: cfg.DisplayName, // e.g. "Wideo11"
		ID:          cfg.ID,          // Typically a domain name
		Origin:      cfg.Origin,      // The origin URL for WebAuthn
		IconURL:     cfg.IconURL,     // Optional icon URL
	})
	if err != nil {
		return nil, err
	}

	return &WebAuthnHolder{WebAuthn: webAuthn}, nil
}
