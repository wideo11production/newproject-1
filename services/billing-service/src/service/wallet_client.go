// WalletCreditService HTTP client — wallet-service ke Credit endpoint par call karta hai.
//
// YEH FILE WalletCreditService interface ka REAL implementation hai jo
// wallet-service ke /wallets/credit endpoint pe HTTP POST karta hai.
// Billing-service apne wallet-service ke Go module ko import nahi karta
// (cross-module design), isliye yeh HTTP client via standard library bana hai.
//
// Flow:
//  1. NewWalletServiceClient(url, timeout) — client banate waqt URL dena zaroori.
//  2. Credit() — wallet-service pe POST /wallets/credit karta hai.
//  3. txRef — wallet-service se aane wala transaction UUID (retry/audit ke liye).
//
// Hinglish: is client ka design intentionally simple hai — retry logic nahi,
// authentication nahi (local Docker network me service-to-service trust).
// Agar retry chahiye ho to caller (settlement engine) se handle karo.
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/shopspring/decimal"
)

// WalletServiceClient — HTTP client to wallet-service.
//
// Hinglish: ye struct sirf configuration rakhta hai (URL, HTTP client, timeout).
// Har Credit() call ek naya HTTP request banata hai.
type WalletServiceClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewWalletServiceClient creates a new wallet-service HTTP client.
//
// baseURL: wallet-service ka base URL (e.g. "http://wallet-service:8080" ya
//         Docker network pe "http://wallet-service:8080").
// timeout: request timeout (0 = 30s default).
func NewWalletServiceClient(baseURL string, timeout time.Duration) *WalletServiceClient {
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	return &WalletServiceClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

// walletCreditRequest — wallet-service ke /wallets/credit endpoint ka request body.
type walletCreditRequest struct {
	UserID      uint            `json:"user_id"`
	Currency    string          `json:"currency"`
	Amount      decimal.Decimal `json:"amount"`
	ReferenceID string          `json:"reference_id"`
	Description string          `json:"description"`
}

// walletCreditResponse — wallet-service ke Credit endpoint ka response body.
type walletCreditResponse struct {
	Transaction *walletTransaction `json:"transaction"`
}

// walletTransaction — minimal transaction struct jo humein sirf txRef chahiye.
type walletTransaction struct {
	ID    uint   `json:"id"`
	UUID  string `json:"uuid"`
}

// Credit wallet-service pe POST karta hai aur transaction UUID return karta hai.
//
// Yeh method WalletCreditService interface ko satisfy karta hai.
// Agar wallet-service se error aaye (non-201 status) to yeh error return karta
// hai jise settlement engine handle karta hai (SettlementFailed status).
//
// Hinglish: amount ko decimal.Decimal bhej rahe hain — wallet-service bhi
// decimal.Decimal use karta hai (shopspring/decimal), isliye precision loss nahi.
func (c *WalletServiceClient) Credit(ctx context.Context, userID uint, currency string,
	amount decimal.Decimal, refType, refID, description string,
) (txRef string, err error) {

	if amount.LessThanOrEqual(decimal.Zero) {
		return "", fmt.Errorf("wallet credit: amount must be positive, got %s", amount.String())
	}

	payload := walletCreditRequest{
		UserID:      userID,
		Currency:    currency,
		Amount:      amount,
		ReferenceID: refID,
		Description: description,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("wallet credit: request marshal failed: %w", err)
	}

	url := c.baseURL + "/wallets/credit"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("wallet credit: request creation failed: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("wallet credit: HTTP call failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("wallet credit: unexpected status %d from wallet-service", resp.StatusCode)
	}

	var result walletCreditResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("wallet credit: response decode failed: %w", err)
	}

	if result.Transaction == nil {
		return "", fmt.Errorf("wallet credit: nil transaction in response")
	}

	// UUID use as txRef — globally unique, cross-service safe.
	txRef = result.Transaction.UUID
	if txRef == "" && result.Transaction.ID != 0 {
		txRef = fmt.Sprintf("txn-%d", result.Transaction.ID)
	}

	return txRef, nil
}
