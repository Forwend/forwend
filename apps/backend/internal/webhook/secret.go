package webhook

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

// newSecret is a Standard Webhooks secret: whsec_ and the base64 of the 32 bytes the HMAC uses.
func newSecret() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "whsec_" + base64.StdEncoding.EncodeToString(b)
}

// seal encrypts a secret with WEBHOOK_SECRET_KEY, bound to its endpoint: a sealed secret moved to another endpoint's
// row doesn't open.
func (s *Service) seal(endpointID, text string) ([]byte, error) {
	gcm, err := s.aead()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	_, _ = rand.Read(nonce)
	return gcm.Seal(nonce, nonce, []byte(text), []byte(endpointID)), nil
}

func (s *Service) open(endpointID string, sealed []byte) (string, error) {
	gcm, err := s.aead()
	if err != nil {
		return "", err
	}
	if len(sealed) < gcm.NonceSize() {
		return "", errors.New("open webhook secret: too short")
	}
	text, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], []byte(endpointID))
	if err != nil {
		return "", fmt.Errorf("open webhook secret of %s: %w", endpointID, err)
	}
	return string(text), nil
}

func (s *Service) aead() (cipher.AEAD, error) {
	if s.key == nil {
		return nil, ErrNotConfigured
	}
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return nil, fmt.Errorf("webhook secret key: %w", err)
	}
	return cipher.NewGCM(block)
}
