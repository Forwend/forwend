package httpio

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/ensp1re/forwend/apps/backend/internal/search"
)

// SearchQuery reads ?q=: absent is no search, present it must not be blank.
func SearchQuery(r *http.Request) (search.Query, error) {
	if !r.URL.Query().Has("q") {
		return search.Query{}, nil
	}
	return search.Parse(r.URL.Query().Get("q"))
}

// IntQuery reads a whole-number query parameter, or def when it is absent.
func IntQuery(r *http.Request, name string, def int) (int, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%w: %s must be a whole number", ErrMalformed, name)
	}
	return n, nil
}
