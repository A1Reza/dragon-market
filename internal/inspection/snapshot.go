// Package inspection describes optional development-only persisted-state reads.
// Domain services do not depend on this package.
package inspection

import (
	"market-dragon/internal/gold"
	"time"
)

type Wallet struct {
	ID         string      `json:"id"`
	Gold       gold.Amount `json:"gold"`
	Reserved   gold.Amount `json:"reserved"`
	Available  gold.Amount `json:"available"`
	DailyLimit gold.Amount `json:"daily_limit"`
	DailySpent gold.Amount `json:"daily_spent"`
	SpentOn    time.Time   `json:"daily_spent_on"`
}
type Item struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	Type      string      `json:"type"`
	OwnerID   string      `json:"owner_id"`
	Status    string      `json:"status"`
	BasePrice gold.Amount `json:"base_price"`
}
type Order struct {
	ID       string      `json:"id"`
	ItemID   string      `json:"item_id"`
	SellerID string      `json:"seller_id"`
	BuyerID  *string     `json:"buyer_id"`
	Price    gold.Amount `json:"price"`
	Status   string      `json:"status"`
	ListedAt time.Time   `json:"listed_at"`
}
type Auction struct {
	ID       string    `json:"id"`
	ItemID   string    `json:"item_id"`
	SellerID string    `json:"seller_id"`
	EndsAt   time.Time `json:"ends_at"`
	Status   string    `json:"status"`
}
type Bid struct {
	ID        string      `json:"id"`
	AuctionID string      `json:"auction_id"`
	BidderID  string      `json:"bidder_id"`
	Amount    gold.Amount `json:"amount"`
	Status    string      `json:"status"`
	PlacedAt  time.Time   `json:"placed_at"`
}
type Audit struct {
	ID            int64       `json:"id"`
	GuildID       string      `json:"guild_id"`
	Operation     string      `json:"operation"`
	Amount        gold.Amount `json:"amount"`
	GoldAfter     gold.Amount `json:"gold_after"`
	ReservedAfter gold.Amount `json:"reserved_after"`
	CreatedAt     time.Time   `json:"created_at"`
}
type Snapshot struct {
	ObservedAt      time.Time      `json:"observed_at"`
	Environment     string         `json:"environment"`
	Database        string         `json:"database"`
	DatabaseVersion string         `json:"database_version"`
	DatabaseAddress string         `json:"database_address"`
	BackendCommit   string         `json:"backend_commit"`
	Limit           int            `json:"limit"`
	Offset          int            `json:"offset"`
	Counts          map[string]int `json:"counts"`
	Guilds          []Wallet       `json:"guilds"`
	Items           []Item         `json:"items"`
	Orders          []Order        `json:"orders"`
	Auctions        []Auction      `json:"auctions"`
	Bids            []Bid          `json:"bids"`
	Audit           []Audit        `json:"audit"`
}
