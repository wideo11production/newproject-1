// Wallet client HTTP integration tests.
//
// YEH TESTS use net/http/httptest — koi real wallet-service nahi chahiye.
// Mock server 201 return karta hai, aur client uski request/parse karta hai.
//
// Hinglish: ye tests ensure karte hain ki:
// 1. Request body sahi format me bheja jaaye.
// 2. Response se transaction UUID extract ho sake.
// 3. Non-201 status pe error throw ho.
// 4. amount <= 0 pe error ho.
package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// makeWalletTestServer ek mock wallet-service return karta hai jo Credit
// endpoint ko handle karta hai aur transaction UUID return karta hai.
func makeWalletTestServer(t *testing.T, capturedRequest *walletCreditRequest, status int, txnUUID string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/wallets/credit" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if err := json.NewDecoder(r.Body).Decode(capturedRequest); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"transaction": map[string]interface{}{
				"id":   42,
				"uuid": txnUUID,
			},
		})
	}))
}

func TestWalletServiceClient_CreditSuccess(t *testing.T) {
	var captured walletCreditRequest
	srv := makeWalletTestServer(t, &captured, http.StatusCreated, "txn-uuid-123")
	defer srv.Close()

	client := NewWalletServiceClient(srv.URL, 5*time.Second)

	txRef, err := client.Credit(context.Background(), 101, "INR",
		decimal.NewFromInt(600), "ad_revenue", "evt-001", "Ad revenue share")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if txRef != "txn-uuid-123" {
		t.Errorf("expected txRef txn-uuid-123, got %s", txRef)
	}

	if captured.UserID != 101 {
		t.Errorf("UserID: expected 101, got %d", captured.UserID)
	}
	if captured.Currency != "INR" {
		t.Errorf("Currency: expected INR, got %s", captured.Currency)
	}
	if !captured.Amount.Equal(decimal.NewFromInt(600)) {
		t.Errorf("Amount: expected 600, got %s", captured.Amount.String())
	}
	if captured.ReferenceID != "evt-001" {
		t.Errorf("ReferenceID: expected evt-001, got %s", captured.ReferenceID)
	}
	if captured.Description != "Ad revenue share" {
		t.Errorf("Description: expected 'Ad revenue share', got %s", captured.Description)
	}
}

func TestWalletServiceClient_CreditHTTPError(t *testing.T) {
	var captured walletCreditRequest
	srv := makeWalletTestServer(t, &captured, http.StatusInternalServerError, "")
	defer srv.Close()

	client := NewWalletServiceClient(srv.URL, 5*time.Second)

	_, err := client.Credit(context.Background(), 101, "INR",
		decimal.NewFromInt(600), "ad_revenue", "evt-002", "desc")
	if err == nil {
		t.Fatal("expected error for 500 status, got nil")
	}
}

func TestWalletServiceClient_CreditZeroAmount(t *testing.T) {
	client := NewWalletServiceClient("http://localhost:9999", 5*time.Second)

	_, err := client.Credit(context.Background(), 101, "INR",
		decimal.Zero, "ad_revenue", "evt-003", "desc")
	if err == nil {
		t.Fatal("expected error for zero amount, got nil")
	}
}

func TestWalletServiceClient_CreditNegativeAmount(t *testing.T) {
	client := NewWalletServiceClient("http://localhost:9999", 5*time.Second)

	_, err := client.Credit(context.Background(), 101, "INR",
		decimal.NewFromInt(-100), "ad_revenue", "evt-004", "desc")
	if err == nil {
		t.Fatal("expected error for negative amount, got nil")
	}
}

func TestWalletServiceClient_CreditNilTransaction(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"transaction": nil,
		})
	}))
	defer srv.Close()

	client := NewWalletServiceClient(srv.URL, 5*time.Second)

	_, err := client.Credit(context.Background(), 101, "INR",
		decimal.NewFromInt(600), "ad_revenue", "evt-005", "desc")
	if err == nil {
		t.Fatal("expected error for nil transaction, got nil")
	}
}

// TestWalletServiceClient_CreditSatisfiesInterface — compile-time check
// that WalletServiceClient implements WalletCreditService interface.
func TestWalletServiceClient_CreditSatisfiesInterface(t *testing.T) {
	var _ WalletCreditService = (*WalletServiceClient)(nil)
}
