package middleware

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// Logger returns a middleware that logs HTTP requests
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery
		c.Next()

		end := time.Now()
		latency := end.Sub(start)

		clientIP := c.ClientIP()
		method := c.Request.Method
		statusCode := c.Writer.Status()
		errorMessage := c.Errors.ByType(gin.ErrorTypePrivate).String()

		bodySize := c.Writer.Size()

		if len(errorMessage) > 0 {
			errorMessage = "\n" + errorMessage
		} else {
			errorMessage = ""
		}

		log.Info().Str("method", method).Str("path", path).
			Str("query", query).Int("status", statusCode).
			Str("ip", clientIP).Dur("latency", latency).
			Int("body_size", bodySize).Str("error", errorMessage).
			Msg("request")
	}
}

// Recovery returns a middleware that recovers from any panics and writes a 500 if there was one.
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				log.Error().Interface("error", err).
					Stack().
					Msg("recovered from panic")
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()
		c.Next()
	}
}

// CORS returns a middleware that handles CORS options
//
// REMOVED (Phase A / gap #2): is function ne ye set karta tha -
//     Access-Control-Allow-Origin:  *
//     Access-Control-Allow-Credentials: true
//
// jo do problems the:
//  1. Spec ke hisaab se `*` aur credentials saath me allowed NAHI hain, to
//     Chrome/Firefox credentialed requests REJECT karte the.
//  2. Wildcard origin + credentials = koi bhi website authenticated request
//     bhej sakti hai (CSRF ki precondition).
//
// Use `NewCORS(CorsConfig{...})` from security.go - wo proper allowlist use
// karta hai aur allowlisted origin ko reflect karta hai.
//
// ---- WHY DELETED, NOT DEPRECATED ----
// A "deprecated" insecure CORS wrapper is a footgun: it compiles, it looks
// harmless, and `NewCORS` has an identically-named cousin so the swap is a
// one-word edit nobody notices. Grep confirmed zero callers, so keeping it
// bought nothing but a way to silently reintroduce the bug.
