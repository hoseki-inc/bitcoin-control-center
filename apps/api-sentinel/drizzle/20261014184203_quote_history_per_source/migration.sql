-- Prices and lookups saved before were only for statements' activity days, so they're dropped rather than copied. Each source now keeps its own downloaded history.
DROP TABLE `btc_quote_lookups`;--> statement-breakpoint
DROP TABLE `btc_quote_cache`;--> statement-breakpoint
CREATE TABLE `btc_quote_cache` (
	`provider_url` text NOT NULL,
	`quote_currency` text NOT NULL,
	`timestamp` integer NOT NULL,
	`price` text NOT NULL,
	CONSTRAINT `btc_quote_cache_pk` PRIMARY KEY(`provider_url`, `quote_currency`, `timestamp`),
	CONSTRAINT "btc_quote_cache_quote_currency_check" CHECK("quote_currency" IN ('USD', 'CAD', 'GBP', 'EUR'))
);
