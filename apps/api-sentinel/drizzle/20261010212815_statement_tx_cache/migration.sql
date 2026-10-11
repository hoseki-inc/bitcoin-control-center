CREATE TABLE `statement_tx_cache` (
	`txid` text PRIMARY KEY,
	`source` text NOT NULL,
	`block_height` integer NOT NULL,
	`block_time` integer NOT NULL,
	`inputs` text NOT NULL,
	`outputs` text NOT NULL,
	`saved_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "statement_tx_cache_source_check" CHECK("source" IN ('electrum', 'node_mempool', 'public_mempool'))
);
--> statement-breakpoint
-- Earlier statements keep no source: StartOS used public mempool.space before it required the node's mempool.
ALTER TABLE `statements` ADD `tx_source` text CONSTRAINT "statements_tx_source_check" CHECK("tx_source" IN ('electrum', 'node_mempool', 'public_mempool'));
