package server

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// healthHandler reporta o estado das dependências. Útil para o healthcheck do
// compose/orquestrador e para depurar a stack subindo.
func healthHandler(deps Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()

		checks := gin.H{"postgres": "ok", "redis": "ok", "rabbitmq": "ok"}
		status := http.StatusOK

		if err := deps.DB.Ping(ctx); err != nil {
			checks["postgres"] = err.Error()
			status = http.StatusServiceUnavailable
		}
		if err := deps.Redis.Ping(ctx).Err(); err != nil {
			checks["redis"] = err.Error()
			status = http.StatusServiceUnavailable
		}
		if deps.Broker == nil {
			checks["rabbitmq"] = "disabled" // não-fatal: assíncrono degrada graciosamente
		}

		c.JSON(status, gin.H{"status": status, "checks": checks})
	}
}
