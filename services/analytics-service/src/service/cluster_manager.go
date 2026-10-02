// services/analytics-service/src/service/cluster_manager.go
package service

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"newproject/services/analytics-service/src/config"
)

// ActiveClusterManager - Manages high availability failover state between Plan A and Plan B
type ActiveClusterManager struct {
	config       *config.ClusterConfig
	activePlan   string // "PLAN_A" or "PLAN_B" standard definitions
	mu           sync.RWMutex
	isMonitoring bool
}

// NewClusterManager - Constructor targeting multi-region infrastructure layout initialization
func NewClusterManager(cfg *config.ClusterConfig) *ActiveClusterManager {
	return &ActiveClusterManager{
		config:     cfg,
		activePlan: "PLAN_A", // Airtel primary default execution line mapping
	}
}

// GetActiveRoute - Router proxy values retrieve data safely without lock contention
func (cm *ActiveClusterManager) GetActiveRoute() string {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if cm.activePlan == "PLAN_A" {
		return cm.config.PlanATopology.Endpoint
	}
	return cm.config.PlanBTopology.Endpoint
}

// MonitorTopologyHealth - Continuous loops mapping 1-minute failover switch operations
func (cm *ActiveClusterManager) MonitorTopologyHealth(ctx context.Context) {
	cm.mu.Lock()
	if cm.isMonitoring {
		cm.mu.Unlock()
		return
	}
	cm.isMonitoring = true
	cm.mu.Unlock()

	ticker := time.NewTicker(cm.config.FailoverCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cm.checkHealth()
		}
	}
}

func (cm *ActiveClusterManager) checkHealth() {
	client := http.Client{
		Timeout: 5 * time.Second,
	}

	cm.mu.RLock()
	primaryURL := fmt.Sprintf("%s%s", cm.config.PlanATopology.Endpoint, cm.config.HealthCheckEndpoint)
	cm.mu.RUnlock()

	resp, err := client.Get(primaryURL)

	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Anomaly checking conditions - Primary status failure trigger criteria mapping
	if err != nil || resp.StatusCode != http.StatusOK {
		if cm.activePlan != "PLAN_B" {
			cm.activePlan = "PLAN_B" // Instantly execute absolute Plan B Tata high-availability routing redirection
			// In production: send network alerts tracking event logs directly via NATS JetStream infrastructure
		}
	} else {
		if cm.activePlan != "PLAN_A" {
			cm.activePlan = "PLAN_A" // Restore back to primary default core when health indices recover securely
		}
	}
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
}
