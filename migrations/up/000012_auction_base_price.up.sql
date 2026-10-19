-- Auctions created before this migration had a minimum bid of 1. Preserve
-- that contract and any accepted bids; new auctions must specify their floor.
ALTER TABLE auctions ADD COLUMN base_price BIGINT NOT NULL DEFAULT 1
    CONSTRAINT auctions_base_price_positive CHECK (base_price > 0);
ALTER TABLE auctions ALTER COLUMN base_price DROP DEFAULT;
