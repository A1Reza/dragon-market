package api

import (
	"context"
	"encoding/json"
	"market-dragon/internal/inspection"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
)

type SnapshotReader interface {
	Snapshot(context.Context, int) (*inspection.Snapshot, error)
}

// WithDevelopmentInspection must only be wired in explicit development mode.
// Defense in depth: require a loopback peer; do not trust proxy IP headers.
func WithDevelopmentInspection(next http.Handler, reader SnapshotReader) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", uuid.NewString())
		if r.URL.Path != "/dev/snapshot" {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil || !net.ParseIP(host).IsLoopback() {
			http.Error(w, "development inspection requires loopback", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			http.Error(w, "read only", http.StatusMethodNotAllowed)
			return
		}
		offset := 0
		if v := r.URL.Query().Get("offset"); v != "" {
			offset, err = strconv.Atoi(v)
			if err != nil || offset < 0 || offset > 100000 {
				http.Error(w, "offset must be 0..100000", 400)
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		snapshot, err := reader.Snapshot(ctx, offset)
		if err != nil {
			http.Error(w, "development snapshot unavailable", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(snapshot)
	})
}
