// Package jobapi serves jobs (docs/backend/api.md): routes.go lists them, model.go holds their JSON, and jobs.go the
// handlers.
package jobapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
)

// Accepting is public like the checkout, and it makes an invoice: a few tries per link, and a shared budget for
// everyone. Per IP belongs to the edge (Q-8).
const (
	AcceptRate, AcceptBurst       = 0.1, 3
	AcceptAllRate, AcceptAllBurst = 5, 20
)

// Routes mounts the job endpoints on mux: the owner's create, list, read, delete and mark done behind the profile guard; the client's read
// and accept by the link's token in public.
func Routes(mux *http.ServeMux, g mid.Guards, jobs *job.Service) {
	mux.Handle("POST /v1/profiles/{profileId}/jobs", g.ProfileScoped(createJob(jobs)))
	mux.Handle("GET /v1/profiles/{profileId}/jobs", g.ProfileScoped(listJobs(jobs)))
	mux.Handle("GET /v1/profiles/{profileId}/jobs/{jobId}", g.ProfileScoped(getJob(jobs)))
	mux.Handle("DELETE /v1/profiles/{profileId}/jobs/{jobId}", g.ProfileScoped(deleteJob(jobs)))
	mux.Handle("POST /v1/profiles/{profileId}/jobs/{jobId}/payments/{position}/done", g.ProfileScoped(markDone(jobs)))
	mux.Handle("GET /v1/jobs/{token}", getPublicJob(jobs))
	perJob := func(r *http.Request) string { return r.PathValue("token") }
	mux.Handle("POST /v1/jobs/{token}/accept", mid.Limit(mid.NewBuckets(AcceptAllRate, AcceptAllBurst), mid.Everyone,
		mid.Limit(mid.NewBuckets(AcceptRate, AcceptBurst), perJob, acceptJob(jobs))))
}
