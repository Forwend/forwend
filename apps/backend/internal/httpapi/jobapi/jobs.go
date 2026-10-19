package jobapi

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// createJob is POST /v1/profiles/{profileId}/jobs (R-100): 201 when created, 200 when the same request is repeated.
func createJob(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := httpio.IdempotencyKey(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		var body createJobBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		req := job.Request{Title: body.Title, Scope: body.Scope, Client: profile.ClientDetails{Name: body.Client.Name,
			Email: body.Client.Email, Address: body.Client.Address, Country: body.Client.Country, TaxID: body.Client.TaxID}}
		for _, p := range body.Payments {
			req.Payments = append(req.Payments, job.PaymentRequest{Title: p.Title, AmountUSD: p.AmountUSD,
				DueDays: p.DueDays, OnAccept: p.OnAccept})
		}
		j, created, err := jobs.Create(r.Context(), r.PathValue("profileId"), key, req)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toJobJSON(j))
	}
}

// listJobs is GET /v1/profiles/{profileId}/jobs: the profile's jobs, newest first.
func listJobs(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := jobs.List(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		items := []jobSummaryJSON{}
		for _, s := range list {
			items = append(items, toJobSummaryJSON(s))
		}
		httpio.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// getJob is GET /v1/profiles/{profileId}/jobs/{jobId}: the owner's read, with the client and the link token.
func getJob(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		j, err := jobs.Get(r.Context(), r.PathValue("profileId"), r.PathValue("jobId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toJobJSON(j))
	}
}

// deleteJob is DELETE /v1/profiles/{profileId}/jobs/{jobId} (R-101): 204 before the client accepts it, 409
// job_accepted after.
func deleteJob(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := jobs.Delete(r.Context(), r.PathValue("profileId"), r.PathValue("jobId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// markDone is POST /v1/profiles/{profileId}/jobs/{jobId}/payments/{position}/done (R-103): {"deliveryLink"}; 200 with
// the job, the same when the payment already has its invoice.
func markDone(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DeliveryLink string `json:"deliveryLink"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		position, err := strconv.Atoi(r.PathValue("position"))
		if err != nil {
			httpio.WriteError(w, r, job.ErrNotFound)
			return
		}
		j, err := jobs.MarkDone(r.Context(), r.PathValue("profileId"), r.PathValue("jobId"), position, body.DeliveryLink)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toJobJSON(j))
	}
}

// proposeChange is POST /v1/profiles/{profileId}/jobs/{jobId}/payments (R-105): {title, amountUsd, dueDays} with an
// Idempotency-Key; 201 when added, 200 when the same request is repeated.
func proposeChange(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := httpio.IdempotencyKey(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		var body struct {
			Title     string `json:"title"`
			AmountUSD string `json:"amountUsd"`
			DueDays   int    `json:"dueDays"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		j, created, err := jobs.ProposeChange(r.Context(), r.PathValue("profileId"), r.PathValue("jobId"), key,
			job.PaymentRequest{Title: body.Title, AmountUSD: body.AmountUSD, DueDays: body.DueDays})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toJobJSON(j))
	}
}

// withdrawChange is DELETE /v1/profiles/{profileId}/jobs/{jobId}/payments/{position} (R-105): 204 for the last
// payment while it is a change the client has not accepted; 409 payment_not_withdrawable otherwise.
func withdrawChange(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		position, err := strconv.Atoi(r.PathValue("position"))
		if err != nil {
			httpio.WriteError(w, r, job.ErrNotFound)
			return
		}
		if err := jobs.WithdrawChange(r.Context(), r.PathValue("profileId"), r.PathValue("jobId"), position); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// acceptChange is POST /v1/jobs/{token}/payments/{position}/accept (R-105): {name, email, proposedAt}, the client's
// typed name and email for the change they read; 200 with the job, the same when already accepted.
func acceptChange(jobs *job.Service, all *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			acceptBody
			ProposedAt string `json:"proposedAt"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		proposedAt, err := time.Parse(time.RFC3339Nano, body.ProposedAt)
		if err != nil {
			httpio.WriteError(w, r, fmt.Errorf("%w: proposedAt must be the change's proposedAt, like 2026-10-18T12:00:00Z",
				job.ErrInvalid))
			return
		}
		position, err := strconv.Atoi(r.PathValue("position"))
		if err != nil {
			httpio.WriteError(w, r, job.ErrNotFound)
			return
		}
		allow := func() time.Duration { return all.Wait(mid.Everyone(r)) }
		j, err := jobs.AcceptChange(r.Context(), r.PathValue("token"), position, proposedAt, body.Name, body.Email, allow)
		writeAccepted(w, r, j, err)
	}
}

// getPublicJob is GET /v1/jobs/{token}: the client's read, public like the checkout.
func getPublicJob(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		j, err := jobs.ByToken(r.Context(), r.PathValue("token"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toPublicJobJSON(j))
	}
}

// acceptJob is POST /v1/jobs/{token}/accept (R-100): {"name", "email"}; 200 with the job, the same when already
// accepted.
func acceptJob(jobs *job.Service, all *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body acceptBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		allow := func() time.Duration { return all.Wait(mid.Everyone(r)) }
		j, err := jobs.Accept(r.Context(), r.PathValue("token"), body.Name, body.Email, allow)
		writeAccepted(w, r, j, err)
	}
}

// writeAccepted answers an accept: the job, or 429 with Retry-After past the budget everyone shares.
func writeAccepted(w http.ResponseWriter, r *http.Request, j job.Job, err error) {
	var soon *invoice.TooSoonError
	if errors.As(err, &soon) {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(soon.Wait.Seconds())))))
		httpio.WriteError(w, r, httpio.ErrRateLimited)
		return
	}
	if err != nil {
		httpio.WriteError(w, r, err)
		return
	}
	httpio.WriteJSON(w, http.StatusOK, toPublicJobJSON(j))
}
