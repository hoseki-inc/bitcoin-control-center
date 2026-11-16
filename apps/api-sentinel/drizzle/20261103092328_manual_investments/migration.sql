CREATE TABLE `investment_accounts` (
	`id` text PRIMARY KEY,
	`display_name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "investment_accounts_currency_check" CHECK("currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE `investment_valuations` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`value_cents` text NOT NULL,
	`valued_at` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_investment_valuations_account_id_investment_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `investment_accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `investment_valuations_account_date_unique` UNIQUE(`account_id`,`valued_at`)
);
