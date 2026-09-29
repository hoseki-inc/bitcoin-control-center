CREATE TABLE `account_history_syncs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`from_block_height` integer NOT NULL,
	`to_block_height` integer NOT NULL,
	`range_start` text NOT NULL,
	`range_end` text NOT NULL,
	`synced_at` text DEFAULT (datetime('now')) NOT NULL,
	`sync_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_account_history_syncs_account_blocks` ON `account_history_syncs` (`account_id`,`from_block_height`,`to_block_height`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_history_syncs_account_id_from_block_height_to_block_height_unique` ON `account_history_syncs` (`account_id`,`from_block_height`,`to_block_height`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text DEFAULT 'mainnet' NOT NULL,
	`descriptor` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`balance_sats` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_snapshots_account_id_timestamp_unique` ON `balance_snapshots` (`account_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`is_satisfied` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `discovery_cache` (
	`account_id` text PRIMARY KEY NOT NULL,
	`last_used_receive_index` integer DEFAULT 0 NOT NULL,
	`last_used_change_index` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `etf_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `etf_balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`balance_sats` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `etf_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `etf_balance_snapshots_account_id_timestamp_unique` ON `etf_balance_snapshots` (`account_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `etf_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`ticker` text NOT NULL,
	`shares` text NOT NULL,
	`date_purchased` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `etf_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exchange_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`balance_sats` text,
	`balance_as_of` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`external_account_id` text,
	`credentials_connected_at` text,
	CONSTRAINT "exchange_accounts_provider_check" CHECK("exchange_accounts"."provider" IN ('coinbase', 'strike', 'robinhood', 'kraken'))
);
--> statement-breakpoint
CREATE TABLE `exchange_balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`balance_sats` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `exchange_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_balance_snapshots_account_id_timestamp_unique` ON `exchange_balance_snapshots` (`account_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `exchange_statement_txs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`external_id` text NOT NULL,
	`transacted_at` text NOT NULL,
	`type` text NOT NULL,
	`amount_btc` text NOT NULL,
	`amount_usd` text,
	`fee_usd` text,
	`fee_btc` text,
	`exchange_rate` text,
	`description` text,
	`tx_hash` text,
	`statement_month` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `exchange_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_statement_txs_account_id_external_id_unique` ON `exchange_statement_txs` (`account_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `keystores` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`label` text NOT NULL,
	`wallet` text,
	`model` text,
	`derivation_path` text,
	`xpub` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `manual_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`balance_sats` text DEFAULT '0' NOT NULL,
	`balance_as_of` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `manual_balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`balance_sats` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `manual_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_balance_snapshots_account_id_timestamp_unique` ON `manual_balance_snapshots` (`account_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `manual_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_sats` text NOT NULL,
	`transacted_at` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `manual_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "manual_transactions_type_check" CHECK("manual_transactions"."type" IN ('buy', 'sell', 'transfer_in', 'transfer_out'))
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signed_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge_id` text NOT NULL,
	`keystore_id` text NOT NULL,
	`address` text NOT NULL,
	`message_text` text NOT NULL,
	`signature` text,
	`signed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`keystore_id`) REFERENCES `keystores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `statements` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`opening_date` text NOT NULL,
	`closing_date` text NOT NULL,
	`account_ids` text NOT NULL,
	`user_name` text,
	`user_address` text,
	`transaction_map` text,
	`daily_rates` text,
	`counter` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`exchange_account_ids` text,
	CONSTRAINT "statements_status_check" CHECK("statements"."status" IN ('pending', 'completed', 'failed'))
);
