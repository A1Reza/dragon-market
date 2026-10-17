package review

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGatewayAccessAndIsolation(t *testing.T) {
	upstreamCalls := 0
	backend, _ := url.Parse("http://127.0.0.1:8080")
	password := "review-test-password-long-enough"
	h, err := Handler(Config{Username: "reviewer", Password: password, Commit: strings.Repeat("a", 40), Assets: fstest.MapFS{"index.html": {Data: []byte("Review UI")}, "assets/app.js": {Data: []byte("script")}}, Backend: backend, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		upstreamCalls++
		if r.URL.Host != "127.0.0.1:8080" || strings.HasPrefix(r.URL.Path, "/api") {
			t.Errorf("wrong private upstream: %s", r.URL)
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("review credentials leaked to backend")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"real_backend":true}`))}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, path, origin, fetchSite string
		auth                                  bool
		status                                int
	}{
		{"public availability", "GET", "/healthz", "", "", false, 200},
		{"UI gated", "GET", "/", "", "", false, 401},
		{"assets gated", "GET", "/assets/app.js", "", "", false, 401},
		{"snapshot gated", "GET", "/api/dev/snapshot", "", "", false, 401},
		{"mutation gated", "POST", "/api/guilds", "", "", false, 401},
		{"identity gated", "GET", "/review/config", "", "", false, 401},
		{"UI available", "GET", "/", "", "", true, 200},
		{"identity available", "GET", "/review/config", "", "", true, 200},
		{"authenticated snapshot", "GET", "/api/dev/snapshot", "", "", true, 200},
		{"same origin mutation", "POST", "/api/guilds", "https://review.example", "same-origin", true, 200},
		{"CSRF absent origin", "POST", "/api/guilds", "", "", true, 403},
		{"CSRF other origin", "POST", "/api/guilds", "https://attacker.example", "", true, 403},
		{"cross-site read", "GET", "/api/dev/snapshot", "", "cross-site", true, 403},
		{"no harness", "POST", "/lab/run", "https://review.example", "", true, 404},
		{"no API harness", "POST", "/api/lab/run", "https://review.example", "", true, 404},
		{"no arbitrary diagnostics", "GET", "/api/dev/sql", "", "", true, 404},
		{"no directory listing", "GET", "/assets/", "", "", true, 404},
		{"no traversal", "GET", "/api/items/../dev/snapshot", "", "", true, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "https://review.example"+tc.path, nil)
			if tc.auth {
				r.SetBasicAuth("reviewer", password)
			}
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Sec-Fetch-Site", tc.fetchSite)
			r.Header.Set("Cookie", "private=secret")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d want %d: %s", w.Code, tc.status, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Robots-Tag") == "" {
				t.Fatal("missing privacy headers")
			}
		})
	}
	if upstreamCalls != 2 {
		t.Fatalf("unexpected backend calls: %d", upstreamCalls)
	}
	bad := httptest.NewRequest("GET", "https://review.example/", nil)
	bad.SetBasicAuth("reviewer", "wrong-password")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, bad)
	if w.Code != 401 {
		t.Fatal("wrong password accepted")
	}
}

func TestGatewayRefusesUnsafeConfiguration(t *testing.T) {
	backend, _ := url.Parse("http://public.example:8080")
	if _, err := Handler(Config{Username: "review", Password: strings.Repeat("p", 24), Backend: backend}); err == nil {
		t.Fatal("public upstream accepted")
	}
	backend, _ = url.Parse("http://127.0.0.1:8080")
	if _, err := Handler(Config{Username: "review", Password: "short", Backend: backend}); err == nil {
		t.Fatal("short password accepted")
	}
}
