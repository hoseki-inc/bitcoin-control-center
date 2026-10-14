ALTER TABLE `btc_quote_cache` ADD `refreshed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Prices saved before were only for statements' activity days, so asking a source to confirm them again would show which days those were.
DELETE FROM `btc_quote_cache` WHERE `refreshed_at` = 0;
