package model

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
)

var ErrInvalidKey = errors.New("invalid VAPID key")

func GenerateVAPIDKeys() (string, string, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}

	privateKeyBytes, err := x509.MarshalECPrivateKey(privateKey)
	if err != nil {
		return "", "", err
	}

	pemPrivateKey := pem.EncodeToMemory(&pem.Block{
		Type:  "EC PRIVATE KEY",
		Bytes: privateKeyBytes,
	})

	publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return "", "", err
	}

	pemPublicKey := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicKeyBytes,
	})

	return base64.StdEncoding.EncodeToString(pemPublicKey),
		base64.StdEncoding.EncodeToString(pemPrivateKey),
		nil
}

func ParseVAPIDPrivateKey(pemBase64 string) (*ecdsa.PrivateKey, error) {
	pemBytes, err := base64.StdEncoding.DecodeString(pemBase64)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, ErrInvalidKey
	}

	key, err := x509.ParseECPrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}

	return key, nil
}

func VAPIDPublicKeyBase64(privateKey *ecdsa.PrivateKey) (string, error) {
	publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(publicKeyBytes), nil
}

func ParseSubscriptionKey(base64Key string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(base64Key)
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(base64Key)
		if err != nil {
			return nil, err
		}
	}
	return decoded, nil
}
