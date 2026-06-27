package config

import (
	"fmt"
	"os"
)

// Config é a configuração da API, vinda do ambiente (12-factor).
// ponytail: os.Getenv direto, sem lib de config. Troque por envconfig só quando
// houver dezenas de campos com validação/tipos.
type Config struct {
	Env         string
	Port        string
	DatabaseURL string
	RedisURL    string
	RabbitMQURL string // opcional: vazio = notificações assíncronas desligadas
	CORSOrigins string // CSV de origens liberadas para o front

	S3Endpoint  string // host:port interno do MinIO (sem scheme)
	S3AccessKey string
	S3SecretKey string
	S3Bucket    string
	S3PublicURL string // base pública p/ montar URL das fotos (host do browser)

	SMTPAddr string // host:port do SMTP (Mailpit em dev); vazio = worker desligado
}

func Load() (Config, error) {
	cfg := Config{
		Env:         get("APP_ENV", "development"),
		Port:        get("APP_PORT", "8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisURL:    os.Getenv("REDIS_URL"),
		RabbitMQURL: os.Getenv("RABBITMQ_URL"),
		CORSOrigins: get("APP_CORS_ORIGINS", "http://localhost:3000,http://localhost:3100"),
		S3Endpoint:  os.Getenv("S3_ENDPOINT"),
		S3AccessKey: os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey: os.Getenv("S3_SECRET_KEY"),
		S3Bucket:    get("S3_BUCKET", "venue-photos"),
		S3PublicURL: get("S3_PUBLIC_URL", "http://localhost:9000"),
		SMTPAddr:    get("SMTP_ADDR", ""),
	}
	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("DATABASE_URL é obrigatória")
	}
	if cfg.RedisURL == "" {
		return cfg, fmt.Errorf("REDIS_URL é obrigatória")
	}
	return cfg, nil
}

func get(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
