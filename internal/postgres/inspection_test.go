package postgres

import (
	"context"
	"testing"
)

func TestInspectionSnapshotIsBoundedAndConsistent(t *testing.T) {
	ctx := context.Background()
	if err := TruncateTables(ctx, "wallet_transactions", "bids", "auctions", "limit_orders", "items", "guilds"); err != nil {
		t.Fatal(err)
	}
	if _, err := testDB.Exec(`INSERT INTO guilds(id,gold,reserved) SELECT 'inspection-'||i,1000,100 FROM generate_series(1,205) AS i`); err != nil {
		t.Fatal(err)
	}
	store := NewInspector(testDB, "test-commit")
	first, err := store.Snapshot(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Snapshot(ctx, 200)
	if err != nil {
		t.Fatal(err)
	}
	if first.Counts["guilds"] != 205 || len(first.Guilds) != 200 || len(second.Guilds) != 5 {
		t.Fatalf("pagination first=%d second=%d counts=%v", len(first.Guilds), len(second.Guilds), first.Counts)
	}
	for _, g := range first.Guilds {
		if g.Available != 900 {
			t.Fatalf("available=%d", g.Available)
		}
	}
	if first.BackendCommit != "test-commit" || first.DatabaseVersion == "" {
		t.Fatal("missing status metadata")
	}
	var count int
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("read created audit entries: %d %v", count, err)
	}
}
