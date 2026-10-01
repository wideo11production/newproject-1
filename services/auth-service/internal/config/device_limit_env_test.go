package config

import (
	"os"
	"testing"
)

// TestDeviceLimitEnvBinding proves whether `DEVICE_LIMIT_ENABLED` actually
// reaches `cfg.DeviceLimit.Enabled` through viper's AutomaticEnv + Unmarshal.
//
// WHY THIS TEST EXISTS:
// The device cap silently did nothing in the running container even though the
// env var was set to `true`. Booleans are the suspicious case: viper returns the
// env value as the STRING "true", and if mapstructure does not coerce it the
// field silently keeps its zero value (false) - which, for this flag, means
// "limit OFF" with no error and no log line.
//
// So this asserts the real end-to-end binding instead of trusting it.
func TestDeviceLimitEnvBinding(t *testing.T) {
	t.Setenv("DEVICE_LIMIT_ENABLED", "true")
	t.Setenv("DEVICE_LIMIT_MAX_ACCOUNTS", "7")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if !cfg.DeviceLimit.Enabled {
		t.Errorf("DeviceLimit.Enabled = false, want true (DEVICE_LIMIT_ENABLED=true was set) " +
			"- viper is NOT binding this key, so the cap silently stays OFF")
	}
	if cfg.DeviceLimit.MaxAccounts != 7 {
		t.Errorf("DeviceLimit.MaxAccounts = %d, want 7 (DEVICE_LIMIT_MAX_ACCOUNTS=7 was set)",
			cfg.DeviceLimit.MaxAccounts)
	}
}

// TestDeviceLimitEnvBindingFalse proves the OFF direction also binds, otherwise
// there would be no way to disable the cap from .env at all.
func TestDeviceLimitEnvBindingFalse(t *testing.T) {
	t.Setenv("DEVICE_LIMIT_ENABLED", "false")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.DeviceLimit.Enabled {
		t.Error("DeviceLimit.Enabled = true, want false")
	}
}

// TestDeviceLimitUnsetFallsBackToSpec guards the fail-secure default: with no
// env var at all the cap must still be ON at 3, never off.
func TestDeviceLimitUnsetFallsBackToSpec(t *testing.T) {
	os.Unsetenv("DEVICE_LIMIT_ENABLED")
	os.Unsetenv("DEVICE_LIMIT_MAX_ACCOUNTS")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if !cfg.DeviceLimit.Enabled {
		t.Error("with DEVICE_LIMIT_ENABLED unset the cap must default to ON (fail-secure)")
	}
	if cfg.DeviceLimit.MaxAccounts != 3 {
		t.Errorf("default MaxAccounts = %d, want 3 (SPEC)", cfg.DeviceLimit.MaxAccounts)
	}
}
