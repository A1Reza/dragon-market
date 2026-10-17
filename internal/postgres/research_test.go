package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"market-dragon/internal/api"
	"market-dragon/internal/auction"
	"market-dragon/internal/gold"
	"market-dragon/internal/guild"
	"market-dragon/internal/idempotency"
	"market-dragon/internal/item"
	"market-dragon/internal/order"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func researchFixture(t *testing.T) (*guild.WalletServiceImpl, *item.ItemServiceImpl, *order.OrderServiceImpl, *auction.AuctionServiceImpl, *idempotency.IdempotencyService, *Transactor) {
	t.Helper()
	ctx := context.Background()
	if err := TruncateTables(ctx, "idempotency_records", "wallet_transactions", "bids", "auctions", "limit_orders", "items", "guilds"); err != nil {
		t.Fatal(err)
	}
	_, err := testDB.Exec(`INSERT INTO guilds(id,gold,reserved,daily_limit,daily_spent_on) VALUES ('seller',10000,0,5000,(NOW() AT TIME ZONE 'UTC')::date),('buyer',10000,0,5000,(NOW() AT TIME ZONE 'UTC')::date),('other',10000,0,5000,(NOW() AT TIME ZONE 'UTC')::date);
 INSERT INTO items(id,name,type,owner_id,status,base_price) VALUES ('research-item','Research Wand','rare','seller','free',100);`)
	if err != nil {
		t.Fatal(err)
	}
	tx := NewTransactor(testDB)
	repo := NewWalletRepository(testDB)
	wallet := guild.NewWalletService(repo, tx)
	items := item.NewItemService(NewItemRepository(testDB), repo)
	return wallet, items, order.NewOrderService(NewOrderRepository(testDB), wallet, items, tx), auction.NewAuctionService(NewAuctionRepository(testDB), wallet, items, tx), idempotency.NewService(NewIdempotencyRepo(testDB), tx), tx
}

func persistedResearchState(t *testing.T) map[string]any {
	t.Helper()
	state, err := NewInspector(testDB, "test-fixture").Snapshot(context.Background(), 0)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{"guilds": state.Guilds, "items": state.Items, "orders": state.Orders, "auctions": state.Auctions, "bids": state.Bids, "audit": state.Audit}
}
func researchReport(t *testing.T, scenario string, before, after any, assertions []string) {
	t.Helper()
	encoded, err := json.Marshal(map[string]any{"scenario": scenario, "source": "independent PostgreSQL reads after operations finish", "before": before, "after": after, "assertions": assertions})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("RESEARCH_REPORT " + string(encoded))
}

func assertPurchaseState(t *testing.T, winner string) {
	t.Helper()
	var owner, status, buyer string
	var sellerGold, buyerGold, otherGold, audits int64
	if err := testDB.QueryRow(`SELECT i.owner_id,o.status,o.buyer_id FROM items i JOIN limit_orders o ON i.id=o.item_id WHERE o.status='sold'`).Scan(&owner, &status, &buyer); err != nil {
		t.Fatal(err)
	}
	for id, dest := range map[string]*int64{"seller": &sellerGold, winner: &buyerGold} {
		if err := testDB.QueryRow(`SELECT gold FROM guilds WHERE id=$1`, id).Scan(dest); err != nil {
			t.Fatal(err)
		}
	}
	loser := "other"
	if winner == "other" {
		loser = "buyer"
	}
	if err := testDB.QueryRow(`SELECT gold FROM guilds WHERE id=$1`, loser).Scan(&otherGold); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if owner != winner || buyer != winner || status != "sold" || sellerGold != 10100 || buyerGold != 9900 || otherGold != 10000 || audits != 2 {
		t.Fatalf("owner=%s buyer=%s status=%s gold seller=%d winner=%d loser=%d audits=%d", owner, buyer, status, sellerGold, buyerGold, otherGold, audits)
	}
}

func TestResearchCompetingBuyers(t *testing.T) {
	w, i, o, a, idem, _ := researchFixture(t)
	listing, err := o.List(context.Background(), "research-item", "seller", 100)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(api.NewRouter(w, i, a, o, idem))
	defer server.Close()
	before := persistedResearchState(t)
	start := make(chan struct{})
	type outcome struct {
		Buyer  string
		Status int
	}
	results := make(chan outcome, 2)
	for _, buyer := range []string{"buyer", "other"} {
		go func(buyer string) {
			<-start
			req, _ := http.NewRequest("POST", server.URL+"/orders/"+listing.ID+"/buy", strings.NewReader(`{"buyer_id":"`+buyer+`"}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "competition-"+buyer)
			res, err := server.Client().Do(req)
			if err != nil {
				results <- outcome{buyer, 0}
				return
			}
			res.Body.Close()
			results <- outcome{buyer, res.StatusCode}
		}(buyer)
	}
	close(start)
	outcomes := []outcome{<-results, <-results}
	winner := ""
	successes := 0
	for _, r := range outcomes {
		if r.Status == 204 {
			winner = r.Buyer
			successes++
		} else if r.Status != 400 {
			t.Fatalf("unexpected result %+v", r)
		}
	}
	if successes != 1 {
		t.Fatalf("successes=%d results=%v", successes, outcomes)
	}
	assertPurchaseState(t, winner)
	researchReport(t, "competing-buyers", before, map[string]any{"state": persistedResearchState(t), "requests": outcomes}, []string{"Exactly one HTTP purchase succeeds", "Winner owns item and order", "Seller receives exactly 100; winner pays exactly 100; loser unchanged", "Exactly two committed financial audit rows"})
}

func TestHTTPPurchaseIdempotencyPersistedEffects(t *testing.T) {
	w, i, o, a, idem, _ := researchFixture(t)
	listing, err := o.List(context.Background(), "research-item", "seller", 100)
	if err != nil {
		t.Fatal(err)
	}
	handler := api.NewRouter(w, i, a, o, idem)
	invoke := func(key, buyer string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/orders/"+listing.ID+"/buy", strings.NewReader(`{"buyer_id":"`+buyer+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res
	}
	if res := invoke("", "buyer"); res.Code != 400 {
		t.Fatalf("missing key status=%d", res.Code)
	}
	first := invoke("persisted-purchase", "buyer")
	second := invoke("persisted-purchase", "buyer")
	if first.Code != 204 || second.Code != 204 || second.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("first=%d second=%d replay=%s", first.Code, second.Code, second.Header().Get("Idempotency-Replayed"))
	}
	if res := invoke("persisted-purchase", "other"); res.Code != 409 {
		t.Fatalf("changed payload status=%d", res.Code)
	}
	assertPurchaseState(t, "buyer")
	var records int
	if err := testDB.QueryRow(`SELECT count(*) FROM idempotency_records WHERE completed_at IS NOT NULL`).Scan(&records); err != nil || records != 1 {
		t.Fatalf("completed keys=%d err=%v", records, err)
	}
}

func TestConcurrentIdenticalPurchaseKeyOnePersistedEffect(t *testing.T) {
	w, i, o, a, idem, _ := researchFixture(t)
	listing, err := o.List(context.Background(), "research-item", "seller", 100)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(api.NewRouter(w, i, a, o, idem))
	defer server.Close()
	start := make(chan struct{})
	results := make(chan *http.Response, 2)
	failures := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			req, _ := http.NewRequest("POST", server.URL+"/orders/"+listing.ID+"/buy", strings.NewReader(`{"buyer_id":"buyer"}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "simultaneous-key")
			response, err := server.Client().Do(req)
			if err != nil {
				failures <- err
				return
			}
			results <- response
		}()
	}
	close(start)
	replays := 0
	for range 2 {
		select {
		case err := <-failures:
			t.Fatal(err)
		case response := <-results:
			response.Body.Close()
			if response.StatusCode != 204 {
				t.Fatalf("status=%d", response.StatusCode)
			}
			if response.Header.Get("Idempotency-Replayed") == "true" {
				replays++
			}
		}
	}
	if replays != 1 {
		t.Fatalf("replay headers=%d", replays)
	}
	assertPurchaseState(t, "buyer")
	var keys int
	if err := testDB.QueryRow(`SELECT count(*) FROM idempotency_records`).Scan(&keys); err != nil || keys != 1 {
		t.Fatalf("keys=%d err=%v", keys, err)
	}
}

func TestHTTPBidReplayReservesOnce(t *testing.T) {
	w, i, o, a, idem, _ := researchFixture(t)
	if _, err := testDB.Exec(`UPDATE items SET type='legendary'`); err != nil {
		t.Fatal(err)
	}
	created, err := a.StartAuction(context.Background(), "research-item", "seller")
	if err != nil {
		t.Fatal(err)
	}
	handler := api.NewRouter(w, i, a, o, idem)
	var first []byte
	for attempt := 0; attempt < 2; attempt++ {
		req := httptest.NewRequest("POST", "/auctions/"+created.ID+"/bids", strings.NewReader(`{"bidder_id":"buyer","amount":100}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "repeated-bid")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != 201 {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		if attempt == 0 {
			first = append([]byte{}, response.Body.Bytes()...)
		} else {
			assertJSONEqual(t, response.Body.Bytes(), first)
			if response.Header().Get("Idempotency-Replayed") != "true" {
				t.Fatal("missing replay header")
			}
		}
	}
	var reserved, bids, audits int
	if err := testDB.QueryRow(`SELECT reserved FROM guilds WHERE id='buyer'`).Scan(&reserved); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT count(*) FROM bids`).Scan(&bids); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if reserved != 100 || bids != 1 || audits != 1 {
		t.Fatalf("reserved=%d bids=%d audits=%d", reserved, bids, audits)
	}
}

func TestWorkerAloneSettlesExpiredAuction(t *testing.T) {
	w, i, _, _, _, tx := researchFixture(t)
	if _, err := testDB.Exec(`UPDATE items SET type='legendary'`); err != nil {
		t.Fatal(err)
	}
	clock := &researchClock{now: time.Now().UTC()}
	svc := auction.NewAuctionService(NewAuctionRepository(testDB), w, i, tx, auction.WithClock(clock))
	created, err := svc.StartAuction(context.Background(), "research-item", "seller")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PlaceBid(context.Background(), created.ID, "buyer", 100); err != nil {
		t.Fatal(err)
	}
	clock.advance(25 * time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); auction.RunSettlementWorker(ctx, svc, time.Hour) }()
	defer func() { cancel(); <-done }()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	poll := time.NewTicker(10 * time.Millisecond)
	defer poll.Stop()
	for {
		var owner string
		if err := testDB.QueryRow(`SELECT owner_id FROM items WHERE id='research-item'`).Scan(&owner); err != nil {
			t.Fatal(err)
		}
		if owner == "buyer" {
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("worker did not commit settlement")
		case <-poll.C:
		}
	}
	var gold, reserve, audits int
	if err := testDB.QueryRow(`SELECT gold,reserved FROM guilds WHERE id='buyer'`).Scan(&gold, &reserve); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if gold != 9900 || reserve != 0 || audits != 3 {
		t.Fatalf("worker gold=%d reserve=%d audit=%d", gold, reserve, audits)
	}
}

type failOrderUpdate struct{ *OrderRepository }

var errDeliberateRollback = errors.New("test-only late order update failure")

func (failOrderUpdate) Update(context.Context, *order.LimitOrder) error { return errDeliberateRollback }

func TestResearchRollback(t *testing.T) {
	w, i, o, _, idem, tx := researchFixture(t)
	ctx := context.Background()
	listing, err := o.List(ctx, "research-item", "seller", 100)
	if err != nil {
		t.Fatal(err)
	}
	before := persistedResearchState(t)
	defectiveSink := order.NewOrderService(failOrderUpdate{NewOrderRepository(testDB)}, w, i, tx)
	_, err = idem.Execute(ctx, "rollback-key", "order.buy", idempotency.Hash(listing.ID, "buyer"), func(ctx context.Context) (int, json.RawMessage, error) {
		return 204, nil, defectiveSink.Buy(ctx, listing.ID, "buyer")
	})
	if !errors.Is(err, errDeliberateRollback) {
		t.Fatalf("expected deliberate late failure; got %v", err)
	}
	after := persistedResearchState(t)
	b, _ := json.Marshal(before)
	v, _ := json.Marshal(after)
	if string(b) != string(v) {
		t.Fatalf("partial effects survived rollback: before=%s after=%s", b, v)
	}
	var keys int
	if err := testDB.QueryRow(`SELECT count(*) FROM idempotency_records`).Scan(&keys); err != nil || keys != 0 {
		t.Fatalf("rolled-back claim persists: %d %v", keys, err)
	}
	researchReport(t, "rollback", before, after, []string{"Failure occurs after spend, earn and ownership transfer", "All wallet, item, order, bid, auction and audit rows unchanged", "Idempotency claim rolled back; same key remains usable"})
	_, err = idem.Execute(ctx, "rollback-key", "order.buy", idempotency.Hash(listing.ID, "buyer"), func(ctx context.Context) (int, json.RawMessage, error) {
		return 204, nil, o.Buy(ctx, listing.ID, "buyer")
	})
	if err != nil {
		t.Fatal(err)
	}
	assertPurchaseState(t, "buyer")
}

type researchClock struct {
	mu  sync.RWMutex
	now time.Time
}

func (c *researchClock) Now() time.Time { c.mu.RLock(); defer c.mu.RUnlock(); return c.now }
func (c *researchClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func TestResearchSettlement(t *testing.T) {
	w, i, _, _, _, tx := researchFixture(t)
	ctx := context.Background()
	if _, err := testDB.Exec(`UPDATE items SET type='legendary'`); err != nil {
		t.Fatal(err)
	}
	clock := &researchClock{now: time.Now().UTC()}
	svc := auction.NewAuctionService(NewAuctionRepository(testDB), w, i, tx, auction.WithClock(clock))
	a, err := svc.StartAuction(ctx, "research-item", "seller")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PlaceBid(ctx, a.ID, "buyer", 100); err != nil {
		t.Fatal(err)
	}
	before := persistedResearchState(t)
	clock.advance(25 * time.Hour)
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); auction.RunSettlementWorker(workerCtx, svc, time.Hour) }()
	if err := svc.EndExpiredAuctions(ctx, 100); err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	poll := time.NewTicker(10 * time.Millisecond)
	defer poll.Stop()
	for {
		var status string
		if err := testDB.QueryRow(`SELECT status FROM auctions WHERE id=$1`, a.ID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status == "ended" {
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("worker settlement not ready")
		case <-poll.C:
		}
	}
	cancel()
	<-done
	if err := svc.EndExpiredAuctions(ctx, 100); err != nil {
		t.Fatal(err)
	}
	var owner, bidStatus string
	var sellerGold, buyerGold, reserved, audits int
	if err := testDB.QueryRow(`SELECT owner_id FROM items WHERE id='research-item'`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT status FROM bids`).Scan(&bidStatus); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT gold,reserved FROM guilds WHERE id='buyer'`).Scan(&buyerGold, &reserved); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT gold FROM guilds WHERE id='seller'`).Scan(&sellerGold); err != nil {
		t.Fatal(err)
	}
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if owner != "buyer" || bidStatus != "winning" || buyerGold != 9900 || sellerGold != 10100 || reserved != 0 || audits != 3 {
		t.Fatalf("owner=%s bid=%s buyer=%d seller=%d reserve=%d audits=%d", owner, bidStatus, buyerGold, sellerGold, reserved, audits)
	}
	researchReport(t, "settlement", before, persistedResearchState(t), []string{"Real worker races a second settlement driver", "Winner charged once; seller paid once; item transferred once", "No reservation remains; exactly reserve/deduct/earn audit rows", "Repeated expired-auction batch is a no-op"})
}

func TestWalletBoundedOperationSequences(t *testing.T) {
	w, _, _, _, _, _ := researchFixture(t)
	ctx := context.Background()
	const seed int64 = 20261017
	rng := rand.New(rand.NewSource(seed))
	var total, reserved, spent gold.Amount = 10000, 0, 0
	audits := 0
	for step := 0; step < 120; step++ {
		amount := gold.Amount(rng.Intn(400) + 1)
		op := rng.Intn(4)
		valid := true
		var err error
		switch op {
		case 0:
			valid = total-reserved >= amount && spent+reserved+amount <= 5000
			err = w.Reserve(ctx, "buyer", amount)
			if valid {
				reserved += amount
			}
		case 1:
			valid = reserved >= amount
			err = w.Release(ctx, "buyer", amount)
			if valid {
				reserved -= amount
			}
		case 2:
			valid = total-reserved >= amount && spent+reserved+amount <= 5000
			err = w.Spend(ctx, "buyer", amount)
			if valid {
				total -= amount
				spent += amount
			}
		case 3:
			err = w.Earn(ctx, "buyer", amount)
			total += amount
		}
		if (err == nil) != valid {
			t.Fatalf("seed=%d step=%d op=%d amount=%d valid=%v err=%v", seed, step, op, amount, valid, err)
		}
		if valid {
			audits++
		}
		got, err := w.GetGuild(ctx, "buyer")
		if err != nil {
			t.Fatal(err)
		}
		if got.Gold != total || got.Reserved != reserved || got.DailySpent != spent {
			t.Fatalf("seed=%d step=%d op=%d persisted=%+v expected gold=%d reserved=%d spent=%d", seed, step, op, got, total, reserved, spent)
		}
	}
	var count int
	if err := testDB.QueryRow(`SELECT count(*) FROM wallet_transactions`).Scan(&count); err != nil || count != audits {
		t.Fatal(fmt.Sprintf("audit count=%d expected=%d err=%v", count, audits, err))
	}
}
