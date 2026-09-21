package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func ToJSON(v interface{}) datatypes.JSON {
	data, _ := json.Marshal(v)
	return datatypes.JSON(data)
}

type Alert struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Fingerprint string         `gorm:"size:64;uniqueIndex" json:"fingerprint"`
	Name        string         `gorm:"size:255" json:"name"`
	Severity    string         `gorm:"size:32" json:"severity"`
	State       string         `gorm:"size:32;index" json:"state"`
	Labels      datatypes.JSON `gorm:"type:jsonb" json:"labels"`
	Annotations datatypes.JSON `gorm:"type:jsonb" json:"annotations"`
	StartsAt    time.Time      `json:"startsAt"`
	EndsAt      *time.Time     `json:"endsAt"`
	GeneratorURL string        `gorm:"size:512" json:"generatorURL"`
	Status      string         `gorm:"size:32" json:"status"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Alert) TableName() string {
	return "alerts"
}

type WebhookEvent struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Source    string         `gorm:"size:64" json:"source"`
	Type      string         `gorm:"size:64" json:"type"`
	Payload   datatypes.JSON `gorm:"type:jsonb" json:"payload"`
	Processed bool           `gorm:"default:false" json:"processed"`
	Error     string         `gorm:"type:text" json:"error"`
	CreatedAt time.Time      `json:"createdAt"`
}

func (WebhookEvent) TableName() string {
	return "webhook_events"
}

type AlertGroup struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Name      string         `gorm:"size:255;not null" json:"name"`
	Labels    datatypes.JSON `gorm:"type:jsonb" json:"labels"`
	Interval  string         `gorm:"size:64" json:"interval"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

func (AlertGroup) TableName() string {
	return "alert_groups"
}

type AlertRoute struct {
	ID         uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	GroupID    uuid.UUID      `gorm:"type:uuid;not null;index" json:"groupId"`
	Receiver   string         `gorm:"size:255" json:"receiver"`
	Continue   bool           `gorm:"default:false" json:"continue"`
	Match      datatypes.JSON `gorm:"type:jsonb" json:"match"`
	MatchRE    datatypes.JSON `gorm:"type:jsonb" json:"match_re"`
	CreatedAt  time.Time      `json:"createdAt"`
	UpdatedAt  time.Time      `json:"updatedAt"`
}

func (AlertRoute) TableName() string {
	return "alert_routes"
}

// AlertManagerWebhook represents the AlertManager webhook payload
type AlertManagerWebhook struct {
	Version           string            `json:"version"`
	GroupKey          string            `json:"groupKey"`
	Status            string            `json:"status"`
	Receiver          string            `json:"receiver"`
	GroupLabels       map[string]string `json:"groupLabels"`
	CommonLabels      map[string]string `json:"commonLabels"`
	CommonAnnotations map[string]string `json:"commonAnnotations"`
	ExternalURL       string            `json:"externalURL"`
	Alerts            []AlertManagerAlert `json:"alerts"`
}

type AlertManagerAlert struct {
	Status       string            `json:"status"`
	Labels       map[string]string `json:"labels"`
	Annotations  map[string]string `json:"annotations"`
	StartsAt     time.Time         `json:"startsAt"`
	EndsAt       time.Time         `json:"endsAt"`
	GeneratorURL string            `json:"generatorURL"`
	Fingerprint  string            `json:"fingerprint"`
}

// PrometheusWebhook represents a Prometheus rule webhook
type PrometheusWebhook struct {
	Alerts []AlertManagerAlert `json:"alerts"`
}

// CustomWebhook represents a custom webhook payload
type CustomWebhook struct {
	Title       string                 `json:"title"`
	Message     string                 `json:"message"`
	Severity    string                 `json:"severity"`
	Source      string                 `json:"source"`
	Tags        map[string]string      `json:"tags"`
	Metadata    map[string]interface{} `json:"metadata"`
	Timestamp   time.Time              `json:"timestamp"`
}