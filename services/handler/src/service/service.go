package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"newproject/services/handler/src/config"
)

// HandlerService acts as a layer between the API controller and the biometric service.
// It manages state transitions and interfaces with the biometric core via HTTP.
type HandlerService struct {
	biometricEndpoint string
	httpClient        *http.Client
}

// NewHandlerService creates a new HandlerService
func NewHandlerService(cfg *config.Config) *HandlerService {
	return &HandlerService{
		biometricEndpoint: cfg.Biometric.EndpointURL(),
		httpClient: &http.Client{
			Timeout: cfg.Biometric.Timeout,
		},
	}
}

// BeginRegistration calls the biometric service to start a registration ceremony.
func (s *HandlerService) BeginRegistration(
	ctx context.Context,
	userID string,
) (string, error) { // returns base64url challenge
	reqBody := map[string]string{"userID": userID}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.biometricEndpoint+"/registrations/begin", httpBody(jsonData))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("biometric service returned status %d", resp.StatusCode)
	}

	var respData struct {
		Challenge string `json:"challenge"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&respData); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	return respData.Challenge, nil
}

// FinishRegistration calls the biometric service to complete a registration ceremony.
func (s *HandlerService) FinishRegistration(
	ctx context.Context,
	userID string,
	credentialID string,
	publicKey string,
	signCount uint32,
) error {
	reqBody := map[string]interface{}{
		"userID":     userID,
		"credentialID": credentialID,
		"publicKey":  publicKey,
		"signCount":  signCount,
	}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.biometricEndpoint+"/registrations/finish", httpBody(jsonData))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("biometric service returned status %d", resp.StatusCode)
	}
	return nil
}

// BeginAuthentication calls the biometric service to start an authentication ceremony.
func (s *HandlerService) BeginAuthentication(
	ctx context.Context,
	userID string,
) (string, error) { // returns base64url challenge
	reqBody := map[string]string{"userID": userID}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.biometricEndpoint+"/authentications/begin", httpBody(jsonData))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("biometric service returned status %d", resp.StatusCode)
	}

	var respData struct {
		Challenge string `json:"challenge"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&respData); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	return respData.Challenge, nil
}

// FinishAuthentication calls the biometric service to complete an authentication ceremony.
func (s *HandlerService) FinishAuthentication(
	ctx context.Context,
	userID string,
	credentialID string,
	signature string,
	authData string,
	newSignCount uint32,
) error {
	reqBody := map[string]interface{}{
		"userID":     userID,
		"credentialID": credentialID,
		"signature":  signature,
		"authData":   authData,
		"newSignCount": newSignCount,
	}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.biometricEndpoint+"/authentications/finish", httpBody(jsonData))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("biometric service returned status %d", resp.StatusCode)
	}
	return nil
}

// httpBody converts a byte slice to an io.ReadSeeker
func httpBody(data []byte) *httpioReader {
	return &httpioReader{data: data}
}

// httpioReader implements io.ReadSeeker from a byte slice
type httpioReader struct {
	data []byte
	off  int
}

func (r *httpioReader) Read(p []byte) (int, error) {
	if r.off >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.off:])
	r.off += n
	return n, nil
}

func (r *httpioReader) Seek(offset int64, whence int) (int64, error) {
	var newOff int64
	switch whence {
	case io.SeekStart:
		newOff = offset
	case io.SeekCurrent:
		newOff = int64(r.off) + offset
	case io.SeekEnd:
		newOff = int64(len(r.data)) + offset
	default:
		return 0, fmt.Errorf("invalid whence")
	}
	if newOff < 0 || newOff > int64(len(r.data)) {
		return 0, fmt.Errorf("invalid offset")
	}
	r.off = int(newOff)
	return newOff, nil
}
