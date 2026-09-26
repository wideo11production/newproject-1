package handler

import (
	"encoding/json"
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
	CheckOrigin: func(r *http.Request) bool { return true },
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
	msg := model.WebSocketMessage{
		Type: model.WSMsgTypeAlertUpdate,
		Data: alert,
	}
	h.broadcast <- msg
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