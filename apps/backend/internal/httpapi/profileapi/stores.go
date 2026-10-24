package profileapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// R-134.
func listStores(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := profiles.Stores(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Stores []storeJSON `json:"stores"`
		}{Stores: []storeJSON{}}
		for _, s := range list {
			out.Stores = append(out.Stores, toStoreJSON(s))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

func putStore(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body storeBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		s, created, err := profiles.SaveStore(r.Context(), r.PathValue("profileId"), r.PathValue("storeId"),
			profile.StoreDetails{Name: body.Name, DefaultExpiresIn: body.DefaultExpiresIn,
				AllowedOrigins: body.AllowedOrigins, BrandColor: body.BrandColor, TokensOff: toPairs(body.TokensOff)})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toStoreJSON(s))
	}
}

// R-135: the body is the image itself, a PNG or JPEG.
func putStoreLogo(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// One byte over the limit is enough for SaveStoreLogo to refuse it.
		upload, err := io.ReadAll(io.LimitReader(r.Body, profile.MaxLogoBytes+1))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		s, err := profiles.SaveStoreLogo(r.Context(), r.PathValue("profileId"), r.PathValue("storeId"), upload)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toStoreJSON(s))
	}
}

func deleteStoreLogo(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, err := profiles.DeleteStoreLogo(r.Context(), r.PathValue("profileId"), r.PathValue("storeId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toStoreJSON(s))
	}
}

// Public: pay pages show it. The API encoded the PNG itself, and the policy keeps a browser from running anything in it.
func getStoreLogo(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		logo, at, err := profiles.StoreLogo(r.Context(), r.PathValue("storeId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		sum := sha256.Sum256(logo)
		w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:16])+`"`)
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		http.ServeContent(w, r, "", at, bytes.NewReader(logo))
	}
}
