package httpio

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/search"
)

// A present but blank ?q= is refused, not read as no search.
func SearchQuery(r *http.Request) (search.Query, error) {
	if !r.URL.Query().Has("q") {
		return search.Query{}, nil
	}
	return search.Parse(r.URL.Query().Get("q"))
}

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

var ErrInvalidQuery = errors.New("invalid query")

func DayRange(from, to string) (time.Time, time.Time, error) {
	start, end := time.Unix(0, 0).UTC(), time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
	var err error
	if from != "" {
		if start, err = time.Parse(time.DateOnly, from); err != nil {
			return start, end, fmt.Errorf("%w: from must be a day like 2026-10-01", ErrInvalidQuery)
		}
	}
	if to != "" {
		if end, err = time.Parse(time.DateOnly, to); err != nil {
			return start, end, fmt.Errorf("%w: to must be a day like 2026-10-31", ErrInvalidQuery)
		}
		end = end.AddDate(0, 0, 1)
	}
	if !start.Before(end) {
		return start, end, fmt.Errorf("%w: from must not be after to", ErrInvalidQuery)
	}
	return start, end, nil
}
