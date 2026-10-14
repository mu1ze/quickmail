-- "Analyze all existing mail": while set, the 5-minute reconcile keeps queueing
-- the next bounded batch until nothing is left, then clears itself.
ALTER TABLE mail_analysis_settings ADD COLUMN backfill_all INTEGER NOT NULL DEFAULT 0 CHECK(backfill_all IN (0,1));
