package api

import (
	"context"
	"market-dragon/internal/inspection"
	"net/http"
	"net/http/httptest"
	"testing"
)

type snapshotStub struct{ calls int }

func (s *snapshotStub) Snapshot(context.Context, int) (*inspection.Snapshot, error) {
	s.calls++
	return &inspection.Snapshot{Environment: "development"}, nil
}
func TestDevelopmentInspectionRestrictions(t *testing.T) {
	store := &snapshotStub{}
	handler := WithDevelopmentInspection(http.NotFoundHandler(), store)
	for _, tc := range []struct {
		method, path, peer string
		want               int
	}{
		{"GET", "/dev/snapshot", "127.0.0.1:1234", 200},
		{"POST", "/dev/snapshot", "127.0.0.1:1234", 405},
		{"GET", "/dev/snapshot", "198.51.100.1:1234", 403},
		{"GET", "/dev/snapshot?offset=-1", "127.0.0.1:1234", 400},
		{"GET", "/dev/snapshot?offset=garbage", "127.0.0.1:1234", 400},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r.RemoteAddr = tc.peer
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Errorf("%+v status=%d", tc, w.Code)
		}
	}
	if store.calls != 1 {
		t.Fatalf("restricted requests reached SQL: %d", store.calls)
	}
	w := httptest.NewRecorder()
	NewRouter(nil, nil, nil, nil, nil).ServeHTTP(w, httptest.NewRequest("GET", "/dev/snapshot", nil))
	if w.Code != 404 {
		t.Fatal("default router exposes diagnostics")
	}
}
