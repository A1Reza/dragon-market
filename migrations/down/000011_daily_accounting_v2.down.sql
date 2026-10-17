DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM guilds) THEN
        RAISE EXCEPTION 'cannot automatically downgrade nonempty accounting v2 wallets';
    END IF;
END $$;

ALTER TABLE guilds DROP COLUMN daily_accounting_version;
COMMENT ON COLUMN guilds.daily_spent IS NULL;
