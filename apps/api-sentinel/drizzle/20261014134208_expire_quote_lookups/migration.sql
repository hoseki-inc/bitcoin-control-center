-- Prices used to be kept forever after one lookup. Look every saved day up again before using it.
UPDATE `btc_quote_lookups` SET `expires_at` = 0;
