package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/doperepo/backend/internal/config"
	"github.com/doperepo/backend/internal/db/sqlc"
	"github.com/doperepo/backend/internal/notifications"
	"github.com/doperepo/backend/internal/platform/postgres"
	"github.com/doperepo/backend/internal/platform/rabbitmq"
	"github.com/doperepo/backend/internal/platform/redis"
	"github.com/doperepo/backend/internal/platform/storage"
	"github.com/doperepo/backend/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()

	// Dependências de núcleo — fatal se indisponíveis.
	db, err := postgres.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer db.Close()

	rdb, err := redis.New(ctx, cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer func() { _ = rdb.Close() }()

	// Storage de fotos (MinIO) — NÃO fatal. Se cair, criar/editar venue ainda
	// funciona; só os endpoints de foto retornam 503.
	store, err := storage.New(ctx, cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Bucket, cfg.S3PublicURL)
	if err != nil {
		log.Printf("storage (MinIO) indisponível, upload de fotos desabilitado: %v", err)
	}

	// Mensageria assíncrona — NÃO fatal. Um broker fora do ar não pode derrubar
	// a API; as notificações só ficam desabilitadas até ele voltar.
	// ponytail: warn-and-continue. Adicione reconnect/outbox se a entrega virar
	// requisito de garantia.
	var broker *rabbitmq.Publisher
	if cfg.RabbitMQURL != "" {
		broker, err = rabbitmq.New(cfg.RabbitMQURL)
		if err != nil {
			log.Printf("rabbitmq indisponível, notificações desabilitadas: %v", err)
		} else {
			defer broker.Close()
		}
	}

	// Worker de notificações — só sobe com broker e SMTP configurados.
	if broker != nil && cfg.SMTPAddr != "" {
		if cons, err := notifications.NewConsumer(broker, sqlc.New(db), cfg.SMTPAddr); err != nil {
			log.Printf("worker de notificações desabilitado: %v", err)
		} else {
			cons.Start(ctx)
		}
	}

	router := server.New(server.Deps{Cfg: cfg, DB: db, Redis: rdb, Broker: broker, Storage: store})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("API ouvindo em :%s (env=%s)", cfg.Port, cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	// Graceful shutdown.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("encerrando...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown não-gracioso: %v", err)
	}
}
