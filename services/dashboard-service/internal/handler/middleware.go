package handler

import (
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func LoggerMiddleware(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		clientIP := c.ClientIP()
		method := c.Request.Method
		statusCode := c.Writer.Status()

		if raw != "" {
			path = path + "?" + raw
		}

		logger.Info("HTTP Request",
			zap.String("method", method),
			zap.String("path", path),
			zap.Int("status", statusCode),
			zap.String("clientIP", clientIP),
			zap.Duration("latency", latency),
		)
	}
}

// allowedOrigins is the set of browser origins this service
// answers cross-origin. Loaded once from
// DASHBOARD_ALLOWED_ORIGINS (comma-separated), because the
// allowlist is a deployment fact, not a per-request one.
//
// ---- WHY A LIST AND NOT A WILDCARD ----
// The old CORSMiddleware sent `Access-Control-Allow-Origin:
// *` TOGETHER with `Access-Control-Allow-Credentials: true`.
// Those two cannot coexist: a browser that sees credentials
// mode with a wildcard origin REJECTS the response outright,
// so every authenticated cross-origin fetch from the
// dashboard UI was failing CORS - and any operator who
// "fixed" the symptom by dropping the credentials flag
// opened a credential-less wildcard instead. Reflecting only
// allowlisted origins keeps both properties: cookies flow to
// the origins we operate, and nowhere else.
var allowedOrigins = loadAllowedOrigins()

func loadAllowedOrigins() map[string]struct{} {
	set := map[string]struct{}{}
	for _, origin := range strings.Split(os.Getenv("DASHBOARD_ALLOWED_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			set[origin] = struct{}{}
		}
	}
	return set
}

// isAllowedOrigin reports whether a browser Origin may read
// this service's responses. An empty Origin (curl, health
// checks, same-origin requests) is not a cross-origin request
// at all, so the CORS layer lets it through. The WebSocket
// upgrader applies the same rule, so the HTTP and WebSocket
// origin policy stays ONE deployment fact.
func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return true
	}
	_, ok := allowedOrigins[origin]
	return ok
}

func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// Not a cross-origin request: no CORS headers needed.
		if origin == "" {
			c.Next()
			return
		}

		// Not on the allowlist: send NO CORS headers. A
		// preflight answered 204-with-headers would look like
		// permission; a 403 looks like what it is.
		if !isAllowedOrigin(origin) {
			if c.Request.Method == "OPTIONS" {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
			c.Next()
			return
		}

		// Allowlisted origin: reflect it (never "*" while
		// credentials are on), and advertise Vary so a shared
		// cache cannot serve one origin's response to another.
		c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		c.Writer.Header().Set("Vary", "Origin")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func ErrorMiddleware(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if len(c.Errors) == 0 {
			return
		}

		// Log every error the handler chain attached. The
		// old version looped over them and discarded each
		// one (`_ = e`), which made this middleware a
		// no-op that still wrote a response.
		for _, e := range c.Errors {
			logger.Error("request error",
				zap.Error(e.Err),
				zap.String("method", c.Request.Method),
				zap.String("path", c.Request.URL.Path),
			)
		}

		// Write the generic 500 only when the handler has
		// NOT already responded - a handler that wrote its
		// own error response must not get a second one.
		if c.Writer.Written() {
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}

func RecoveryMiddleware() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
			"error": "Internal server error",
		})
	})
}

func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = generateRequestID()
		}
		c.Set("request_id", requestID)
		c.Writer.Header().Set("X-Request-ID", requestID)
		c.Next()
	}
}

func generateRequestID() string {
	return fmt.Sprintf("%d-%s", time.Now().UnixNano(), randomString(8))
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}
