package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/wideo11/dashboard-service/internal/model"
)

func newTestWSHandler(t *testing.T) *WebSocketHandler {
	t.Helper()
	return &WebSocketHandler{
		logger:     zap.NewNop(),
		clients:    make(map[string]*Client),
		broadcast:  make(chan model.WebSocketMessage, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func TestBroadcastAlert_RejectsMissingSecret(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestWSHandler(t)
	go h.run()

	r := gin.New()
	r.POST("/internal/alerts/broadcast", func(c *gin.Context) {
		h.BroadcastAlert(c, "correct-secret")
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/internal/alerts/broadcast", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without secret, got %d", w.Code)
	}
}

func TestBroadcastAlert_RejectsWrongSecret(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestWSHandler(t)
	go h.run()

	r := gin.New()
	r.POST("/internal/alerts/broadcast", func(c *gin.Context) {
		h.BroadcastAlert(c, "correct-secret")
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/internal/alerts/broadcast", strings.NewReader(`{"id":"x","name":"HighCPU"}`))
	req.Header.Set("X-Internal-Secret", "wrong-secret")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for wrong secret, got %d", w.Code)
	}
}

func TestBroadcastAlert_BroadcastsToConnectedClient(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestWSHandler(t)
	go h.run()

	r := gin.New()
	r.GET("/ws", h.HandleWebSocket)
	r.POST("/internal/alerts/broadcast", func(c *gin.Context) {
		h.BroadcastAlert(c, "correct-secret")
	})
	server := httptest.NewServer(r)
	defer server.Close()

	u, _ := url.Parse(server.URL)
	wsURL := url.URL{Scheme: "ws", Host: u.Host, Path: "/ws"}
	ws, _, dialErr := (&websocket.Dialer{HandshakeTimeout: 2 * time.Second}).Dial(wsURL.String(), nil)
	if dialErr != nil {
		t.Fatalf("ws dial failed: %v", dialErr)
	}
	defer ws.Close()

	// The registered goroutine ticks after the upgrade handshake completes; poll
	// briefly so the count is observed rather than racing the register channel.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && h.GetClientCount() != 1 {
		time.Sleep(10 * time.Millisecond)
	}
	if got := h.GetClientCount(); got != 1 {
		t.Fatalf("expected 1 connected client, got %d", got)
	}

	alert := map[string]any{
		"id":           uuid.New().String(),
		"fingerprint":  "d2c4f6",
		"name":         "HighCPU",
		"severity":     "critical",
		"state":        "firing",
		"startsAt":     "2026-10-14T18:00:00Z",
		"labels":       map[string]string{"system": "auth-service"},
		"annotations":  map[string]string{"description": "cpu > 90"},
		"generatorURL": "http://prometheus:9090/graph",
	}
	payload, _ := json.Marshal(alert)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/internal/alerts/broadcast", strings.NewReader(string(payload)))
	req.Header.Set("X-Internal-Secret", "correct-secret")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on valid broadcast, got %d body=%s", w.Code, w.Body.String())
	}

	ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, msg, readErr := ws.ReadMessage()
	if readErr != nil {
		t.Fatalf("client never received broadcast: %v", readErr)
	}
	var got model.WebSocketMessage
	if err := json.Unmarshal(msg, &got); err != nil {
		t.Fatalf("bad ws message json: %v", err)
	}
	if got.Type != model.WSMsgTypeAlertUpdate {
		t.Fatalf("expected type %q, got %q", model.WSMsgTypeAlertUpdate, got.Type)
	}
	gotData, ok := got.Data.(map[string]any)
	if !ok {
		t.Fatalf("expected map data, got %T", got.Data)
	}
	if gotData["name"] != "HighCPU" || gotData["severity"] != "critical" {
		t.Fatalf("alert data not forwarded verbatim: %v", gotData)
	}
}

var _ = io.EOF // keep io referenced for future binary assertions
