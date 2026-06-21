package server

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// cors libera o front (origens conhecidas) com cookies de credencial.
// ponytail: feito à mão, sem gin-contrib/cors — allowlist + credentials + preflight.
func cors(allowed []string) gin.HandlerFunc {
	set := make(map[string]bool, len(allowed))
	for _, o := range allowed {
		if o = strings.TrimSpace(o); o != "" {
			set[o] = true
		}
	}
	return func(c *gin.Context) {
		if origin := c.GetHeader("Origin"); set[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type")
			c.Header("Vary", "Origin")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
