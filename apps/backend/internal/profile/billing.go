package profile

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Longest billing details, in characters (R-43).
const (
	MaxBillingName    = 200
	MaxBillingAddress = 500
	MaxBillingTaxID   = 50
	MaxBillingEmail   = 254 // the longest address SMTP carries (RFC 5321)
)

var ErrNoBillingDetails = errors.New("no billing details")

// R-43: only TaxID is optional ("" means none).
type Issuer struct {
	Name    string
	Address string
	Country string // ISO 3166-1 alpha-2, upper case
	TaxID   string
	Email   string
}

type BillingDetails struct {
	Issuer
	UpdatedAt time.Time
}

// countries are the assigned ISO 3166-1 alpha-2 codes (249, as in the tz database's iso3166.tab).
const countries = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT " +
	"BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ " +
	"FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS " +
	"IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN " +
	"MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
	"PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN " +
	"TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"

var countryCode = regexp.MustCompile(`^[A-Z]{2}$`)

func ValidCountry(code string) bool {
	return countryCode.MatchString(code) && strings.Contains(countries, code)
}

func (d BillingDetails) check() error {
	for _, f := range []struct{ name, value string }{
		{"name", d.Name}, {"address", d.Address}, {"country", d.Country}, {"email", d.Email},
	} {
		if f.value == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalid, f.name)
		}
	}
	for _, f := range []struct {
		name, value string
		max         int
		lines       bool
	}{
		{"name", d.Name, MaxBillingName, false}, {"address", d.Address, MaxBillingAddress, true},
		{"taxId", d.TaxID, MaxBillingTaxID, false}, {"email", d.Email, MaxBillingEmail, false},
	} {
		// Postgres text can't hold a NUL byte.
		if !utf8.ValidString(f.value) || utf8.RuneCountInString(f.value) > f.max || !PlainText(f.value, f.lines) {
			return fmt.Errorf("%w: %s must be at most %d characters of plain text", ErrInvalid, f.name, f.max)
		}
	}
	if Impersonates(d.Name) {
		return fmt.Errorf("%w: name can't name Forwend", ErrInvalid)
	}
	if !ValidCountry(d.Country) {
		return fmt.Errorf("%w: country must be an ISO 3166-1 alpha-2 code like DE", ErrInvalid)
	}
	if a, err := mail.ParseAddress(d.Email); err != nil || a.Address != d.Email {
		return fmt.Errorf("%w: email must be an email address like name@example.com", ErrInvalid)
	}
	return nil
}

// Invoices made earlier keep their own copy. The caller has checked that the user owns the profile.
func (s *Service) SaveBillingDetails(ctx context.Context, profileID string, d BillingDetails) (BillingDetails, error) {
	if err := d.check(); err != nil {
		return BillingDetails{}, err
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO profile_billing_details (profile_id, name, address, country, tax_id, contact_email)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6)
		ON CONFLICT (profile_id) DO UPDATE SET name = excluded.name, address = excluded.address,
		    country = excluded.country, tax_id = excluded.tax_id, contact_email = excluded.contact_email,
		    updated_at = now()
		RETURNING updated_at`, profileID, d.Name, d.Address, d.Country, d.TaxID, d.Email).Scan(&d.UpdatedAt)
	if err != nil {
		return BillingDetails{}, fmt.Errorf("save billing details: %w", err)
	}
	return d, nil
}

// The caller has checked that the user owns the profile.
func (s *Service) BillingDetails(ctx context.Context, profileID string) (BillingDetails, error) {
	var d BillingDetails
	err := s.pool.QueryRow(ctx, `SELECT name, address, country, coalesce(tax_id, ''), contact_email, updated_at FROM profile_billing_details WHERE profile_id = $1`, profileID).
		Scan(&d.Name, &d.Address, &d.Country, &d.TaxID, &d.Email, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return BillingDetails{}, ErrNoBillingDetails
	}
	if err != nil {
		return BillingDetails{}, fmt.Errorf("read billing details: %w", err)
	}
	return d, nil
}
