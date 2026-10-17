// This optional entrypoint supervises the unchanged local backend behind a
// password gate. Do not use it for experiments or production commerce.
package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"log/slog"
	"market-dragon/internal/review"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("review service stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	if os.Getenv("REVIEW_DISPOSABLE_DATABASE") != "dragon_review_disposable" {
		return errors.New("explicit dedicated review database acknowledgement required")
	}
	port, err := strconv.Atoi(os.Getenv("PORT"))
	if err != nil || port < 1024 || port > 65535 || port == 8080 {
		return errors.New("PORT must be 1024..65535")
	}
	backend, _ := url.Parse("http://127.0.0.1:8080")
	commit := os.Getenv("RENDER_GIT_COMMIT")
	if commit == "" {
		commit = os.Getenv("REVIEW_COMMIT")
	}
	_, commitErr := hex.DecodeString(commit)
	if len(commit) != 40 || commitErr != nil || strings.ToLower(commit) != commit {
		return errors.New("40-character deployment commit required")
	}
	handler, err := review.Handler(review.Config{Username: os.Getenv("REVIEW_USERNAME"), Password: os.Getenv("REVIEW_PASSWORD"), Commit: commit, Backend: backend, Assets: os.DirFS("/app/web")})
	if err != nil {
		return err
	}
	dsn := os.Getenv("DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || strings.TrimPrefix(u.Path, "/") != "dragon_review_disposable" || u.Query().Get("sslmode") != "require" {
		return errors.New("DATABASE_URL must name dragon_review_disposable with sslmode=require")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return errors.New("could not open review database")
	}
	initCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	err = review.Initialize(initCtx, db, os.DirFS("/app"))
	cancel()
	db.Close()
	// Do not log driver errors: connection strings can contain credentials.
	if err != nil {
		return errors.New("review database initialization refused or failed; verify dedicated DB, migration checksums and connectivity")
	}
	cmd := exec.Command("/app/market-server")
	for _, v := range os.Environ() {
		key := strings.SplitN(v, "=", 2)[0]
		if key != "HTTP_ADDR" && key != "APP_ENV" && key != "PRICE_ORACLE_URL" && key != "RESEARCH_LAB" && !strings.HasPrefix(key, "REVIEW_") {
			cmd.Env = append(cmd.Env, v)
		}
	}
	cmd.Env = append(cmd.Env, "HTTP_ADDR=127.0.0.1:8080", "APP_ENV=development")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err = cmd.Start(); err != nil {
		return err
	}
	exited := make(chan error, 1)
	finished := make(chan struct{})
	go func() { exited <- cmd.Wait(); close(finished) }()
	defer func() {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		select {
		case <-finished:
		case <-time.After(12 * time.Second):
			_ = cmd.Process.Kill()
		}
	}()
	client := &http.Client{Timeout: time.Second}
	ready := time.NewTicker(200 * time.Millisecond)
	defer ready.Stop()
	deadline := time.NewTimer(30 * time.Second)
	defer deadline.Stop()
wait:
	for {
		select {
		case err := <-exited:
			return fmt.Errorf("backend stopped before readiness: %v", err)
		case <-ctx.Done():
			return nil
		case <-deadline.C:
			return errors.New("backend readiness timed out")
		case <-ready.C:
			resp, err := client.Get(backend.String() + "/healthz")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == 200 {
					break wait
				}
			}
		}
	}
	server := &http.Server{Addr: net.JoinHostPort("0.0.0.0", strconv.Itoa(port)), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 25 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	errorsCh := make(chan error, 1)
	go func() { errorsCh <- server.ListenAndServe() }()
	select {
	case <-exited:
		_ = server.Close()
		return errors.New("private backend stopped")
	case err := <-errorsCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(closeCtx)
	}
}
