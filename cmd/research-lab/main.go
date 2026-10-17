// research-lab is a local test-process driver, deliberately separate from server.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

var scenarios = map[string]string{"competing-buyers": "TestResearchCompetingBuyers", "rollback": "TestResearchRollback", "settlement": "TestResearchSettlement"}

func main() {
	if os.Getenv("RESEARCH_LAB") != "1" {
		log.Fatal("local runner requires RESEARCH_LAB=1")
	}
	port := os.Getenv("RESEARCH_LAB_PORT")
	if port == "" {
		port = "8082"
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1024 || n > 65535 {
		log.Fatal("invalid local runner port")
	}
	log.Printf("isolated research runner on http://127.0.0.1:%s (fresh Testcontainers only)", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, handler()))
}
func handler() http.Handler {
	gate := make(chan struct{}, 1)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if !net.ParseIP(host).IsLoopback() {
			http.Error(w, "loopback required", 403)
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" && origin != "http://127.0.0.1:5173" && origin != "http://localhost:5173" && origin != "http://127.0.0.1:5175" {
			http.Error(w, "local workbench origin required", 403)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == "GET" && r.URL.Path == "/healthz" {
			_ = json.NewEncoder(w).Encode(map[string]string{"environment": "isolated Testcontainers", "status": "available"})
			return
		}
		if r.Method != "POST" || r.URL.Path != "/run" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Content-Type") != "application/json" {
			http.Error(w, "application/json required", 415)
			return
		}
		var input struct {
			Scenario string `json:"scenario"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		if decoder.Decode(&struct{}{}) != io.EOF {
			http.Error(w, "one object required", 400)
			return
		}
		testName, ok := scenarios[input.Scenario]
		if !ok {
			http.Error(w, "unknown scenario", 400)
			return
		}
		select {
		case gate <- struct{}{}:
			defer func() { <-gate }()
		default:
			http.Error(w, "scenario already running", 409)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, "go", "test", "-json", "-count=1", "-timeout=120s", "./internal/postgres", "-run", "^"+testName+"$")
		// Never pass any user-supplied environment or target database to the driver.
		output, err := command.CombinedOutput()
		status := "PASS"
		if err != nil {
			status = "FAIL"
		}
		report := parseReport(output)
		if len(report) == 0 {
			status = "FAIL"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"scenario": input.Scenario, "status": status, "environment": "isolated PostgreSQL Testcontainer (not application database)", "command": fmt.Sprintf("go test -json -count=1 -timeout=120s ./internal/postgres -run ^%s$", testName), "output": string(output), "report": report})
	})
}

// go test -json may split a single long t.Log line across multiple events.
// Reassemble output before interpreting a complete newline-delimited report.
func parseReport(output []byte) json.RawMessage {
	var joined strings.Builder
	for _, line := range bytes.Split(output, []byte{'\n'}) {
		var event struct{ Output string }
		if json.Unmarshal(line, &event) == nil {
			joined.WriteString(event.Output)
		}
	}
	for _, line := range strings.Split(joined.String(), "\n") {
		if index := strings.Index(line, "RESEARCH_REPORT "); index >= 0 {
			candidate := strings.TrimSpace(line[index+len("RESEARCH_REPORT "):])
			if json.Valid([]byte(candidate)) {
				return json.RawMessage(candidate)
			}
		}
	}
	return nil
}
