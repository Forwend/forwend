package invoiceapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/document"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

func invoicePDF(invoices *invoice.Service, profiles *profile.Service, webURL string) http.HandlerFunc {
	return servePDF(invoices, profiles, webURL, "invoice", document.Invoice)
}

func receiptPDF(invoices *invoice.Service, profiles *profile.Service, webURL string) http.HandlerFunc {
	return servePDF(invoices, profiles, webURL, "receipt", document.Receipt)
}

func servePDF(invoices *invoice.Service, profiles *profile.Service, webURL, kind string,
	render func(invoice.Invoice, string, []byte) ([]byte, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Get(r.Context(), r.PathValue("payToken"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		// R-135: the store's logo, when its invoice has one.
		var logo []byte
		if inv.LogoAt != nil {
			if logo, _, err = profiles.StoreLogo(r.Context(), inv.StoreID); err != nil && !errors.Is(err, profile.ErrNoLogo) {
				httpio.WriteError(w, r, err)
				return
			}
		}
		pdf, err := render(inv, webURL+"/pay/"+inv.PayToken, logo)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		// The same invoice gives the same bytes, so their hash changes exactly when the file does.
		sum := sha256.Sum256(pdf)
		w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:16])+`"`)
		w.Header().Set("Cache-Control", "private, no-cache")
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition",
			`attachment; filename="forwend-`+document.Number(inv.Number)+"-"+kind+`.pdf"`)
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(pdf))
	}
}
