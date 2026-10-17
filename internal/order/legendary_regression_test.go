package order

import (
	"context"
	"errors"
	"market-dragon/internal/item"
	"testing"
)

func TestListRejectsLegendaryWithoutMutatingItem(t *testing.T) {
	repo := &MockOrderRepo{orders: map[string]*LimitOrder{}}
	items := &MockItemService{defaultItem()}
	items.items[item2ID].Type = item.Legendary
	svc := NewOrderService(repo, &MockWalletService{defaultGuilds()}, items, repo)
	_, err := svc.List(context.Background(), item2ID, sellerID, 100)
	if !errors.Is(err, ErrInvalidOrder) {
		t.Fatalf("legendary listing error=%v, want ErrInvalidOrder", err)
	}
	if len(repo.orders) != 0 || items.items[item2ID].Status != item.Free {
		t.Fatal("rejected listing mutated state")
	}
}
