package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type TimeRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type TimePicker struct {
	TimeOptions     []string `json:"time_options"`
	RefreshIntervals []string `json:"refresh_intervals"`
}

type Variable struct {
	Name     string      `json:"name"`
	Type     string      `json:"type"`
	Query    string      `json:"query"`
	Current  *VariableCurrent `json:"current,omitempty"`
	Options  []VariableOption `json:"options,omitempty"`
}

type VariableCurrent struct {
	Text  string `json:"text"`
	Value string `json:"value"`
}

type VariableOption struct {
	Text  string `json:"text"`
	Value string `json:"value"`
	Selected bool `json:"selected,omitempty"`
}

type Link struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

func ToJSON(v interface{}) datatypes.JSON {
	data, _ := json.Marshal(v)
	return datatypes.JSON(data)
}

type Dashboard struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UID         string         `gorm:"uniqueIndex;size:64" json:"uid"`
	Title       string         `gorm:"size:255;not null" json:"title"`
	Description string         `gorm:"type:text" json:"description"`
	Tags        datatypes.JSON `gorm:"type:jsonb" json:"tags"`
	Timezone    string         `gorm:"size:64;default:'utc'" json:"timezone"`
	SchemaVersion int          `gorm:"default:39" json:"schemaVersion"`
	Version     int            `gorm:"default:1" json:"version"`
	Refresh     string         `gorm:"size:32" json:"refresh"`
	Time        datatypes.JSON `gorm:"type:jsonb" json:"time"`
	TimePicker  datatypes.JSON `gorm:"type:jsonb" json:"timepicker"`
	Panels      datatypes.JSON `gorm:"type:jsonb;not null" json:"panels"`
	Variables   datatypes.JSON `gorm:"type:jsonb" json:"variables"`
	Links       datatypes.JSON `gorm:"type:jsonb" json:"links"`
	Annotations datatypes.JSON `gorm:"type:jsonb" json:"annotations"`
	CreatedBy   uuid.UUID      `gorm:"type:uuid" json:"createdBy"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Dashboard) TableName() string {
	return "dashboards"
}

type DashboardVersion struct {
	ID         uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	DashboardID uuid.UUID     `gorm:"type:uuid;not null;index" json:"dashboardId"`
	Version    int            `gorm:"not null" json:"version"`
	Title      string         `gorm:"size:255" json:"title"`
	Panels     datatypes.JSON `gorm:"type:jsonb;not null" json:"panels"`
	Variables  datatypes.JSON `gorm:"type:jsonb" json:"variables"`
	Time       datatypes.JSON `gorm:"type:jsonb" json:"time"`
	CreatedBy  uuid.UUID      `gorm:"type:uuid" json:"createdBy"`
	CreatedAt  time.Time      `json:"createdAt"`
	Data       datatypes.JSON `gorm:"type:jsonb" json:"data"`
}

func (DashboardVersion) TableName() string {
	return "dashboard_versions"
}

type DashboardPreference struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID      `gorm:"type:uuid;uniqueIndex:idx_user_preference;not null" json:"userId"`
	Key       string         `gorm:"size:128;uniqueIndex:idx_user_preference;not null" json:"key"`
	Value     datatypes.JSON `gorm:"type:jsonb;not null" json:"value"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

func (DashboardPreference) TableName() string {
	return "dashboard_preferences"
}

type Favorite struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index:idx_user_dashboard" json:"userId"`
	DashboardID uuid.UUID `gorm:"type:uuid;not null;index:idx_user_dashboard" json:"dashboardId"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (Favorite) TableName() string {
	return "favorites"
}

type Alert struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	Fingerprint string       `gorm:"size:64;uniqueIndex" json:"fingerprint"`
	Name      string         `gorm:"size:255" json:"name"`
	Severity  string         `gorm:"size:32" json:"severity"`
	State     string         `gorm:"size:32;index" json:"state"`
	Labels    datatypes.JSON `gorm:"type:jsonb" json:"labels"`
	Annotations datatypes.JSON `gorm:"type:jsonb" json:"annotations"`
	StartsAt  time.Time      `json:"startsAt"`
	EndsAt    *time.Time     `json:"endsAt"`
	GeneratorURL string      `gorm:"size:512" json:"generatorURL"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
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

// Panel represents a dashboard panel
type Panel struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"`
	Title    string                 `json:"title"`
	GridPos  GridPos                `json:"gridPos"`
	Targets  []Target               `json:"targets"`
	Options  map[string]interface{} `json:"options"`
	Datasource string               `json:"datasource,omitempty"`
}

type GridPos struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

type Target struct {
	Expr         string `json:"expr"`
	LegendFormat string `json:"legendFormat,omitempty"`
	RefID        string `json:"refId,omitempty"`
	Format       string `json:"format,omitempty"`
	Interval     string `json:"interval,omitempty"`
}

type QueryRequest struct {
	Queries []Query `json:"queries"`
	From    string  `json:"from"`
	To      string  `json:"to"`
}

type Query struct {
	RefID      string `json:"refId"`
	Expr       string `json:"expr"`
	Interval   string `json:"interval,omitempty"`
	LegendFormat string `json:"legendFormat,omitempty"`
	Format     string `json:"format,omitempty"`
}

type QueryResponse struct {
	Results map[string]QueryResult `json:"results"`
}

type QueryResult struct {
	Status string                 `json:"status"`
	Data   map[string]interface{} `json:"data"`
	Error  string                 `json:"error,omitempty"`
}

type ImportRequest struct {
	Dashboard Dashboard `json:"dashboard"`
	Overwrite bool      `json:"overwrite"`
	FolderUID string    `json:"folderUid,omitempty"`
}

type ExportResponse struct {
	Dashboard Dashboard `json:"dashboard"`
	Meta      ExportMeta `json:"meta"`
}

type ExportMeta struct {
	ExportedAt time.Time `json:"exportedAt"`
	Version    string    `json:"version"`
}

type WebSocketMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

const (
	WSMsgTypePanelUpdate   = "panel_update"
	WSMsgTypeAlertUpdate   = "alert_update"
	WSMsgTypeDashboardSync = "dashboard_sync"
	WSMsgTypeHeartbeat     = "heartbeat"
)