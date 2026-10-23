// Package jobapi serves the job endpoints of docs/backend/api.md.
package jobapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
)

// Accepting is public and makes an invoice. The shared budget is spent only by an accept that changes a job
// (R-117); per IP belongs to the edge (Q-8).
const (
	AcceptRate, AcceptBurst       = 0.1, 3
	AcceptAllRate, AcceptAllBurst = 5, 20
)

func Routes(mux *http.ServeMux, g mid.Guards, jobs *job.Service) {
	mux.Handle("POST /v1/profiles/{profileId}/jobs", g.ProfileScoped(createJob(jobs)))
	mux.Handle("GET /v1/profiles/{profileId}/jobs", g.ProfileScoped(listJobs(jobs)))
	mux.Handle("GET /v1/profiles/{profileId}/jobs/{jobId}", g.ProfileScoped(getJob(jobs)))
	mux.Handle("DELETE /v1/profiles/{profileId}/jobs/{jobId}", g.ProfileScoped(deleteJob(jobs)))
	mux.Handle("POST /v1/profiles/{profileId}/jobs/{jobId}/payments/{position}/done", g.ProfileScoped(markDone(jobs)))
	mux.Handle("POST /v1/profiles/{profileId}/jobs/{jobId}/payments", g.ProfileScoped(proposeChange(jobs)))
	mux.Handle("DELETE /v1/profiles/{profileId}/jobs/{jobId}/payments/{position}", g.ProfileScoped(withdrawChange(jobs)))
	mux.Handle("GET /v1/jobs/{token}", getPublicJob(jobs))
	// Accepting the quote and accepting a change share the budget for everyone; each has its own per link.
	all := mid.NewBuckets(AcceptAllRate, AcceptAllBurst)
	perJob := func(r *http.Request) string { return r.PathValue("token") }
	limited := func(h http.Handler) http.Handler {
		return mid.Limit(mid.NewBuckets(AcceptRate, AcceptBurst), perJob, h)
	}
	mux.Handle("POST /v1/jobs/{token}/accept", limited(acceptJob(jobs, all)))
	mux.Handle("POST /v1/jobs/{token}/payments/{position}/accept", limited(acceptChange(jobs, all)))
}
