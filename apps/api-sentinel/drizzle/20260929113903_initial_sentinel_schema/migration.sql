CREATE TABLE `account_history_syncs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`account_id` text NOT NULL,
	`from_block_height` integer NOT NULL,
	`to_block_height` integer NOT NULL,
	`range_start` text NOT NULL,
	`range_end` text NOT NULL,
	`synced_at` text DEFAULT (datetime('now')) NOT NULL,
	`sync_version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_account_history_syncs_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `account_history_syncs_account_id_from_block_height_to_block_height_unique` UNIQUE(`account_id`,`from_block_height`,`to_block_height`)
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`network` text DEFAULT 'mainnet' NOT NULL,
	`descriptor` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`account_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`balance_sats` text NOT NULL,
	CONSTRAINT `fk_balance_snapshots_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `balance_snapshots_account_id_timestamp_unique` UNIQUE(`account_id`,`timestamp`)
);
--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`is_satisfied` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_challenges_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `discovery_cache` (
	`account_id` text PRIMARY KEY,
	`last_used_receive_index` integer DEFAULT 0 NOT NULL,
	`last_used_change_index` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_discovery_cache_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `etf_accounts` (
	`id` text PRIMARY KEY,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `etf_balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`account_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`balance_sats` text NOT NULL,
	CONSTRAINT `fk_etf_balance_snapshots_account_id_etf_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `etf_accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `etf_balance_snapshots_account_id_timestamp_unique` UNIQUE(`account_id`,`timestamp`)
);
--> statement-breakpoint
CREATE TABLE `etf_holdings` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`ticker` text NOT NULL,
	`shares` text NOT NULL,
	`date_purchased` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_etf_holdings_account_id_etf_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `etf_accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `exchange_accounts` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`balance_sats` text,
	`balance_as_of` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`external_account_id` text,
	`credentials_connected_at` text,
	CONSTRAINT "exchange_accounts_provider_check" CHECK("provider" IN ('coinbase', 'strike', 'robinhood', 'kraken'))
);
--> statement-breakpoint
CREATE TABLE `exchange_balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`account_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`balance_sats` text NOT NULL,
	CONSTRAINT `fk_exchange_balance_snapshots_account_id_exchange_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `exchange_accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `exchange_balance_snapshots_account_id_timestamp_unique` UNIQUE(`account_id`,`timestamp`)
);
--> statement-breakpoint
CREATE TABLE `exchange_statement_txs` (
	`id` text PRIMARY KEY,
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
	CONSTRAINT `fk_exchange_statement_txs_account_id_exchange_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `exchange_accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `exchange_statement_txs_account_id_external_id_unique` UNIQUE(`account_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `keystores` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`label` text NOT NULL,
	`wallet` text,
	`model` text,
	`derivation_path` text,
	`xpub` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_keystores_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `manual_accounts` (
	`id` text PRIMARY KEY,
	`display_name` text NOT NULL,
	`balance_sats` text DEFAULT '0' NOT NULL,
	`balance_as_of` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `manual_balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`account_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`balance_sats` text NOT NULL,
	CONSTRAINT `fk_manual_balance_snapshots_account_id_manual_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `manual_accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `manual_balance_snapshots_account_id_timestamp_unique` UNIQUE(`account_id`,`timestamp`)
);
--> statement-breakpoint
CREATE TABLE `manual_transactions` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_sats` text NOT NULL,
	`transacted_at` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_manual_transactions_account_id_manual_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `manual_accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "manual_transactions_type_check" CHECK("type" IN ('buy', 'sell', 'transfer_in', 'transfer_out'))
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signed_messages` (
	`id` text PRIMARY KEY,
	`challenge_id` text NOT NULL,
	`keystore_id` text NOT NULL,
	`address` text NOT NULL,
	`message_text` text NOT NULL,
	`signature` text,
	`signed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_signed_messages_challenge_id_challenges_id_fk` FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_signed_messages_keystore_id_keystores_id_fk` FOREIGN KEY (`keystore_id`) REFERENCES `keystores`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `statements` (
	`id` text PRIMARY KEY,
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
	CONSTRAINT "statements_status_check" CHECK("status" IN ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_account_history_syncs_account_blocks` ON `account_history_syncs` (`account_id`,`from_block_height`,`to_block_height`);