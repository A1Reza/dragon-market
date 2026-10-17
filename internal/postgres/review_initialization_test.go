package postgres

import (
	"context"
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
	// This database lives only in TestMain's fresh disposable container.
	if _, err := testDB.Exec(`CREATE DATABASE dragon_review_disposable`); err != nil {
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
	db, err := sql.Open("pgx", fmt.Sprintf("postgres://test:test@%s:%s/dragon_review_disposable?sslmode=disable", host, port.Port()))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TABLE user_work (value TEXT)`); err != nil {
		t.Fatal(err)
	}
	if err = review.Initialize(ctx, db, files); err == nil || !strings.Contains(err.Error(), "populated") {
		t.Fatalf("populated unmanaged database must be refused: %v", err)
	}
	// Remove only the table this test just created, after observing refusal.
	if _, err = db.Exec(`DROP TABLE user_work`); err != nil {
		t.Fatal(err)
	}
	if err = review.Initialize(ctx, db, files); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE guilds SET gold=9123 WHERE id='guild-buyer'`); err != nil {
		t.Fatal(err)
	}
	if err = review.Initialize(ctx, db, files); err != nil {
		t.Fatal(err)
	}
	var gold, ledger int
	if err = db.QueryRow(`SELECT gold FROM guilds WHERE id='guild-buyer'`).Scan(&gold); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT count(*) FROM dragon_review_migrations`).Scan(&ledger); err != nil {
		t.Fatal(err)
	}
	if gold != 9123 || ledger != 11 {
		t.Fatalf("restart changed persisted state or reapplied migration: gold=%d ledger=%d", gold, ledger)
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
