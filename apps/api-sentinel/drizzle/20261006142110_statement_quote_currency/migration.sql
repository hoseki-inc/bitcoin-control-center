ALTER TABLE `statements` ADD `quote_currency` text DEFAULT 'USD' NOT NULL CONSTRAINT "statements_quote_currency_check" CHECK("quote_currency" IN ('USD', 'CAD', 'GBP', 'EUR'));--> statement-breakpoint
ALTER TABLE `statements` ADD `error_message` text;
