CREATE TABLE `btc_quote_cache` (
	`provider_url` text NOT NULL,
	`quote_currency` text NOT NULL,
	`timestamp` integer NOT NULL,
	`price` text NOT NULL,
	CONSTRAINT `btc_quote_cache_pk` PRIMARY KEY(`quote_currency`, `timestamp`),
	CONSTRAINT "btc_quote_cache_quote_currency_check" CHECK("quote_currency" IN ('USD', 'CAD', 'GBP', 'EUR'))
);
--> statement-breakpoint
CREATE TABLE `btc_quote_lookups` (
	`provider` text NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `btc_quote_lookups_pk` PRIMARY KEY(`provider`, `requested_at`)
);
--> statement-breakpoint
CREATE INDEX `btc_quote_lookup_date` ON `btc_quote_lookups` (`requested_at`,`expires_at`);