-- Existing statements get no source: whichever mempool URL was configured then wasn't recorded.
ALTER TABLE `statements` ADD `tx_source` text CONSTRAINT "statements_tx_source_check" CHECK("tx_source" IN ('electrum', 'node_mempool', 'public_mempool'));
