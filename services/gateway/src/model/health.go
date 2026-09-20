package model

import (
	"time"
)

// HealthCheck represents the health status of the gateway service
type HealthCheck struct {
	Status      string    `json:"status"`
	Timestamp   time.Time `json:"timestamp"`
	Uptime      string    `json:"uptime"`
	Version     string    `json:"version"`
	Services    []ServiceStatus `json:"services"`
}

// ServiceStatus represents the health status of a backend service
type ServiceStatus struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	Status string `json:"status"` // "healthy", "unhealthy", "unknown"
}