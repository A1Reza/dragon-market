package review

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io/fs"
	"sort"
)

// Initialize only manages a positively identified, dedicated review database.
// Existing application databases without our ledger are refused, never adopted.
func Initialize(ctx context.Context, db *sql.DB, files fs.FS) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var name string
	if err = tx.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil {
		return err
	}
	if name != "dragon_review_disposable" {
		return fmt.Errorf("refusing database: dedicated name dragon_review_disposable required")
	}
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(716029041)`); err != nil {
		return err
	}
	var ledger bool
	if err = tx.QueryRowContext(ctx, `SELECT to_regclass('public.dragon_review_migrations') IS NOT NULL`).Scan(&ledger); err != nil {
		return err
	}
	if !ledger {
		var tables int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`).Scan(&tables); err != nil {
			return err
		}
		if tables != 0 {
			return fmt.Errorf("refusing populated database without review migration ledger")
		}
		if _, err = tx.ExecContext(ctx, `CREATE TABLE dragon_review_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`); err != nil {
			return err
		}
	}
	paths, err := fs.Glob(files, "migrations/up/*.sql")
	if err != nil {
		return err
	}
	if len(paths) != 11 {
		return fmt.Errorf("expected 11 migrations including daily accounting v2, got %d", len(paths))
	}
	sort.Strings(paths)
	paths = append(paths, "dev/seed.sql")
	// Each source file is applied once. Later starts verify immutable checksums.
	for _, p := range paths {
		b, err := fs.ReadFile(files, p)
		if err != nil {
			return err
		}
		sum := fmt.Sprintf("%x", sha256.Sum256(b))
		var old string
		err = tx.QueryRowContext(ctx, `SELECT checksum FROM dragon_review_migrations WHERE name=$1`, p).Scan(&old)
		if err == nil {
			if old != sum {
				return fmt.Errorf("review migration checksum mismatch: %s", p)
			}
			continue
		}
		if err != sql.ErrNoRows {
			return err
		}
		if _, err = tx.ExecContext(ctx, string(b)); err != nil {
			return fmt.Errorf("initialize %s: %w", p, err)
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO dragon_review_migrations(name,checksum) VALUES ($1,$2)`, p, sum); err != nil {
			return err
		}
	}
	return tx.Commit()
}
