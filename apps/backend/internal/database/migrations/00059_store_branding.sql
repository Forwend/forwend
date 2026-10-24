-- Store branding (R-135, D-32): an accent color and a logo, which the API keeps as a PNG it encoded itself.

-- +goose Up
ALTER TABLE stores
    ADD COLUMN brand_color text CHECK (brand_color ~ '^#[0-9a-f]{6}$'),
    -- 1024 px a side, 8-bit RGBA, encodes to at most about 4.2 MB, even from a 1 MB upload.
    ADD COLUMN logo bytea CHECK (octet_length(logo) BETWEEN 1 AND 5242880),
    ADD COLUMN logo_at timestamptz,
    ADD CONSTRAINT stores_logo_at CHECK ((logo IS NULL) = (logo_at IS NULL));

-- +goose Down
ALTER TABLE stores DROP COLUMN brand_color, DROP COLUMN logo, DROP COLUMN logo_at;
