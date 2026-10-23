package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

func Serve(ctx context.Context, server *http.Server, listener net.Listener, grace time.Duration) error {
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	select {
	case err := <-served:
		return fmt.Errorf("serve HTTP: %w", err)
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	if err := server.Shutdown(shutdown); err != nil {
		closeErr := server.Close()
		<-served
		return errors.Join(fmt.Errorf("shutdown HTTP: %w", err), closeErr)
	}
	if err := <-served; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve HTTP: %w", err)
	}
	return nil
}
