package jobapi

import (
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
)

type createJobBody struct {
	Title    string `json:"title"`
	Scope    string `json:"scope"`
	Payments []struct {
		Title     string `json:"title"`
		AmountUSD string `json:"amountUsd"`
		DueDays   int    `json:"dueDays"`
		OnAccept  bool   `json:"onAccept"`
	} `json:"payments"`
	Client struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Address string `json:"address"`
		Country string `json:"country"`
		TaxID   string `json:"taxId"`
	} `json:"client"`
}

type acceptBody struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// publicJobJSON is a job as its client's link shows it: no client block and no typed email.
type publicJobJSON struct {
	Title        string        `json:"title"`
	Scope        *string       `json:"scope"`
	Issuer       issuerJSON    `json:"issuer"`
	Payments     []paymentJSON `json:"payments"`
	TotalUSD     string        `json:"totalUsd"`
	AcceptedName *string       `json:"acceptedName"`
	AcceptedAt   *string       `json:"acceptedAt"`
	CreatedAt    string        `json:"createdAt"`
}

// jobJSON is a job read by its owner: the public view plus its id, link token, client and the typed email.
type jobJSON struct {
	JobID string `json:"jobId"`
	Token string `json:"token"`
	publicJobJSON
	// The public payments with each change's typed email; it shadows the embedded field.
	Payments      []ownerPaymentJSON `json:"payments"`
	Client        clientJSON         `json:"client"`
	AcceptedEmail *string            `json:"acceptedEmail"`
}

// paymentJSON is one payment; invoiceId, number, status and invoicedAt are null until its invoice is made, doneAt and
// deliveryLink until the owner marks the step done, paidAt until it is paid.
type paymentJSON struct {
	Position     int     `json:"position"`
	Title        string  `json:"title"`
	AmountUSD    string  `json:"amountUsd"`
	DueDays      int     `json:"dueDays"`
	OnAccept     bool    `json:"onAccept"`
	InvoiceID    *string `json:"invoiceId"`
	Number       *int64  `json:"number"`
	Status       *string `json:"status"`
	DoneAt       *string `json:"doneAt"`
	DeliveryLink *string `json:"deliveryLink"`
	InvoicedAt   *string `json:"invoicedAt"`
	PaidAt       *string `json:"paidAt"`
	// A scope change (R-105): null for the quote's payments, and acceptedName and acceptedAt until the client accepts.
	ProposedAt   *string `json:"proposedAt"`
	AcceptedName *string `json:"acceptedName"`
	AcceptedAt   *string `json:"acceptedAt"`
}

// ownerPaymentJSON adds, for the owner only, the client's typed email on an accepted change and whether the client
// was emailed about the change (R-107).
type ownerPaymentJSON struct {
	paymentJSON
	AcceptedEmail *string `json:"acceptedEmail"`
	ClientEmailed bool    `json:"clientEmailed"`
}

type issuerJSON struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Country string  `json:"country"`
	TaxID   *string `json:"taxId"`
	Email   string  `json:"email"`
}

type clientJSON struct {
	Name    string  `json:"name"`
	Email   string  `json:"email"`
	Address *string `json:"address"`
	Country *string `json:"country"`
	TaxID   *string `json:"taxId"`
}

type jobSummaryJSON struct {
	JobID      string  `json:"jobId"`
	Title      string  `json:"title"`
	ClientName string  `json:"clientName"`
	TotalUSD   string  `json:"totalUsd"`
	Payments   int     `json:"payments"`
	Paid       int     `json:"paid"`
	AcceptedAt *string `json:"acceptedAt"`
	CreatedAt  string  `json:"createdAt"`
}

func toPublicJobJSON(j job.Job) publicJobJSON {
	out := publicJobJSON{Title: j.Title, Scope: httpio.OrNull(j.Scope), TotalUSD: job.USD(j.TotalCents()),
		Issuer: issuerJSON{Name: j.Issuer.Name, Address: j.Issuer.Address, Country: j.Issuer.Country,
			TaxID: httpio.OrNull(j.Issuer.TaxID), Email: j.Issuer.Email},
		AcceptedName: httpio.OrNull(j.AcceptedName), AcceptedAt: httpio.OrNullTime(j.AcceptedAt),
		CreatedAt: j.CreatedAt.Format(time.RFC3339), Payments: []paymentJSON{}}
	for _, p := range j.Payments {
		pj := paymentJSON{Position: p.Position, Title: p.Title, AmountUSD: job.USD(p.AmountCents), DueDays: p.DueDays,
			OnAccept: p.OnAccept, InvoiceID: httpio.OrNull(p.InvoiceID), Status: httpio.OrNull(p.Status),
			DoneAt: httpio.OrNullTime(p.DoneAt), DeliveryLink: httpio.OrNull(p.DeliveryLink),
			InvoicedAt: httpio.OrNullTime(p.InvoicedAt), PaidAt: httpio.OrNullTime(p.PaidAt),
			ProposedAt: proposedAt(p.ProposedAt), AcceptedName: httpio.OrNull(p.AcceptedName),
			AcceptedAt: httpio.OrNullTime(p.AcceptedAt)}
		if p.InvoiceID != "" {
			pj.Number = &p.Number
		}
		out.Payments = append(out.Payments, pj)
	}
	return out
}

// proposedAt keeps the microseconds the database stores: the client's accept names the change by it (R-105).
func proposedAt(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	return httpio.OrNull(t.Format(time.RFC3339Nano))
}

func toJobJSON(j job.Job) jobJSON {
	c := j.Client
	out := jobJSON{JobID: j.ID, Token: j.Token, publicJobJSON: toPublicJobJSON(j), Payments: []ownerPaymentJSON{},
		Client: clientJSON{Name: c.Name, Email: c.Email, Address: httpio.OrNull(c.Address),
			Country: httpio.OrNull(c.Country), TaxID: httpio.OrNull(c.TaxID)},
		AcceptedEmail: httpio.OrNull(j.AcceptedEmail)}
	for i, p := range out.publicJobJSON.Payments {
		out.Payments = append(out.Payments, ownerPaymentJSON{paymentJSON: p,
			AcceptedEmail: httpio.OrNull(j.Payments[i].AcceptedEmail), ClientEmailed: j.Payments[i].ClientEmailed})
	}
	return out
}

func toJobSummaryJSON(s job.Summary) jobSummaryJSON {
	return jobSummaryJSON{JobID: s.ID, Title: s.Title, ClientName: s.ClientName, TotalUSD: job.USD(s.TotalCents),
		Payments: s.Payments, Paid: s.Paid, AcceptedAt: httpio.OrNullTime(s.AcceptedAt),
		CreatedAt: s.CreatedAt.Format(time.RFC3339)}
}
