-- Earlier statements keep no source: StartOS used public mempool.space before it required the node's mempool.
ALTER TABLE `statements` ADD `tx_source` text CONSTRAINT "statements_tx_source_check" CHECK("tx_source" IN ('electrum', 'node_mempool', 'public_mempool'));
