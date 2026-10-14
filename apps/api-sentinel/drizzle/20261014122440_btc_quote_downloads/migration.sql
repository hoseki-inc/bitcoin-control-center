CREATE TABLE `btc_quote_downloads` (
	`provider` text NOT NULL,
	`quote_currency` text NOT NULL,
	`downloaded_at` integer NOT NULL,
	CONSTRAINT `btc_quote_downloads_pk` PRIMARY KEY(`provider`, `quote_currency`),
	CONSTRAINT "btc_quote_downloads_quote_currency_check" CHECK("quote_currency" IN ('USD', 'CAD', 'GBP', 'EUR'))
);
