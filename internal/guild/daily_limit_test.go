package guild

import (
	"context"
	"errors"
	"market-dragon/internal/gold"
	"math"
	"testing"
	"time"
)

func TestDailyLimitUTCProjectionAndCarry(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 10, 17, 20, 29, 0, 0, time.UTC)
	repo := &MockGuildRepo{guilds: map[string]*Guild{"g": {ID: "g", Gold: 2000, DailyLimit: 500}}}
	w := NewWalletService(repo, &MockTransactor{}, WithClock(func() time.Time { return now }))
	if err := w.Reserve(ctx, "g", 200); err != nil {
		t.Fatal(err)
	}
	if err := w.Spend(ctx, "g", 300); err != nil {
		t.Fatal(err)
	}
	// Tehran midnight alone must not replenish the UTC allowance.
	now = now.Add(2 * time.Minute).In(time.FixedZone("Tehran", 3*3600+1800))
	if err := w.Spend(ctx, "g", 1); !errors.Is(err, ErrDailyLimitReached) {
		t.Fatalf("local midnight error=%v", err)
	}
	now = time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	g, err := w.GetGuild(ctx, "g")
	if err != nil || g.DailySpent != 0 || g.Reserved != 200 || repo.guilds["g"].DailySpent != 300 {
		t.Fatalf("projected=%+v stored=%+v err=%v", g, repo.guilds["g"], err)
	}
	if err := w.Spend(ctx, "g", 301); !errors.Is(err, ErrDailyLimitReached) {
		t.Fatalf("carried hold ignored: %v", err)
	}
	if err := w.Spend(ctx, "g", 300); err != nil {
		t.Fatal(err)
	}
	if err := w.Deduct(ctx, "g", 200); err != nil {
		t.Fatal(err)
	}
	g, err = w.GetGuild(ctx, "g")
	if err != nil || g.DailySpent != 500 || g.Reserved != 0 || g.Gold != 1200 {
		t.Fatalf("settled=%+v err=%v", g, err)
	}
}

func TestDailyLimitAndAccountingOverflow(t *testing.T) {
	for _, tc := range []struct {
		name   string
		state  Guild
		op     string
		amount gold.Amount
		want   error
	}{
		{"reserve limit overflow", Guild{Gold: math.MaxInt64, DailyLimit: math.MaxInt64, DailySpent: math.MaxInt64 - 100, Reserved: 50}, "reserve", 101, ErrDailyLimitReached},
		{"spend limit overflow", Guild{Gold: math.MaxInt64, DailyLimit: math.MaxInt64, DailySpent: math.MaxInt64 - 100, Reserved: 50}, "spend", 101, ErrDailyLimitReached},
		{"exact capacity", Guild{Gold: math.MaxInt64, DailyLimit: math.MaxInt64, DailySpent: math.MaxInt64 - 100, Reserved: 50}, "reserve", 50, nil},
		{"unlimited spend range", Guild{Gold: math.MaxInt64, DailySpent: math.MaxInt64 - 10}, "spend", 11, ErrAmountOverflow},
		{"unlimited settlement range", Guild{Gold: math.MaxInt64, DailySpent: math.MaxInt64 - 10, Reserved: 11}, "deduct", 11, ErrAmountOverflow},
		{"earn range", Guild{Gold: math.MaxInt64}, "earn", 1, ErrAmountOverflow},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.state.ID = "g"
			repo := &MockGuildRepo{guilds: map[string]*Guild{"g": &tc.state}}
			w := NewWalletService(repo, &MockTransactor{})
			ops := map[string]func(context.Context, string, gold.Amount) error{"reserve": w.Reserve, "spend": w.Spend, "deduct": w.Deduct, "earn": w.Earn}
			if err := ops[tc.op](context.Background(), "g", tc.amount); !errors.Is(err, tc.want) {
				t.Fatalf("error=%v want=%v", err, tc.want)
			}
		})
	}
}
