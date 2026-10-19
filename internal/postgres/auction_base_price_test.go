package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"market-dragon/internal/api"
)

func TestHTTPAuctionBasePrice(t *testing.T) {
	w, i, o, a, idem, _ := researchFixture(t)
	if _, err := testDB.Exec(`UPDATE items SET type='legendary',base_price=750`); err != nil {
		t.Fatal(err)
	}
	handler := api.NewRouter(w, i, a, o, idem)
	request := func(method, path, body, key string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatalf("%s %s: status=%d want=%d body=%s", method, path, res.Code, want, res.Body.String())
		}
		return res
	}
	for _, field := range []string{"", `,"base_price":null`, `,"base_price":0`, `,"base_price":-1`, `,"base_price":1.5`, `,"base_price":9223372036854775808`} {
		request("POST", "/auctions", `{"item_id":"research-item","seller_id":"seller"`+field+`}`, "", 400)
	}
	var count int
	var status string
	if err := testDB.QueryRow(`SELECT count(*) FROM auctions`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid starts created auctions: count=%d err=%v", count, err)
	}
	if err := testDB.QueryRow(`SELECT status FROM items WHERE id='research-item'`).Scan(&status); err != nil || status != "free" {
		t.Fatalf("invalid starts changed item: status=%s err=%v", status, err)
	}
	response := request("POST", "/auctions", `{"item_id":"research-item","seller_id":"seller","base_price":500}`, "", 201)
	var created struct {
		ID        string `json:"id"`
		BasePrice int    `json:"base_price"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil || created.BasePrice != 500 {
		t.Fatalf("auction response: %s err=%v", response.Body.String(), err)
	}
	response = request("GET", "/auctions/"+created.ID, "", "", 200)
	if !strings.Contains(response.Body.String(), `"base_price":500`) {
		t.Fatalf("GET lost auction floor: %s", response.Body.String())
	}
	state, err := NewInspector(testDB, "test").Snapshot(context.Background(), 0)
	if err != nil || len(state.Auctions) != 1 || state.Auctions[0].BasePrice != 500 {
		t.Fatalf("snapshot lost auction floor: state=%+v err=%v", state, err)
	}
	if _, err := testDB.Exec(`UPDATE items SET base_price=1`); err != nil {
		t.Fatal(err)
	}
	path := "/auctions/" + created.ID + "/bids"
	request("POST", path, `{"bidder_id":"buyer","amount":0}`, "zero-bid", 400)
	for _, amount := range []int{1, 499} {
		res := request("POST", path, fmt.Sprintf(`{"bidder_id":"buyer","amount":%d}`, amount), fmt.Sprintf("low-%d", amount), 409)
		if !strings.Contains(res.Body.String(), "minimum bid is 500") {
			t.Fatalf("missing useful minimum: %s", res.Body.String())
		}
	}
	var reserved, audits int
	if err := testDB.QueryRow(`SELECT reserved,(SELECT count(*) FROM wallet_transactions),(SELECT count(*) FROM bids) FROM guilds WHERE id='buyer'`).Scan(&reserved, &audits, &count); err != nil || reserved != 0 || audits != 0 || count != 0 {
		t.Fatalf("rejected bids mutated state: reserve=%d audits=%d bids=%d err=%v", reserved, audits, count, err)
	}
	request("POST", path, `{"bidder_id":"buyer","amount":500}`, "at-floor", 201)
	request("POST", path, `{"bidder_id":"other","amount":524}`, "low-increment", 409)
	response = request("POST", path, `{"bidder_id":"other","amount":525}`, "next-bid", 201)
	var bid struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &bid); err != nil {
		t.Fatal(err)
	}
	request("DELETE", path+"/"+bid.ID+"?bidder_id=other", "", "", http.StatusNoContent)
	request("POST", path, `{"bidder_id":"buyer","amount":499}`, "low-after-cancel", 409)
	request("POST", path, `{"bidder_id":"buyer","amount":500}`, "floor-after-cancel", 201)
}

func TestAuctionBasePriceMigration(t *testing.T) {
	for _, tc := range []struct {
		name, insert, code string
	}{
		{"missing", `INSERT INTO auctions(id) VALUES('new')`, "23502"},
		{"zero", `INSERT INTO auctions(id,base_price) VALUES('new',0)`, "23514"},
		{"negative", `INSERT INTO auctions(id,base_price) VALUES('new',-1)`, "23514"},
		{"positive", `INSERT INTO auctions(id,base_price) VALUES('new',500)`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := testDB.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if _, err := tx.Exec(`CREATE TEMP TABLE auctions(id TEXT); INSERT INTO auctions VALUES('legacy')`); err != nil {
				t.Fatal(err)
			}
			source, err := LoadMigration("000012_auction_base_price.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(source); err != nil {
				t.Fatal(err)
			}
			var price int
			if err := tx.QueryRow(`SELECT base_price FROM auctions WHERE id='legacy'`).Scan(&price); err != nil || price != 1 {
				t.Fatalf("legacy auction changed contract: price=%d err=%v", price, err)
			}
			_, err = tx.Exec(tc.insert)
			if tc.code == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != tc.code {
					t.Fatalf("expected SQLSTATE %s, got %v", tc.code, err)
				}
			}
		})
	}
}
