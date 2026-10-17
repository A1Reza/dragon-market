package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReportReassemblesSplitGoTestOutput(t *testing.T) {
	first, _ := json.Marshal(map[string]string{"Output": "    fixture.go:1: RESEARCH_REPORT {\"scenario\":\"roll"})
	second, _ := json.Marshal(map[string]string{"Output": "back\",\"assertions\":[\"persisted\"]}\n"})
	got := parseReport(append(append(first, '\n'), second...))
	if string(got) != `{"scenario":"rollback","assertions":["persisted"]}` {
		t.Fatalf("report=%s", got)
	}
	if parseReport([]byte(`{"Output":"RESEARCH_REPORT {broken\n"}`)) != nil {
		t.Fatal("accepted incomplete report")
	}
}

func TestRunnerRejectsUnsafeRequests(t *testing.T) {
	for _, tc := range []struct {
		method, path, body, origin, peer string
		status                           int
	}{
		{"POST", "/run", `{"scenario":"arbitrary command"}`, "", "127.0.0.1:123", 400},
		{"POST", "/run", `{"scenario":"rollback"}`, "https://evil.invalid", "127.0.0.1:123", 403},
		{"POST", "/run", `{"scenario":"rollback"}`, "", "192.0.2.1:123", 403},
		{"POST", "/run", `{"scenario":"rollback","sql":"DROP DATABASE"}`, "", "127.0.0.1:123", 400},
		{"GET", "/healthz", "", "", "127.0.0.1:123", 200},
	} {
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.RemoteAddr = tc.peer
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		handler().ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Errorf("%+v status=%d", tc, w.Code)
		}
	}
}
