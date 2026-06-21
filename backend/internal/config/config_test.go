package config

import "testing"

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	if _, err := Load(); err == nil {
		t.Fatal("esperava erro quando DATABASE_URL está ausente")
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://x")
	t.Setenv("APP_PORT", "")
	t.Setenv("APP_ENV", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if cfg.Port != "8080" || cfg.Env != "development" {
		t.Fatalf("defaults não aplicados: %+v", cfg)
	}
}
