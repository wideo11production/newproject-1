package handler

import (
	"context"
	"net/http"
	"net/http/httputil"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/newproject/services/gateway/src/model"
	"github.com/newproject/services/gateway/src/service"
)

// Handler holds the service dependencies for HTTP handlers
type Handler struct {
	gatewayService *service.GatewayService
}

// NewHandler creates a new Handler with the given gateway service
func NewHandler(gs *service.GatewayService) *Handler {
	return &Handler{
		gatewayService: gs,
	}
}

// RegisterRoutes registers the gateway-related routes on the given Gin engine
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	// Health check endpoint
	r.GET("/health", h.HealthCheck)
	
	// Catch-all route for proxying to backend services
	// This must be registered last to avoid interfering with other routes
	r.NoRoute(h.ProxyRequest)
}

// HealthCheck handles GET /health
// Returns JSON: { "status": "<status>", "timestamp": "<timestamp>", ... }
func (h *Handler) HealthCheck(c *gin.Context) {
	health, err := h.gatewayService.GetHealthCheck(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, health)
}

// ProxyRequest handles all other requests by proxying to the appropriate backend service
func (h *Handler) ProxyRequest(c *gin.Context) {
	path := c.Request.URL.Path
	
	// Find the appropriate service for this path
	serviceConfig, found := h.gatewayService.FindRoute(path)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "service not found"})
		return
	}
	
	// Create a reverse proxy for the service
	proxy := httputil.NewSingleHostReverseProxy(serviceConfig.URL)
	
	// Modify the director to prefix the path appropriately
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		// Modify the path to remove the service prefix
		// For example, if the route is "/auth" and the request is "/auth/login",
		// we want to forward to "/login" on the backend service
		if strings.HasPrefix(req.URL.Path, serviceConfig.Path) {
			req.URL.Path = strings.TrimPrefix(req.URL.Path, serviceConfig.Path)
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
		}
		
		// Preserve the original host header
		if req.Header.Get("X-Forwarded-Host") == "" {
			req.Header.Set("X-Forwarded-Host", req.Host)
		}
		req.Host = serviceConfig.URL.Host
	}
	
	// Modify the transport to add timeout and other settings
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		MaxIdleConns:        100,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	proxy.Transport = transport
	
	// Execute the proxy
	proxy.ServeHTTP(c.Writer, c.Request)
}