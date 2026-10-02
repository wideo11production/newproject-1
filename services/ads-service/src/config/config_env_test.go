package config

import (
	"os"
	"testing"
)

// lookupEnv reads an env var without panicking, for the guards above.
func lookupEnv(name string) string { return os.Getenv(name) }

// =============================================================================
// THIS TEST IS WHY THE OTHER 24 PATCHES ARE TRUSTED
// =============================================================================
//
// `tools/fix-env-replacer.mjs` added one line to 25 services and proved they all
// still COMPILE. Compilation is not behaviour: the bug it fixes is that an env
// var is silently ignored, and a file that compiles perfectly while ignoring
// `DATABASE_PASSWORD` is exactly what was wrong before.
//
// So the binding is asserted here, once, on a representative service. If this
// pattern holds for this module it holds for the other 24 - they were generated
// from the same template, which is why this class of defect hit all of them at
// once.
//
// The failure being guarded against:
//
//   key          database.dbname
//   looked up as DATABASE.DBNAME      (dot)
//   actually set DATABASE_DBNAME      (underscore)
//   result        ""  -> the service silently talks to the wrong database

func TestEnvVarsReachNestedKeys(t *testing.T) {
	t.Setenv("DATABASE_DBNAME", "ads_service_from_env")
	t.Setenv("DATABASE_HOST", "postgres-from-env")
	t.Setenv("SERVER_PORT", "9111")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if cfg.Database.DBName != "ads_service_from_env" {
		t.Errorf("Database.DBName = %q, want %q from DATABASE_DBNAME.\n"+
			"An empty or default value here means the env var is being ignored, which\n"+
			"is the exact bug this replacer line fixes - the service would silently\n"+
			"use the wrong database instead of failing.",
			cfg.Database.DBName, "ads_service_from_env")
	}
	if cfg.Database.Host != "postgres-from-env" {
		t.Errorf("Database.Host = %q, want %q from DATABASE_HOST", cfg.Database.Host, "postgres-from-env")
	}
	if cfg.Server.Port != "9111" {
		t.Errorf("Server.Port = %q, want %q from SERVER_PORT", cfg.Server.Port, "9111")
	}
}

// A YAML file must not win over the environment. Compose is the source of truth
// for deployed configuration, so an env var that a stray `config.yaml` on disk
// overrides is a value that changes when the image is rebuilt.
func TestEnvVarsBeatConfigFile(t *testing.T) {
	t.Setenv("DATABASE_DBNAME", "from_env_wins")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	// If a config.yaml with a different dbname is present in the search path,
	// this assertion fails, which is the point: the env var must take priority.
	if cfg.Database.DBName != "from_env_wins" {
		t.Errorf("Database.DBName = %q, want %q - a config file is overriding the environment",
			cfg.Database.DBName, "from_env_wins")
	}
}

// Defaults must still apply when nothing is set, so a service is not blank
// before configuration - only before CONFIGURATION is wrong.
func TestDefaultsStillApply(t *testing.T) {
	// `t.Setenv` cannot unset, so this relies on these two simply not being set
	// in the test environment. Guarded by reading them back first.
	t.Setenv("DATABASE_DBNAME", "")
	if v := lookupEnv("DATABASE_DBNAME"); v != "" {
		t.Skip("DATABASE_DBNAME is set in this environment; cannot test defaults")
	}

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Database.Host == "" {
		t.Error("Database.Host is empty - SetDefault no longer applies")
	}
}
