package auction

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

func TestBidIncrementRejectsUnrepresentableNextBid(t *testing.T) {
	repo, wallet, items := newMockAuctionRepository(), &mockWallet{}, newMockItems()
	repo.auctions[auctionID] = activeAuction(fixedNow.Add(time.Hour))
	repo.bids["huge"] = &Bid{ID: "huge", AuctionID: auctionID, BidderID: bidder1, Amount: math.MaxInt64 - 1, Status: ActiveBid}
	svc := newService(repo, wallet, items, fixedNow)
	_, err := svc.PlaceBid(context.Background(), auctionID, bidder2, math.MaxInt64)
	if !errors.Is(err, ErrBidTooLow) {
		t.Fatalf("unrepresentable 5%% increment accepted: %v", err)
	}
	if len(wallet.reserved) != 0 || len(wallet.released) != 0 {
		t.Fatal("invalid bid touched wallet")
	}
}
