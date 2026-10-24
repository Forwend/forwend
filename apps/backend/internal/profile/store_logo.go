package profile

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg" // JPEG logos (R-135)
	"image/png"
	"time"

	"github.com/jackc/pgx/v5"
)

// A logo upload is at most MaxLogoBytes, and each side at most MaxLogoSide pixels (R-135).
const (
	MaxLogoBytes = 1 << 20
	MaxLogoSide  = 1024
)

var ErrNoLogo = errors.New("store has no logo")

// SaveStoreLogo keeps upload as a PNG of its pixels, so no metadata or other content it carried is ever served.
func (s *Service) SaveStoreLogo(ctx context.Context, profileID, storeID string, upload []byte) (Store, error) {
	logo, err := logoPNG(upload)
	if err != nil {
		return Store{}, err
	}
	return s.setLogo(ctx, profileID, storeID, logo)
}

// DeleteStoreLogo answers the store, also when it had no logo.
func (s *Service) DeleteStoreLogo(ctx context.Context, profileID, storeID string) (Store, error) {
	return s.setLogo(ctx, profileID, storeID, nil)
}

func (s *Service) setLogo(ctx context.Context, profileID, storeID string, logo []byte) (Store, error) {
	if !lowercaseUUID.MatchString(storeID) {
		return Store{}, ErrStoreNotFound
	}
	rows, err := s.pool.Query(ctx, `UPDATE stores SET logo = $3, logo_at = CASE WHEN $3::bytea IS NULL THEN NULL ELSE now() END,
		updated_at = now() WHERE profile_id = $1 AND id = $2 RETURNING `+storeColumns, profileID, storeID, logo)
	if err != nil {
		return Store{}, fmt.Errorf("save store logo: %w", err)
	}
	st, err := pgx.CollectExactlyOneRow(rows, scanStore)
	if errors.Is(err, pgx.ErrNoRows) {
		return Store{}, ErrStoreNotFound
	}
	if err != nil {
		return Store{}, fmt.Errorf("save store logo: %w", err)
	}
	return st, nil
}

// StoreLogo is public: the store id is the project ID (D-31), and the logo shows on every pay page of the store.
func (s *Service) StoreLogo(ctx context.Context, storeID string) ([]byte, time.Time, error) {
	if !lowercaseUUID.MatchString(storeID) {
		return nil, time.Time{}, ErrNoLogo
	}
	var logo []byte
	var at time.Time
	err := s.pool.QueryRow(ctx, "SELECT logo, logo_at FROM stores WHERE id = $1 AND logo IS NOT NULL", storeID).
		Scan(&logo, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, time.Time{}, ErrNoLogo
	}
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("read store logo: %w", err)
	}
	return logo, at, nil
}

func logoPNG(upload []byte) ([]byte, error) {
	invalid := fmt.Errorf("%w: logo must be a PNG or JPEG of at most %d bytes and %d pixels a side", ErrInvalid,
		MaxLogoBytes, MaxLogoSide)
	if len(upload) > MaxLogoBytes {
		return nil, invalid
	}
	// The size first, so a small file that claims a huge image is refused before it is decoded.
	cfg, format, err := image.DecodeConfig(bytes.NewReader(upload))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 ||
		cfg.Width > MaxLogoSide || cfg.Height > MaxLogoSide {
		return nil, invalid
	}
	img, _, err := image.Decode(bytes.NewReader(upload))
	if err != nil {
		return nil, invalid
	}
	// 8-bit RGBA, which the PDF writer reads: it refuses 16-bit and interlaced PNGs.
	rgba := image.NewNRGBA(img.Bounds())
	draw.Draw(rgba, rgba.Bounds(), img, img.Bounds().Min, draw.Src)
	// It can be larger than the upload: a 1024 px photo makes a PNG of up to about 4.2 MB (migration 00059's limit).
	var out bytes.Buffer
	if err := png.Encode(&out, rgba); err != nil {
		return nil, fmt.Errorf("encode store logo: %w", err)
	}
	return out.Bytes(), nil
}
