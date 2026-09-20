package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/newproject/services/gateway/src/config"
	"github.com/newproject/services/gateway/src/model"
	"github.com/newproject/services/gateway/src/repository"
)

// GatewayService handles the business logic for the API gateway
type GatewayService struct {
	cfg          *config.Config
	repo         repository.GatewayRepository
	routes       []model.ServiceConfig
	routesMutex  sync.RWMutex
	healthCache  *model.HealthCheck
	healthMutex  sync.RWMutex
	lastHealthCheck time.Time
	healthInterval time.Duration
}

// NewGatewayService creates a new GatewayService
func NewGatewayService(cfg *config.Config, repo repository.GatewayRepository) *GatewayService {
	gs := &GatewayService{
		cfg:          cfg,
		repo:         repo,
		routes:       []model.ServiceConfig{},
		healthInterval: 30 * time.Second, // Check health every 30 seconds
	}
	
	// Initialize routes from config
	gs.refreshRoutes()
	
	// Perform initial health check
	go gs.healthCheckLoop()
	
	return gs
}

// ServiceConfig represents a backend service configuration
type ServiceConfig struct {
	Name   string
	Path   string
	URL    *url.URL
	Proxy  *httputil.ReverseProxy
}

// refreshRoutes updates the internal routes from the configuration
func (gs *GatewayService) refreshRoutes() {
	gs.routesMutex.Lock()
	defer gs.routesMutex.Unlock()
	
	gs.routes = []model.ServiceConfig{}
	
	for _, routeCfg := range gs.cfg.GetRoutes() {
		// Parse the service URL
		serviceURL, err := url.Parse(routeCfg.ServiceURL)
		if err != nil {
			// In a real implementation, we would log this error
			continue
		}
		
		// Create a reverse proxy for this service
		proxy := httputil.NewSingleHostReverseProxy(serviceURL)
		
		// Modify the director to prefix the path appropriately
		originalDirector := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalDirector(req)
			// Modify the path to remove the service prefix
			// For example, if the route is "/auth" and the request is "/auth/login",
			// we want to forward to "/login" on the backend service
			if strings.HasPrefix(req.URL.Path, routeCfg.Path) {
				req.URL.Path = strings.TrimPrefix(req.URL.Path, routeCfg.Path)
				if req.URL.Path == "" {
					req.URL.Path = "/"
				}
			}
		}
		
		gs.routes = append(gs.routes, model.ServiceConfig{
			Name:   routeCfg.Service,
			Path:   routeCfg.Path,
			URL:    serviceURL,
			Proxy:  proxy,
		})
	}
}

// healthCheckLoop periodically checks the health of backend services
func (gs *GatewayService) healthCheckLoop() {
	ticker := time.NewTicker(gs.healthInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			gs.performHealthCheck()
		}
	}
}

// performHealthCheck checks the health of all configured services
func (gs *GatewayService) performHealthCheck() {
	// In a real implementation, this would make HTTP requests to each service's health endpoint
	// For now, we'll just update the cache with a placeholder
	
	gs.healthMutex.Lock()
	defer gs.healthMutex.Unlock()
	
	gs.healthCache = &model.HealthCheck{
		Status:   "healthy",
		Timestamp: time.Now().UTC(),
		Uptime:   "0h0m0s", // Would be calculated from start time
		Version:  "1.0.0",
		Services: []model.ServiceStatus{
			{Name: "auth-service", URL: "http://localhost:8081", Status: "healthy"},
			{Name: "user-service", URL: "http://localhost:8084", Status: "healthy"},
			{Name: "email-service", URL: "http://localhost:8085", Status: "healthy"},
			{Name: "profile-service", URL: "http://localhost:8086", Status: "healthy"},
			{Name: "settings-service", URL: "http://localhost:8087", Status: "healthy"},
		},
	}
	
	gs.lastHealthCheck = time.Now()
}

// GetHealthCheck returns the cached health check information
func (gs *GatewayService) GetHealthCheck(context.Context) (*model.HealthCheck, error) {
	gs.healthMutex.RLock()
	defer gs.healthMutex.RUnlock()
	
	if gs.healthCache == nil {
		return nil, errors.New("health check not available")
	}
	
	// Return a copy to prevent accidental modification
	healthCopy := *gs.healthCache
	return &healthCopy, nil
}

// GetRoutes returns the configured routes
func (gs *GatewayService) GetRoutes(context.Context) ([]model.ServiceConfig, error) {
	gs.routesMutex.RLock()
	defer gs.routesMutex.RUnlock()
	
	// Return a copy to prevent accidental modification
	routesCopy := make([]model.ServiceConfig, len(gs.routes))
	copy(routesCopy, gs.routes)
	return routesCopy, nil
}

// FindRoute finds the appropriate service configuration for a given request path
func (gs *GatewayService) FindRoute(path string) (*model.ServiceConfig, bool) {
	gs.routesMutex.RLock()
	defer gs.routesMutex.RUnlock()
	
	for _, route := range gs.routes {
		if strings.HasPrefix(path, route.Path) {
			return &route, true
		}
	}
	
	return nil, false
}