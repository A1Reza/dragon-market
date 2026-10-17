-- The old combined counter cannot recover completed spending after KNOWN-01.
-- This experimental baseline supports fresh databases. Existing databases need
-- an independently reconciled conversion, with old audit evidence preserved.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM guilds) THEN
        RAISE EXCEPTION 'daily accounting v2 requires an empty guilds table; reconcile legacy spending independently before conversion';
    END IF;
END $$;

ALTER TABLE guilds
    ADD COLUMN daily_accounting_version SMALLINT NOT NULL DEFAULT 2
        CHECK (daily_accounting_version = 2);

COMMENT ON COLUMN guilds.daily_spent IS
    'Accounting v2: completed spend and deduct debits on daily_spent_on (UTC); excludes outstanding reserved gold';
