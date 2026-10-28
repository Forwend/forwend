package teamapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/team"
)

func listTeam(members *team.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t, err := members.List(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toTeamJSON(t))
	}
}

func setMember(members *team.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body grantBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		m, err := members.SetMember(r.Context(), r.PathValue("profileId"), r.PathValue("memberId"), mid.SignedInUser(r),
			team.Grant{Role: body.Role, Stores: body.Stores})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toMemberJSON(m))
	}
}

func removeMember(members *team.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := members.RemoveMember(r.Context(), r.PathValue("profileId"), r.PathValue("memberId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func invite(members *team.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body inviteBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		v, err := members.Invite(r.Context(), r.PathValue("profileId"), mid.SignedInUser(r), body.Email,
			team.Grant{Role: body.Role, Stores: body.Stores})
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
		httpio.WriteJSON(w, http.StatusCreated, toInviteJSON(v))
	}
}

func revoke(members *team.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := members.Revoke(r.Context(), r.PathValue("profileId"), r.PathValue("inviteId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func leave(members *team.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := members.Leave(r.Context(), r.PathValue("profileId"), mid.SignedInUser(r)); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func readInvite(members *team.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := members.Invitation(r.Context(), r.PathValue("token"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, invitationJSON{ProfileName: v.ProfileName, Email: v.Email, Role: v.Role,
			ExpiresAt: v.ExpiresAt.UTC().Format(time.RFC3339)})
	}
}

func accept(members *team.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profileID, err := members.Accept(r.Context(), r.PathValue("token"), mid.SignedInUser(r))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, map[string]string{"profileId": profileID})
	}
}
