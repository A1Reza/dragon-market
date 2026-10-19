package postgres

import (
	"context"
	"errors"
	"market-dragon/internal/auction"
	"market-dragon/internal/gold"
	"market-dragon/internal/guild"
	"strings"
	"sync"
	"testing"
	"time"
)

// This asserts safety under both the old example and the reviewed carry policy.
// Its verdict comes from actual persisted debits, not a service response alone.
func TestDailyLimitPriorDayReleaseCannotEraseSpending(t *testing.T) {
	w, _, _, _, _, _ := researchFixture(t)
	ctx := context.Background()
	if _, err := testDB.Exec(`UPDATE guilds SET reserved=500,daily_spent=500,daily_limit=500,daily_spent_on=(NOW() AT TIME ZONE 'UTC')::date-1 WHERE id='buyer'`); err != nil {
		t.Fatal(err)
	}
	first := w.Spend(ctx, "buyer", 300)
	if first != nil && !errors.Is(first, guild.ErrDailyLimitReached) {
		t.Fatal(first)
	}
	if err := w.Release(ctx, "buyer", 500); err != nil {
		t.Fatal(err)
	}
	if first != nil {
		// Under the selected policy the purchase becomes eligible after release.
		if err := w.Spend(ctx, "buyer", 300); err != nil {
			t.Fatal(err)
		}
	}
	last := w.Spend(ctx, "buyer", 500)
	var debits, gold, spent, reserve, audits int64
	if err := testDB.QueryRow(`SELECT COALESCE(sum(amount),0) FROM wallet_transactions WHERE guild_id='buyer' AND operation IN ('spend','deduct')`).Scan(&debits); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT gold,daily_spent,reserved FROM guilds WHERE id='buyer'`).Scan(&gold, &spent, &reserve); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions WHERE guild_id='buyer'`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	t.Logf("first purchase error=%v; final purchase error=%v; persisted debits=%d gold=%d completed=%d reserved=%d audit rows=%d", first, last, debits, gold, spent, reserve, audits)
	if !errors.Is(last, guild.ErrDailyLimitReached) || debits != 300 || gold != 9700 || spent != 300 || reserve != 0 || audits != 2 {
		t.Fatal("daily limit bypass or failed operation persisted an effect")
	}
}

func assertDailyWallet(t *testing.T, gold, spent, reserved int64) {
	t.Helper()
	var gotGold, gotSpent, gotReserved int64
	if err := testDB.QueryRow(`SELECT gold,daily_spent,reserved FROM guilds WHERE id='buyer'`).Scan(&gotGold, &gotSpent, &gotReserved); err != nil {
		t.Fatal(err)
	}
	if gotGold != gold || gotSpent != spent || gotReserved != reserved {
		t.Fatalf("persisted gold/spent/reserved=%d/%d/%d want=%d/%d/%d", gotGold, gotSpent, gotReserved, gold, spent, reserved)
	}
}

func TestDailyLimitMixedAgeHoldsAndSettlement(t *testing.T) {
	_, _, _, _, _, tx := researchFixture(t)
	ctx := context.Background()
	clock := &researchClock{now: time.Date(2030, 1, 1, 12, 0, 0, 0, time.UTC)}
	w := guild.NewWalletService(NewWalletRepository(testDB), tx, guild.WithClock(clock.Now))
	if _, err := testDB.Exec(`UPDATE guilds SET daily_limit=500 WHERE id='buyer'`); err != nil {
		t.Fatal(err)
	}
	for _, amount := range []gold.Amount{200, 100} {
		if err := w.Reserve(ctx, "buyer", amount); err != nil {
			t.Fatal(err)
		}
	}
	clock.advance(24 * time.Hour)
	if err := w.Reserve(ctx, "buyer", 100); err != nil {
		t.Fatal(err)
	}
	if err := w.Spend(ctx, "buyer", 100); err != nil {
		t.Fatal(err)
	}
	assertDailyWallet(t, 9900, 100, 400)
	if err := w.Release(ctx, "buyer", 100); err != nil {
		t.Fatal(err)
	}
	assertDailyWallet(t, 9900, 100, 300)
	if err := w.Deduct(ctx, "buyer", 200); err != nil {
		t.Fatal(err)
	}
	assertDailyWallet(t, 9700, 300, 100)
	if err := w.Spend(ctx, "buyer", 100); err != nil {
		t.Fatal(err)
	}
	if err := w.Reserve(ctx, "buyer", 1); !errors.Is(err, guild.ErrDailyLimitReached) {
		t.Fatalf("over-limit reserve error=%v", err)
	}
	if err := w.Deduct(ctx, "buyer", 100); err != nil {
		t.Fatal(err)
	}
	if err := w.Spend(ctx, "buyer", 1); !errors.Is(err, guild.ErrDailyLimitReached) {
		t.Fatalf("over-limit spend error=%v", err)
	}
	assertDailyWallet(t, 9500, 500, 0)
	var debits int64
	if err := testDB.QueryRow(`SELECT sum(amount) FROM wallet_transactions WHERE guild_id='buyer' AND operation IN ('spend','deduct')`).Scan(&debits); err != nil || debits != 500 {
		t.Fatalf("independent debit sum=%d err=%v", debits, err)
	}
	clock.advance(24 * time.Hour)
	if err := w.Spend(ctx, "buyer", 500); err != nil {
		t.Fatal(err)
	}
	assertDailyWallet(t, 9000, 500, 0)
}

func TestDailyLimitConcurrentReserveAndSpend(t *testing.T) {
	w, _, _, _, _, _ := researchFixture(t)
	ctx := context.Background()
	if _, err := testDB.Exec(`UPDATE guilds SET daily_limit=500 WHERE id='buyer'`); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	errs := make(chan error, 12)
	var workers sync.WaitGroup
	for i := 0; i < 12; i++ {
		workers.Add(1)
		go func(reserve bool) {
			defer workers.Done()
			<-start
			if reserve {
				errs <- w.Reserve(ctx, "buyer", 100)
			} else {
				errs <- w.Spend(ctx, "buyer", 100)
			}
		}(i%2 == 0)
	}
	close(start)
	workers.Wait()
	close(errs)
	successes := 0
	for err := range errs {
		if err == nil {
			successes++
		} else if !errors.Is(err, guild.ErrDailyLimitReached) {
			t.Fatal(err)
		}
	}
	var spent, reserved, debits, audits int64
	if err := testDB.QueryRow(`SELECT daily_spent,reserved FROM guilds WHERE id='buyer'`).Scan(&spent, &reserved); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT COALESCE(sum(amount) FILTER (WHERE operation='spend'),0),count(*) FROM wallet_transactions WHERE guild_id='buyer'`).Scan(&debits, &audits); err != nil {
		t.Fatal(err)
	}
	if successes != 5 || spent+reserved != 500 || spent != debits || audits != 5 {
		t.Fatalf("successes=%d spent=%d reserved=%d debits=%d audits=%d", successes, spent, reserved, debits, audits)
	}
	assertDailyWallet(t, 10000-debits, spent, reserved)
}

type failDailyAudit struct{ *Repository }

func (failDailyAudit) RecordWalletTransaction(context.Context, string, string, gold.Amount, *guild.Guild) error {
	return errDeliberateRollback
}

func TestDailyLimitAuditFailureRollsBackDayAndSettlement(t *testing.T) {
	_, _, _, _, _, tx := researchFixture(t)
	if _, err := testDB.Exec(`UPDATE guilds SET daily_limit=500,daily_spent=300,reserved=200,daily_spent_on='2030-01-01' WHERE id='buyer'`); err != nil {
		t.Fatal(err)
	}
	w := guild.NewWalletService(failDailyAudit{NewWalletRepository(testDB)}, tx,
		guild.WithClock(func() time.Time { return time.Date(2030, 1, 2, 12, 0, 0, 0, time.UTC) }))
	if err := w.Deduct(context.Background(), "buyer", 200); !errors.Is(err, errDeliberateRollback) {
		t.Fatal(err)
	}
	assertDailyWallet(t, 10000, 300, 200)
	var day string
	var count int
	if err := testDB.QueryRow(`SELECT to_char(daily_spent_on,'YYYY-MM-DD') FROM guilds WHERE id='buyer'`).Scan(&day); err != nil || day != "2030-01-01" {
		t.Fatalf("day=%s err=%v", day, err)
	}
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("audit count=%d err=%v", count, err)
	}
}

func TestDailyLimitAuctionRolloverCancelAndSettle(t *testing.T) {
	_, items, _, _, _, tx := researchFixture(t)
	ctx := context.Background()
	clock := &researchClock{now: time.Date(2030, 1, 1, 23, 59, 0, 0, time.UTC)}
	w := guild.NewWalletService(NewWalletRepository(testDB), tx, guild.WithClock(clock.Now))
	a := auction.NewAuctionService(NewAuctionRepository(testDB), w, items, tx, auction.WithClock(clock))
	if _, err := testDB.Exec(`UPDATE items SET type='legendary'; UPDATE guilds SET daily_limit=500 WHERE id='buyer';
		INSERT INTO items(id,name,type,owner_id,status,base_price) VALUES('second','Second wand','legendary','seller','free',100)`); err != nil {
		t.Fatal(err)
	}
	first, err := a.StartAuction(ctx, "research-item", "seller", 100)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.StartAuction(ctx, "second", "seller", 100)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.PlaceBid(ctx, first.ID, "buyer", 200); err != nil {
		t.Fatal(err)
	}
	bid, err := a.PlaceBid(ctx, second.ID, "buyer", 100)
	if err != nil {
		t.Fatal(err)
	}
	clock.advance(2 * time.Minute)
	// Increase yesterday's winning bid; only its delta is newly reserved.
	if _, err := a.PlaceBid(ctx, first.ID, "buyer", 250); err != nil {
		t.Fatal(err)
	}
	if err := w.Spend(ctx, "buyer", 150); err != nil {
		t.Fatal(err)
	}
	if err := a.CancelBid(ctx, second.ID, bid.ID, "buyer"); err != nil {
		t.Fatal(err)
	}
	// A different bidder outbids the old hold; release must leave completed
	// spending alone. The buyer then wins again with a new current-day hold.
	if _, err := a.PlaceBid(ctx, first.ID, "other", 300); err != nil {
		t.Fatal(err)
	}
	if _, err := a.PlaceBid(ctx, first.ID, "buyer", 350); err != nil {
		t.Fatal(err)
	}
	assertDailyWallet(t, 9850, 150, 350)
	clock.advance(24 * time.Hour)
	if err := w.Spend(ctx, "buyer", 150); err != nil {
		t.Fatal(err)
	}
	if err := a.EndAuction(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := a.EndAuction(ctx, first.ID); !errors.Is(err, auction.ErrAuctionNotActive) {
		t.Fatalf("repeated settlement error=%v", err)
	}
	assertDailyWallet(t, 9350, 500, 0)
	var owner string
	var sellerGold, settlementDebits int64
	if err := testDB.QueryRow(`SELECT owner_id FROM items WHERE id='research-item'`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT gold FROM guilds WHERE id='seller'`).Scan(&sellerGold); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions WHERE operation='deduct'`).Scan(&settlementDebits); err != nil {
		t.Fatal(err)
	}
	if owner != "buyer" || sellerGold != 10350 || settlementDebits != 1 {
		t.Fatalf("owner=%s seller gold=%d settlements=%d", owner, sellerGold, settlementDebits)
	}
}

func TestDailyLimitMigrationRejectsLegacyData(t *testing.T) {
	ctx := context.Background()
	for _, populated := range []bool{false, true} {
		t.Run(map[bool]string{false: "empty", true: "legacy"}[populated], func(t *testing.T) {
			tx, err := testDB.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			// Temp tables shadow public.guilds; the real fixture is untouched.
			if _, err := tx.Exec(`CREATE TEMP TABLE guilds(id TEXT, daily_spent BIGINT)`); err != nil {
				t.Fatal(err)
			}
			if populated {
				if _, err := tx.Exec(`INSERT INTO guilds VALUES('legacy',500)`); err != nil {
					t.Fatal(err)
				}
			}
			source, err := LoadMigration("000011_daily_accounting_v2.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			_, err = tx.Exec(source)
			if populated {
				if err == nil || !strings.Contains(err.Error(), "reconcile legacy spending independently") {
					t.Fatalf("expected reconciliation refusal: %v", err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(`INSERT INTO guilds(id,daily_spent) VALUES('new',0)`); err != nil {
					t.Fatal(err)
				}
				var version int
				if err := tx.QueryRow(`SELECT daily_accounting_version FROM guilds`).Scan(&version); err != nil || version != 2 {
					t.Fatalf("version=%d err=%v", version, err)
				}
			}
		})
	}
}
