package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/wideo11/dashboard-service/internal/model"
)

var upgrader = websocket.Upgrader{
	// ---- Origin check (was: `return true`) ----
	//
	// `CheckOrigin: return true` lets ANY website open a
	// WebSocket to this service with the victim's cookies -
	// a CSRF-shaped hole: a malicious page could drive
	// real-time dashboard connections as the user. Reusing
	// the CORS allowlist (DASHBOARD_ALLOWED_ORIGINS) keeps
	// the HTTP and WebSocket origin policy one deployment
	// fact, in one place.
	CheckOrigin: func(r *http.Request) bool {
		return isAllowedOrigin(r.Header.Get("Origin"))
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type WebSocketHandler struct {
	db     *gorm.DB
	logger *zap.Logger
	
	// Connection management
	clients    map[string]*Client
	broadcast  chan model.WebSocketMessage
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

type Client struct {
	id       string
	conn     *websocket.Conn
	send     chan model.WebSocketMessage
	dashboardID uuid.UUID
}

func NewWebSocketHandler(db *gorm.DB, logger *zap.Logger) *WebSocketHandler {
	h := &WebSocketHandler{
		db:         db,
		logger:     logger,
		clients:    make(map[string]*Client),
		broadcast:  make(chan model.WebSocketMessage, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
	
	go h.run()
	return h
}

func (h *WebSocketHandler) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.id] = client
			h.mu.Unlock()
			h.logger.Info("WebSocket client registered", zap.String("clientID", client.id))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.id]; ok {
				delete(h.clients, client.id)
				close(client.send)
			}
			h.mu.Unlock()
			h.logger.Info("WebSocket client unregistered", zap.String("clientID", client.id))

		case message := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client.id)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *WebSocketHandler) HandleWebSocket(c *gin.Context) {
	dashboardIDStr := c.Query("dashboard_id")
	var dashboardID uuid.UUID
	if dashboardIDStr != "" {
		var err error
		dashboardID, err = uuid.Parse(dashboardIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid dashboard_id"})
			return
		}
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("Failed to upgrade WebSocket", zap.Error(err))
		return
	}

	client := &Client{
		id:       uuid.New().String(),
		conn:     conn,
		send:     make(chan model.WebSocketMessage, 256),
		dashboardID: dashboardID,
	}

	h.register <- client

	go client.writePump(h)
	go client.readPump(h)
}

func (c *Client) writePump(h *WebSocketHandler) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		h.unregister <- c
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteJSON(msg); err != nil {
				h.logger.Error("Failed to write WebSocket message", zap.Error(err))
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) readPump(h *WebSocketHandler) {
	defer func() {
		h.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, messageData, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				h.logger.Error("WebSocket read error", zap.Error(err))
			}
			break
		}

		var msg model.WebSocketMessage
		if err := json.Unmarshal(messageData, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case model.WSMsgTypeDashboardSync:
			// Client wants to sync dashboard state
			h.handleDashboardSync(c, msg)
		case model.WSMsgTypeHeartbeat:
			// Heartbeat response
		}
	}
}

func (h *WebSocketHandler) handleDashboardSync(c *Client, msg model.WebSocketMessage) {
	// Send current dashboard state to client
	var dashboard model.Dashboard
	if c.dashboardID != uuid.Nil {
		if err := h.db.First(&dashboard, "id = ?", c.dashboardID).Error; err == nil {
			h.sendToClient(c, model.WebSocketMessage{
				Type: model.WSMsgTypeDashboardSync,
				Data: dashboard,
			})
		}
	}
}

func (h *WebSocketHandler) sendToClient(c *Client, msg model.WebSocketMessage) {
	select {
	case c.send <- msg:
	default:
		h.unregister <- c
	}
}

// BroadcastPanelUpdate sends a panel update to all clients watching a dashboard
func (h *WebSocketHandler) BroadcastPanelUpdate(dashboardID uuid.UUID, panelID string, data interface{}) {
	msg := model.WebSocketMessage{
		Type: model.WSMsgTypePanelUpdate,
		Data: map[string]interface{}{
			"dashboardId": dashboardID,
			"panelId":     panelID,
			"data":        data,
		},
	}
	h.broadcastToDashboard(dashboardID, msg)
}

// BroadcastAlertUpdate sends an alert update to all clients
func (h *WebSocketHandler) BroadcastAlertUpdate(alert *model.Alert) {
	h.BroadcastMessage(model.WSMsgTypeAlertUpdate, alert)
}

// BroadcastMessage emits an arbitrary WebSocketMessage to ALL connected clients
// (regardless of dashboard_id, including unassigned ones with dashboard_id == uuid.Nil).
// It is the fan-out target for service-to-service forwarders such as the
// webhook-receiver's alert-forward endpoint.
//
// Accepts the message type plus an arbitrary data payload (a struct pointer, a
// map, or nil). The caller's data is sent verbatim as `WebSocketMessage.Data`,
// keeping the on-wire shape exactly what existing consumers already expect
// (`type` + `data`), so no client schema change is needed to adopt it.
func (h *WebSocketHandler) BroadcastMessage(msgType string, data any) {
	h.broadcast <- model.WebSocketMessage{
		Type: msgType,
		Data: data,
	}
}

func (h *WebSocketHandler) broadcastToDashboard(dashboardID uuid.UUID, msg model.WebSocketMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, client := range h.clients {
		if client.dashboardID == dashboardID || client.dashboardID == uuid.Nil {
			select {
			case client.send <- msg:
			default:
				// Client buffer full, skip
			}
		}
	}
}

func (h *WebSocketHandler) GetConnectedClients() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// GetClientCount returns the number of connected clients
func (h *WebSocketHandler) GetClientCount() int {
	return h.GetConnectedClients()
}

// BroadcastAlert is the HTTP entry point for service-to-service alert
// forwarding. `webhook-receiver` POSTs each AlertManager/Prometheus alert here
// after persisting it, and this handler fans it out to every connected browser
// over the WebSocket bus as a `alert_update` message.
//
// Security: gated by `X-Internal-Secret` (the shared INTERNAL_SERVICE_SECRET),
// checked here rather than in middleware so this handler stays self-contained
// and testable. Fail-closed: missing or wrong secret -> 403, no broadcast.
func (h *WebSocketHandler) BroadcastAlert(c *gin.Context, secret string) {
	if c.GetHeader("X-Internal-Secret") != secret {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid_internal_secret"})
		return
	}
	var payload map[string]any
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_json: " + err.Error()})
		return
	}
	if payload["id"] == nil {
		// Minimum viable invariant: a broadcastable alert must be addressable
		// from the client (WarningCirclePanel dedupes by id). Without it the
		// message is noise that cannot be reconciled.
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
		return
	}
	// Echo back the exact shape consumers already parse (alert_update with
	// id/name/severity/state/startsAt/labels/annotations/generatorURL). If a
	// forwarder sent extra fields (fingerprint, status, endsAt), they pass
	// through unchanged.
	h.BroadcastMessage(model.WSMsgTypeAlertUpdate, payload)
	h.logger.Debug("alert broadcast",
		zap.String("id", fmt.Sprintf("%v", payload["id"])),
		zap.String("name", fmt.Sprintf("%v", payload["name"])),
	)
	c.JSON(http.StatusOK, gin.H{"status": "broadcast", "type": model.WSMsgTypeAlertUpdate})
}