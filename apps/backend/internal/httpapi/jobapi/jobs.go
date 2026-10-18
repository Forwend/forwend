package jobapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
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
func acceptJob(jobs *job.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body acceptBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		j, err := jobs.Accept(r.Context(), r.PathValue("token"), body.Name, body.Email)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toPublicJobJSON(j))
	}
}
