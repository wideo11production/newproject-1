package service

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"newproject/services/push-service/src/model"
	"newproject/services/push-service/src/repository"
)

var (
	ErrDeliveryFailed      = fmt.Errorf("push delivery failed")
	ErrUnreachableEndpoint = fmt.Errorf("endpoint unreachable")
)

type PushDeliveryResult struct {
	Success    bool
	StatusCode int
	Err        error
	Retryable  bool
}

type PushService struct {
	subRepo           repository.SubscriptionRepository
	msgRepo           repository.MessageRepository
	vapidPrivateKey   *ecdsa.PrivateKey
	vapidPublicKey    *ecdsa.PublicKey
	vapidSubject      string
	httpClient        *http.Client
	maxRetries        int
	batchSize         int
	rateLimitInterval time.Duration
}

func NewPushService(
	subRepo repository.SubscriptionRepository,
	msgRepo repository.MessageRepository,
	vapidPrivateKeyPem string,
	vapidPublicKeyPem string,
	vapidSubject string,
	maxRetries int,
	batchSize int,
	rateLimitInterval time.Duration,
) (*PushService, error) {
	privKey, err := model.ParseVAPIDPrivateKey(vapidPrivateKeyPem)
	if err != nil {
		return nil, fmt.Errorf("failed to parse VAPID private key: %w", err)
	}

	pubKeyBytes, err := base64.StdEncoding.DecodeString(vapidPublicKeyPem)
	if err != nil {
		return nil, fmt.Errorf("failed to decode VAPID public key: %w", err)
	}
	pubAny, err := x509.ParsePKIXPublicKey(pubKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse VAPID public key: %w", err)
	}
	pubKey, ok := pubAny.(*ecdsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("VAPID public key is not ECDSA")
	}

	return &PushService{
		subRepo:           subRepo,
		msgRepo:           msgRepo,
		vapidPrivateKey:   privKey,
		vapidPublicKey:    pubKey,
		vapidSubject:      vapidSubject,
		httpClient:        &http.Client{Timeout: 30 * time.Second},
		maxRetries:        maxRetries,
		batchSize:         batchSize,
		rateLimitInterval: rateLimitInterval,
	}, nil
}

// SendMessage — single-user push message (existing API).
// Hinglish: ek specific user ke liye push bhejta hai. Database me msg record
// hota hai, phir processMessage se delivery attempt hoti hai.
func (s *PushService) SendMessage(ctx context.Context, userID uint, title, body, icon, urlStr, tag string) (*model.PushMessage, error) {
	msg := &model.PushMessage{
		MessageID: uuid.New(),
		UserID:    userID,
		Title:     title,
		Body:      body,
		Icon:      icon,
		URL:       urlStr,
		Tag:       tag,
		Status:    "pending",
		TTL:       2419200,
	}
	if err := s.msgRepo.Create(ctx, msg); err != nil {
		return nil, err
	}
	go s.processMessage(ctx, msg)
	return msg, nil
}

func (s *PushService) GetMessageStatus(ctx context.Context, id uint) (*model.PushMessage, error) {
	return s.msgRepo.GetByID(ctx, id)
}

func (s *PushService) Unsubscribe(ctx context.Context, id uint) error {
	return s.subRepo.DeleteByID(ctx, id)
}

func (s *PushService) UnsubscribeByUser(ctx context.Context, userID uint) error {
	return s.subRepo.DeleteByUserID(ctx, userID)
}

// Subscribe — user ka device subscription save karta hai (with optional creator binding).
// Hinglish: browser se WebPush subscription aata hai — endpoint, p256dh,
// auth_secret ke saath. Agar creator_id diya gaya hai to ye subscription
// sirf us creator ke live stream notifications ke liye bind ho jayega.
func (s *PushService) Subscribe(ctx context.Context, sub *model.PushSubscription) error {
	existing, err := s.subRepo.GetByEndpoint(ctx, sub.Endpoint)
	if err != nil && !errors.Is(err, repository.ErrSubscriptionNotFound) {
		return err
	}
	if existing != nil {
		existing.P256DH = sub.P256DH
		existing.AuthSecret = sub.AuthSecret
		existing.UserAgent = sub.UserAgent
		return s.subRepo.Update(ctx, existing)
	}
	return s.subRepo.Create(ctx, sub)
}

// BroadcastToCreatorFollowers — jab ek creator apna live stream shuru karta hai,
// to sirf uss creator ke followers ko real-time WebPush bhejta hai.
//
// Hinglish: NATS JetStream se `live.stream.start` event aata hai, jismein
// creator_id hota hai. Is function ko turant call karte hue sabhi jinke
// CreatorID is creator ke barabar set hain, unke devices par push jaayega.
//
// Yeh zero-cost broadcast hai — sirf local NATS + local WebPush, koi
// paid third-party (Firebase, OneSignal) nahi. Sabhi push subscription
// database me stored hain, aur delivery direct browser endpoints par hoti
// hai via encrypted AES-GCM payload.
func (s *PushService) BroadcastToCreatorFollowers(ctx context.Context, creatorID uint, title, body, icon, urlStr, tag string) (int, error) {
	subs, err := s.subRepo.GetByCreatorID(ctx, creatorID)
	if err != nil {
		return 0, fmt.Errorf("broadcast: failed to get creator subscriptions: %w", err)
	}

	delivered := 0
	for _, sub := range subs {
		// Create a transient push message record for auditing.
		msg := &model.PushMessage{
			MessageID:  uuid.New(),
			UserID:     sub.UserID,
			Title:      title,
			Body:       body,
			Icon:       icon,
			URL:        urlStr,
			Tag:        tag,
			Status:     "pending",
			TTL:        2419200,
			CreatorID:  &creatorID,
		}
		if err := s.msgRepo.Create(ctx, msg); err != nil {
			log.Warn().Err(err).Uint("user_id", sub.UserID).Msg("failed to record broadcast message")
			continue
		}

		// Deliver in a goroutine for parallel fan-out.
		go func(sub *model.PushSubscription, msg *model.PushMessage) {
			result := s.deliver(ctx, sub, msg)
			if result.Success {
				msg.Status = "delivered"
			} else {
				msg.Status = "failed"
				msg.LastError = result.Err.Error()
			}
			now := time.Now()
			msg.DeliveredAt = &now
			_ = s.msgRepo.Update(ctx, msg)
		}(sub, msg)

		delivered++
	}

	log.Info().Uint("creator_id", creatorID).Int("recipients", delivered).Msg("live stream broadcast dispatched")
	return delivered, nil
}

// BroadcastToAll — platform-wide broadcast to ALL subscribed devices.
//
// Hinglish: agar koi global event hai (platform maintenance, breaking news,
// etc.) to sabhi devices ko ek saath bhejne ke liye. CreatorID field NULL
// rehne par ye subscription general broadcast me included hoti hai.
func (s *PushService) BroadcastToAll(ctx context.Context, title, body, icon, urlStr, tag string) (int, error) {
	subs, err := s.subRepo.GetAll(ctx)
	if err != nil {
		return 0, fmt.Errorf("broadcast-all: failed to get subscriptions: %w", err)
	}

	delivered := 0
	for _, sub := range subs {
		msg := &model.PushMessage{
			MessageID:  uuid.New(),
			UserID:     sub.UserID,
			Title:      title,
			Body:       body,
			Icon:       icon,
			URL:        urlStr,
			Tag:        tag,
			Status:     "pending",
			TTL:        2419200,
		}
		if err := s.msgRepo.Create(ctx, msg); err != nil {
			log.Warn().Err(err).Uint("user_id", sub.UserID).Msg("failed to record broadcast-all message")
			continue
		}

		go func(sub *model.PushSubscription, msg *model.PushMessage) {
			result := s.deliver(ctx, sub, msg)
			if result.Success {
				msg.Status = "delivered"
			} else {
				msg.Status = "failed"
				msg.LastError = result.Err.Error()
			}
			now := time.Now()
			msg.DeliveredAt = &now
			_ = s.msgRepo.Update(ctx, msg)
		}(sub, msg)

		delivered++
	}

	log.Info().Int("recipients", delivered).Msg("platform-wide broadcast dispatched")
	return delivered, nil
}

func (s *PushService) processMessage(ctx context.Context, msg *model.PushMessage) {
	subs, err := s.subRepo.GetByUserID(ctx, msg.UserID)
	if err != nil {
		s.markMessageFailed(ctx, msg, err.Error())
		return
	}

	for _, sub := range subs {
		result := s.deliver(ctx, sub, msg)
		if result.Success {
			msg.Status = "delivered"
		} else if result.Retryable {
			msg.DeliveryCount++
			if msg.DeliveryCount < s.maxRetries {
				msg.Status = "pending"
			} else {
				msg.Status = "failed"
			}
			msg.LastError = result.Err.Error()
		} else {
			msg.Status = "failed"
			msg.LastError = result.Err.Error()
		}
		now := time.Now()
		msg.DeliveredAt = &now
		_ = s.msgRepo.Update(ctx, msg)
	}
}

func (s *PushService) markMessageFailed(ctx context.Context, msg *model.PushMessage, errMsg string) {
	msg.Status = "failed"
	msg.LastError = errMsg
	now := time.Now()
	msg.DeliveredAt = &now
	_ = s.msgRepo.Update(ctx, msg)
}

func (s *PushService) deliver(ctx context.Context, sub *model.PushSubscription, msg *model.PushMessage) *PushDeliveryResult {
	plaintext, salt, err := s.encryptPayload(sub, msg)
	if err != nil {
		return &PushDeliveryResult{Success: false, Err: err, Retryable: false}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(plaintext))
	if err != nil {
		return &PushDeliveryResult{Success: false, Err: err, Retryable: true}
	}

	s.setHeaders(req, sub, salt)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return &PushDeliveryResult{Success: false, Err: err, Retryable: true}
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusNoContent {
		return &PushDeliveryResult{Success: true, StatusCode: resp.StatusCode}
	}

	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound || resp.StatusCode == 410 {
		_ = s.subRepo.DeleteByID(ctx, sub.ID)
		return &PushDeliveryResult{Success: false, StatusCode: resp.StatusCode, Err: ErrUnreachableEndpoint, Retryable: false}
	}

	if resp.StatusCode >= 500 {
		return &PushDeliveryResult{Success: false, StatusCode: resp.StatusCode, Err: fmt.Errorf("server error: %d", resp.StatusCode), Retryable: true}
	}

	retryable := resp.StatusCode != 400 && resp.StatusCode != 401 && resp.StatusCode != 403
	return &PushDeliveryResult{Success: false, StatusCode: resp.StatusCode, Err: fmt.Errorf("delivery failed: %d", resp.StatusCode), Retryable: retryable}
}

func (s *PushService) setHeaders(req *http.Request, sub *model.PushSubscription, salt []byte) {
	vapidToken := s.generateVAPIDToken(sub.Endpoint)
	pubKeyDER := s.getPublicKeyDER()

	req.Header.Set("Authorization", "vapid t="+vapidToken)
	req.Header.Set("Crypto-Key", "p256ecdsa="+pubKeyDER)
	req.Header.Set("Encryption", "salt="+base64.RawURLEncoding.EncodeToString(salt))
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("TTL", "2419200")
	req.Header.Set("Urgency", "normal")
	req.Header.Set("Content-Type", "application/octet-stream")
}

func (s *PushService) generateVAPIDToken(endpoint string) string {
	aud := strings.TrimPrefix(endpoint, "https://")
	if idx := strings.Index(aud, "/"); idx != -1 {
		aud = aud[:idx]
	}

	claims := map[string]interface{}{
		"aud": aud,
		"exp": time.Now().Add(12 * time.Hour).Unix(),
		"iat": time.Now().Unix(),
		"sub": s.vapidSubject,
	}

	headerJSON, _ := json.Marshal(map[string]interface{}{
		"alg": "ES256",
		"typ": "JWT",
	})
	payloadJSON, _ := json.Marshal(claims)

	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadJSON)

	h := sha256.Sum256([]byte(headerB64 + "." + payloadB64))
	signed, err := s.vapidPrivateKey.Sign(rand.Reader, h[:], nil)
	if err != nil {
		return ""
	}

	sigBuf := make([]byte, 64)
	rVal := new(big.Int).SetBytes(signed[:len(signed)/2])
	sVal := new(big.Int).SetBytes(signed[len(signed)/2:])
	rVal.FillBytes(sigBuf[:32])
	sVal.FillBytes(sigBuf[32:])

	signature := base64.RawURLEncoding.EncodeToString(sigBuf)
	return headerB64 + "." + payloadB64 + "." + signature
}

func (s *PushService) getPublicKeyDER() string {
	pubKeyDER, err := x509.MarshalPKIXPublicKey(s.vapidPublicKey)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(pubKeyDER)
}

func (s *PushService) encryptPayload(sub *model.PushSubscription, msg *model.PushMessage) ([]byte, []byte, error) {
	plaintext, err := json.Marshal(map[string]interface{}{
		"title": msg.Title,
		"body":  msg.Body,
		"icon":  msg.Icon,
		"url":   msg.URL,
		"tag":   msg.Tag,
	})
	if err != nil {
		return nil, nil, err
	}

	subPubKey, err := parseSubscriptionKey(sub.P256DH)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse subscription p256dh: %w", err)
	}
	subPubKeyX, subPubKeyY := elliptic.UnmarshalCompressed(elliptic.P256(), subPubKey)
	if subPubKeyX == nil {
		return nil, nil, errors.New("invalid subscription public key")
	}

	authSecret, err := parseSubscriptionKey(sub.AuthSecret)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse auth secret: %w", err)
	}

	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, nil, err
	}

	ephemeralKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}

	sharedSecret := computeSharedSecret(subPubKeyX, subPubKeyY, ephemeralKey)

	prk, err := hkdf.Extract(sha256.New, sharedSecret, authSecret)
	if err != nil {
		return nil, nil, err
	}
	derivedKey, err := hkdf.Expand(sha256.New, prk, "WebPush: info\x00", 32)
	if err != nil {
		return nil, nil, err
	}

	block, err := aes.NewCipher(derivedKey)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}

	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	ephemeralPubKey := elliptic.MarshalCompressed(elliptic.P256(), ephemeralKey.X, ephemeralKey.Y)

	result := make([]byte, 0, len(salt)+2+len(ephemeralPubKey)+len(nonce)+len(ciphertext))
	result = append(result, salt...)
	pubLen := make([]byte, 2)
	binary.BigEndian.PutUint16(pubLen, uint16(len(ephemeralPubKey)))
	result = append(result, pubLen...)
	result = append(result, ephemeralPubKey...)
	nonceLen := make([]byte, 2)
	binary.BigEndian.PutUint16(nonceLen, uint16(len(nonce)))
	result = append(result, nonceLen...)
	result = append(result, nonce...)
	result = append(result, ciphertext...)

	return result, salt, nil
}

func computeSharedSecret(pubX, pubY *big.Int, priv *ecdsa.PrivateKey) []byte {
	x, _ := priv.PublicKey.Curve.ScalarMult(pubX, pubY, priv.D.Bytes())
	return x.FillBytes(make([]byte, 32))
}

func parseSubscriptionKey(base64Key string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(base64Key)
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(base64Key)
		if err != nil {
			return nil, err
		}
	}
	return decoded, nil
}
