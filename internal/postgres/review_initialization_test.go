package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io/fs"
	"market-dragon/internal/review"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func TestReviewDatabaseInitializationSafety(t *testing.T) {
	ctx := context.Background()
	files := os.DirFS("../..")
	if err := review.Initialize(ctx, testDB, files); err == nil || !strings.Contains(err.Error(), "dedicated name") {
		t.Fatalf("existing application database must be refused: %v", err)
	}
	db := reviewDisposableDB(t)
	if _, err := db.Exec(`CREATE TABLE user_work (value TEXT)`); err != nil {
		t.Fatal(err)
	}
	if err := review.Initialize(ctx, db, files); err == nil || !strings.Contains(err.Error(), "populated") {
		t.Fatalf("populated unmanaged database must be refused: %v", err)
	}
	// Remove only the table created by this test, after observing refusal.
	if _, err := db.Exec(`DROP TABLE user_work`); err != nil {
		t.Fatal(err)
	}
	if err := review.Initialize(ctx, db, files); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE guilds SET gold=9123 WHERE id='guild-buyer'`); err != nil {
		t.Fatal(err)
	}
	if err := review.Initialize(ctx, db, files); err != nil {
		t.Fatal(err)
	}
	var gold, ledger, version int
	if err := db.QueryRow(`SELECT gold,daily_accounting_version FROM guilds WHERE id='guild-buyer'`).Scan(&gold, &version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM dragon_review_migrations`).Scan(&ledger); err != nil {
		t.Fatal(err)
	}
	if gold != 9123 || ledger != 13 || version != 2 {
		t.Fatalf("restart changed persisted state or accounting version: gold=%d ledger=%d version=%d", gold, ledger, version)
	}
	changed := fstest.MapFS{}
	paths, err := fs.Glob(files, "migrations/up/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range append(paths, "dev/seed.sql") {
		b, err := fs.ReadFile(files, p)
		if err != nil {
			t.Fatal(err)
		}
		changed[p] = &fstest.MapFile{Data: b}
	}
	changed[paths[0]].Data = append(changed[paths[0]].Data, []byte("\n-- changed")...)
	if err = review.Initialize(ctx, db, changed); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("changed migration must be refused: %v", err)
	}
}

func reviewDisposableDB(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	// This database lives only in TestMain's fresh disposable container.
	const databaseName = "dragon_review_disposable"
	if _, err := testDB.Exec(`CREATE DATABASE ` + databaseName); err != nil {
		t.Fatal(err)
	}
	host, err := testContainer.Host(ctx)
	if err != nil {
		t.Fatal(err)
	}
	port, err := testContainer.MappedPort(ctx, "5432")
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("pgx", fmt.Sprintf("postgres://test:test@%s:%s/%s?sslmode=disable", host, port.Port(), databaseName))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		if _, err := testDB.Exec(`DROP DATABASE ` + databaseName); err != nil {
			t.Errorf("drop disposable database: %v", err)
		}
	})
	return db
}

func TestReviewLegacyAccountingIsRefusedWithoutDataLoss(t *testing.T) {
	ctx := context.Background()
	db := reviewDisposableDB(t)
	files := os.DirFS("../..")
	paths, err := fs.Glob(files, "migrations/up/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE dragon_review_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`); err != nil {
		t.Fatal(err)
	}
	// Reproduce an actual previous review schema with its immutable migration ledger.
	for _, p := range append(paths, "dev/seed.sql") {
		if strings.Contains(p, "000011_") || strings.Contains(p, "000012_") {
			continue
		}
		b, err := fs.ReadFile(files, p)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(b)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO dragon_review_migrations(name,checksum) VALUES($1,$2)`, p, fmt.Sprintf("%x", sha256.Sum256(b))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`UPDATE guilds SET gold=9123,daily_spent=300 WHERE id='guild-buyer'`); err != nil {
		t.Fatal(err)
	}
	if err := review.Initialize(ctx, db, files); err == nil || !strings.Contains(err.Error(), "reconcile legacy spending") {
		t.Fatalf("populated legacy accounting must be refused: %v", err)
	}
	var gold, spent, ledger int
	if err := db.QueryRow(`SELECT gold,daily_spent FROM guilds WHERE id='guild-buyer'`).Scan(&gold, &spent); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM dragon_review_migrations`).Scan(&ledger); err != nil {
		t.Fatal(err)
	}
	if gold != 9123 || spent != 300 || ledger != 11 {
		t.Fatalf("refused migration changed legacy data: gold=%d spent=%d ledger=%d", gold, spent, ledger)
	}
}
