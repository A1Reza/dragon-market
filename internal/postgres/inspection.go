package postgres

import (
	"context"
	"database/sql"
	"market-dragon/internal/inspection"
	"time"
)

type Inspector struct {
	db     *sql.DB
	commit string
}

func NewInspector(db *sql.DB, commit string) *Inspector { return &Inspector{db, commit} }

// Snapshot uses one consistent, read-only MVCC view. It takes no row locks and
// has no write path. Every collection is bounded, including audit history.
func (s *Inspector) Snapshot(ctx context.Context, offset int) (*inspection.Snapshot, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := &inspection.Snapshot{ObservedAt: time.Now().UTC(), Environment: "development", BackendCommit: s.commit, Limit: 200, Offset: offset, Counts: map[string]int{}, Guilds: []inspection.Wallet{}, Items: []inspection.Item{}, Orders: []inspection.Order{}, Auctions: []inspection.Auction{}, Bids: []inspection.Bid{}, Audit: []inspection.Audit{}}
	err = tx.QueryRowContext(ctx, `SELECT current_database(),current_setting('server_version'),coalesce(inet_server_addr()::text,'local') || ':' || coalesce(inet_server_port()::text,'socket')`).Scan(&out.Database, &out.DatabaseVersion, &out.DatabaseAddress)
	if err != nil {
		return nil, err
	}
	// Table identifiers below are compile-time constants, never request input.
	for _, table := range []string{"guilds", "items", "limit_orders", "auctions", "bids", "wallet_transactions"} {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil {
			return nil, err
		}
		out.Counts[table] = count
	}
	queries := []struct {
		sql  string
		scan func(*sql.Rows) error
	}{
		{`SELECT id,gold,reserved,gold-reserved,daily_limit,daily_spent,daily_spent_on FROM guilds ORDER BY id LIMIT 200 OFFSET $1`, func(r *sql.Rows) error {
			var v inspection.Wallet
			err := r.Scan(&v.ID, &v.Gold, &v.Reserved, &v.Available, &v.DailyLimit, &v.DailySpent, &v.SpentOn)
			out.Guilds = append(out.Guilds, v)
			return err
		}},
		{`SELECT id,name,type,owner_id,status,base_price FROM items ORDER BY id LIMIT 200 OFFSET $1`, func(r *sql.Rows) error {
			var v inspection.Item
			err := r.Scan(&v.ID, &v.Name, &v.Type, &v.OwnerID, &v.Status, &v.BasePrice)
			out.Items = append(out.Items, v)
			return err
		}},
		{`SELECT id,item_id,seller_id,buyer_id,price,status,listed_at FROM limit_orders ORDER BY listed_at DESC,id LIMIT 200 OFFSET $1`, func(r *sql.Rows) error {
			var v inspection.Order
			err := r.Scan(&v.ID, &v.ItemID, &v.SellerID, &v.BuyerID, &v.Price, &v.Status, &v.ListedAt)
			out.Orders = append(out.Orders, v)
			return err
		}},
		{`SELECT id,item_id,seller_id,ends_at,status FROM auctions ORDER BY ends_at DESC,id LIMIT 200 OFFSET $1`, func(r *sql.Rows) error {
			var v inspection.Auction
			err := r.Scan(&v.ID, &v.ItemID, &v.SellerID, &v.EndsAt, &v.Status)
			out.Auctions = append(out.Auctions, v)
			return err
		}},
		{`SELECT id,auction_id,bidder_id,amount,status,placed_at FROM bids ORDER BY placed_at DESC,id LIMIT 200 OFFSET $1`, func(r *sql.Rows) error {
			var v inspection.Bid
			err := r.Scan(&v.ID, &v.AuctionID, &v.BidderID, &v.Amount, &v.Status, &v.PlacedAt)
			out.Bids = append(out.Bids, v)
			return err
		}},
		{`SELECT id,guild_id,operation,amount,gold_after,reserved_after,created_at FROM wallet_transactions ORDER BY id DESC LIMIT 200 OFFSET $1`, func(r *sql.Rows) error {
			var v inspection.Audit
			err := r.Scan(&v.ID, &v.GuildID, &v.Operation, &v.Amount, &v.GoldAfter, &v.ReservedAfter, &v.CreatedAt)
			out.Audit = append(out.Audit, v)
			return err
		}},
	}
	for _, query := range queries {
		rows, err := tx.QueryContext(ctx, query.sql, offset)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			if err := query.scan(rows); err != nil {
				rows.Close()
				return nil, err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
