package tests

import (
	"errors"
	"net/http"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func TestCheckoutPaymentsNeverIssueInvoiceDocuments(t *testing.T) {
	e := invoiceAPI(t)
	ctx := t.Context()
	shop := e.merchant(t)
	s := invoice.NewService(e.pool)
	r := invoice.Request{Purpose: invoice.PurposeCheckout, ChainID: 84532, Token: usdc, Amount: "2000000",
		Details: invoice.Details{Title: "Purchase", Reference: "order-42"}}
	inv, created, err := s.Create(ctx, shop, "checkout", r)
	if err != nil || !created || inv.Number != nil || inv.Purpose != invoice.PurposeCheckout || inv.DocumentKind != invoice.DocumentNone {
		t.Fatalf("checkout: %+v, created %v, %v", inv, created, err)
	}
	if again, created, err := s.Create(ctx, shop, "checkout", r); err != nil || created || again.ID != inv.ID {
		t.Fatalf("retry: %+v, created %v, %v", again, created, err)
	}
	legacy := r
	legacy.Purpose = ""
	if _, _, err := s.Create(ctx, shop, "checkout", legacy); !errors.Is(err, invoice.ErrConflict) {
		t.Fatalf("legacy create reuses checkout key: %v, want conflict", err)
	}
	if pdf := e.pdf(t, inv.ID, "invoice.pdf", ""); pdf.status != http.StatusNotFound {
		t.Fatalf("checkout invoice PDF: %d", pdf.status)
	}
	if pdf := e.pdf(t, inv.ID, "receipt.pdf", ""); pdf.status != http.StatusConflict {
		t.Fatalf("unpaid receipt: %d", pdf.status)
	}
	for _, assignment := range []string{"purpose = 'invoice', document_kind = 'invoice', number = 2", "reference = 'another-order'"} {
		if _, err := e.pool.Exec(ctx, "UPDATE invoices SET "+assignment+" WHERE id = $1", inv.ID); err == nil {
			t.Fatalf("checkout mutation accepted: %s", assignment)
		}
	}
	e.deposit(t, inv.ID, "2000000")
	paid := e.get(t, inv.ID)
	if paid.status != http.StatusOK || paid.body["paymentStatus"] != "paid" || paid.body["number"] != nil ||
		paid.body["purpose"] != "checkout" || paid.body["documentKind"] != "none" {
		t.Fatalf("paid checkout: %d %v", paid.status, paid.body)
	}
	if pdf := e.pdf(t, inv.ID, "invoice.pdf", ""); pdf.status != http.StatusNotFound {
		t.Fatalf("paid checkout invoice PDF: %d", pdf.status)
	}
	if pdf := e.pdf(t, inv.ID, "receipt.pdf", ""); pdf.status != http.StatusOK {
		t.Fatalf("paid checkout receipt: %d %s", pdf.status, pdf.body)
	}
	bill, _, err := s.Create(ctx, shop, "invoice", legacy)
	if err != nil || bill.Number == nil || *bill.Number != 1 || bill.Purpose != invoice.PurposeInvoice || bill.DocumentKind != invoice.DocumentInvoice {
		t.Fatalf("first actual invoice: %+v, %v", bill, err)
	}
}

func TestHeldCheckoutDoesNotBreakBillingOwedList(t *testing.T) {
	e := invoiceAPI(t)
	shop := e.merchant(t)
	inv, _, err := invoice.NewService(e.pool).Create(t.Context(), shop, "held-checkout", invoice.Request{
		Purpose: invoice.PurposeCheckout, ChainID: 84532, Token: usdc, Amount: "2000000"})
	if err != nil {
		t.Fatal(err)
	}
	e.deposit(t, inv.ID, "2500000")
	got := e.call(t, "GET", "/v1/profiles/"+shop+"/owed", "did:privy:alice", "", "")
	if got.status != http.StatusOK {
		t.Fatalf("held checkout broke billing reads: %d %v", got.status, got.body)
	}
	if items, ok := got.body["items"].([]any); !ok || len(items) != 0 {
		t.Fatalf("checkout appeared as a billing document: %v", got.body)
	}
}
