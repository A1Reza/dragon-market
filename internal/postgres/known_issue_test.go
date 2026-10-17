package postgres

import (
	"context"
	"testing"
)

// This characterizes a known defect, NOT a passing daily-limit invariant test.
// It deliberately fails if behavior changes so policy/data-model repair must
// update the documented issue and establish the intended replacement property.
func TestKnownIssuePriorDayReleaseReducesTodaySpending(t *testing.T) {
	w, _, _, _, _, _ := researchFixture(t)
	ctx := context.Background()
	if _, err := testDB.Exec(`UPDATE guilds SET reserved=500,daily_spent=500,daily_limit=500,daily_spent_on=(NOW() AT TIME ZONE 'UTC')::date-1 WHERE id='buyer'`); err != nil {
		t.Fatal(err)
	}
	if err := w.Spend(ctx, "buyer", 300); err != nil {
		t.Fatal(err)
	}
	if err := w.Release(ctx, "buyer", 500); err != nil {
		t.Fatal(err)
	}
	if err := w.Spend(ctx, "buyer", 500); err != nil {
		t.Fatalf("known behavior changed; review policy and regression: %v", err)
	}
	g, err := w.GetGuild(ctx, "buyer")
	if err != nil {
		t.Fatal(err)
	}
	if g.Gold != 9200 || g.DailySpent != 500 {
		t.Fatalf("known issue fixture differs: %+v", g)
	}
	t.Log("KNOWN-01 CONFIRMED: 800 spent today under limit 500 after release of yesterday's reservation. This test does not verify limit safety.")
}
