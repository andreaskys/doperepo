package server

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"github.com/doperepo/backend/internal/auth"
	"github.com/doperepo/backend/internal/bookings"
	"github.com/doperepo/backend/internal/config"
	"github.com/doperepo/backend/internal/db/sqlc"
	"github.com/doperepo/backend/internal/notifications"
	"github.com/doperepo/backend/internal/platform/rabbitmq"
	"github.com/doperepo/backend/internal/platform/storage"
	"github.com/doperepo/backend/internal/venues"
)

// Deps é a infraestrutura já conectada, entregue às camadas de cima. Broker e
// Storage podem ser nil (degradam graciosamente).
type Deps struct {
	Cfg     config.Config
	DB      *pgxpool.Pool
	Redis   *goredis.Client
	Broker  *rabbitmq.Publisher
	Storage *storage.Client
}

func New(deps Deps) *gin.Engine {
	if deps.Cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), cors(strings.Split(deps.Cfg.CORSOrigins, ",")))

	r.GET("/health", healthHandler(deps))

	queries := sqlc.New(deps.DB)
	secure := deps.Cfg.Env == "production"
	authH := auth.NewHandler(auth.NewService(queries, deps.Redis, deps.Storage), secure)
	venuesH := venues.NewHandler(venues.NewService(queries, deps.Storage, deps.Redis))
	bookingsH := bookings.NewHandler(bookings.NewService(deps.DB, queries, notifications.NewNotifier(deps.Broker, queries)))

	api := r.Group("/api/v1")
	authH.Routes(api)
	venuesH.Routes(api, authH.RequireAuth())
	bookingsH.Routes(api, authH.RequireAuth())
	notifications.NewHandler(queries).Routes(api, authH.RequireAuth())

	return r
}
