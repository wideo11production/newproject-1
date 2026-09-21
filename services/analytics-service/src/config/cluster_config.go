// services/analytics-service/src/config/cluster_config.go
package config

import (
	"os"
	"strconv"
	"time"
)

// TopologyConfig - Plan A aur Plan B network rules track karta hai
type TopologyConfig struct {
	Endpoint string `json:"endpoint"`
	Port     int    `json:"port"`
	Region   string `json:"region"`
	Weight   int    `json:"weight"`
}

// ClusterConfig - Main multi-region cluster manager configuration definition
// Plan A (Airtel Primary) aur Plan B (Tata Failover) rules isme parse hote hain
type ClusterConfig struct {
	PlanATopology         TopologyConfig
	PlanBTopology         TopologyConfig
	FailoverCheckInterval time.Duration
	FailoverTimeout       time.Duration
	HealthCheckEndpoint   string
	RoutingStrategy       string
}

// LoadClusterConfig - Core setup maps dynamically from centralized .env parameters
func LoadClusterConfig() *ClusterConfig {
	checkIntervalStr := getEnvAsString("FAILOVER_CHECK_INTERVAL", "30s")
	checkInterval, err := time.ParseDuration(checkIntervalStr)
	if err != nil {
		checkInterval = 30 * time.Second // Default fallback parameter variable
	}

	timeoutStr := getEnvAsString("FAILOVER_TIMEOUT", "60s")
	timeout, err := time.ParseDuration(timeoutStr)
	if err != nil {
		timeout = 60 * time.Second // Default timeout standard
	}

	return &ClusterConfig{
		PlanATopology: TopologyConfig{
			Endpoint: getEnvAsString("PRIMARY_CLUSTER_ENDPOINT", "https://analytics-primary.wideo11.internal"),
			Port:     getEnvAsInt("PRIMARY_CLUSTER_PORT", 8080),
			Region:   getEnvAsString("PRIMARY_CLUSTER_REGION", "us-east-1a"),
			Weight:   getEnvAsInt("PRIMARY_WEIGHT", 90),
		},
		PlanBTopology: TopologyConfig{
			Endpoint: getEnvAsString("SECONDARY_CLUSTER_ENDPOINT", "https://analytics-secondary.wideo11.internal"),
			Port:     getEnvAsInt("SECONDARY_CLUSTER_PORT", 8080),
			Region:   getEnvAsString("SECONDARY_CLUSTER_REGION", "us-west-2a"),
			Weight:   getEnvAsInt("SECONDARY_WEIGHT", 10),
		},
		FailoverCheckInterval: checkInterval,
		FailoverTimeout:       timeout,
		HealthCheckEndpoint:   getEnvAsString("HEALTH_CHECK_ENDPOINT", "/health"),
		RoutingStrategy:       getEnvAsString("ROUTING_STRATEGY", "geo-dns"),
	}
}

func getEnvAsString(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return fallback
}

func getEnvAsInt(key string, fallback int) int {
	value, err := strconv.Atoi(getEnvAsString(key, ""))
	if err != nil {
		return fallback
	}
	return value
}
