package api

import (
	"context"
	"encoding/json"
	"market-dragon/internal/gold"
	"market-dragon/internal/order"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type contractOrders struct{ routeOrderService }

func (contractOrders) List(context.Context, string, string, gold.Amount) (*order.LimitOrder, error) {
	return &order.LimitOrder{ID: "order", SellerID: "seller", ItemID: "item", Price: 700, Status: order.Listed}, nil
}
func TestOrderCreationReturnsPersistedFields(t *testing.T) {
	r := NewRouter(nil, nil, nil, &contractOrders{}, nil)
	req := httptest.NewRequest("POST", "/orders", strings.NewReader(`{"item_id":"item","owner_id":"seller","base_price":700}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body createOrderResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.ID != "order" || body.OwnerID != "seller" || body.Status != order.Listed || body.BasePrice != 700 {
		t.Fatalf("response misrepresents persisted order: %+v", body)
	}
}
